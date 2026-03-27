import fs from "fs/promises";
import { join } from "path";

import { Agent } from "./agent";
import { FileTapeStore } from "./store";
import { BubFramework } from "@/framework";
import { run, chat, login, listHooks, gateway } from "./cli";
import { ChannelMessage, CliChannel, TelegramChannel } from "@/channels";
import { Envelope, MessageHandler } from "@/types";
import { contentOf, fieldOf } from "@/envelope";

export const AGENTS_FILE_NAME = "AGENTS.md";
export const DEFAULT_SYSTEM_PROMPT = `<general_instruct>
Call tools or skills to finish the task.
</general_instruct>
<response_instruct>
Before ending the run, you MUST determine whether a response needs to be sent to the channel, checking the following conditions:
1. Has the user asked you a question waiting for your answer?
2. Is there any error or important information that needs to be sent to the user immediately?
3. If it is a casual chat, does the conversation need to be continued?

**IMPORTANT:** Your plain/direct reply in this chat will be ignored.
**Therefore, you MUST send messages via channel using the correct skill if a response is needed.**

When responding to a channel message, you MUST:
1. Identify the channel from the message metadata (e.g., \`$telegram\`, \`$discord\`)
2. Send the message as instructed by the channel skill (e.g., \`telegram\` skill for \`$telegram\` channel)
</response_instruct>
<context_contract>
Excessively long context may cause model call failures. In this case, you MAY use tape.info to the token usage and you SHOULD use tape.handoff tool to shorten the length of the retrieved history.
</context_contract>
`;

export type State = Record<string, any>;

export class BuiltinImpl {
  private _framework: BubFramework;
  public agent: Agent;

  constructor(framework: BubFramework) {
    require("./tools");
    this._framework = framework;
    this.agent = new Agent(framework);
  }

  resolveSession(message: ChannelMessage): string {
    const sessionId = message.sessionId;
    if (sessionId && String(sessionId).trim()) {
      return String(sessionId);
    }
    const channel = String(message.channel || "default");
    const chatId = String(message.chatId || "default");
    return `${channel}:${chatId}`;
  }

  async loadState(message: ChannelMessage, sessionId: string): Promise<State> {
    const lifespan = message.lifespan;
    if (
      lifespan !== null &&
      typeof lifespan === "object" &&
      "enter" in lifespan
    ) {
      await lifespan.enter?.();
    }

    const state: State = {
      sessionId: sessionId,
      _runtime_agent: this.agent,
    };

    const context = message.contextStr;
    if (context) {
      state.context = context;
    }

    return state;
  }

  async saveState(
    sessionId: string,
    state: State,
    message: ChannelMessage,
    modelOutput: string,
  ): Promise<void> {
    const lifespan = message.lifespan;

    if (lifespan) {
      try {
        await lifespan.exit?.();
      } catch {
        console.error("Failed to exit lifespan");
      }
    }
  }

  async buildPrompt(
    message: ChannelMessage,
    sessionId: string,
    state: State,
  ): Promise<string | Record<string, any>[]> {
    const content = message.content || "";
    if (String(content).startsWith(",")) {
      message.kind = "command";
      return content;
    }

    const context = message.contextStr;
    const now = new Date().toISOString();
    const contextPrefix = context ? `${context}\n---Date: ${now}---\n` : "";
    const text = `${contextPrefix}${content}`;

    const media = message.media || [];
    if (!media.length) {
      return text;
    }

    const mediaParts: Record<string, any>[] = [];
    for (const item of media) {
      if (item.type === "image") {
        const data_url = await item.getUrl();
        if (!data_url) {
          continue;
        }
        mediaParts.push({
          type: "image_url",
          image_url: { url: data_url },
        });
      }
    }

    if (mediaParts.length > 0) {
      return [{ type: "text", text }, ...mediaParts];
    }
    return text;
  }

  async runModel(
    prompt: string | Record<string, any>[],
    sessionId: string,
    state: State,
  ): Promise<string> {
    return await this.agent.run(sessionId, prompt, state);
  }

  registerCliCommands(app: any): void {
    app.command("run")(run);
    app.command("chat")(chat);
    app.command("login")(login);
    app.command("hooks", { hidden: true })(listHooks);
    app.command("message", { hidden: true })(app.command("gateway")(gateway));
  }

  async systemPrompt(
    prompt: string | Record<string, any>[],
    state: State,
  ): Promise<string> {
    const agentsContent = await this._readAgentsFile(state);
    return DEFAULT_SYSTEM_PROMPT + "\n\n" + agentsContent;
  }

  provideChannels(messageHandler: MessageHandler): any[] {
    return [
      new TelegramChannel(messageHandler),
      new CliChannel({ onReceive: messageHandler, agent: this.agent }),
    ];
  }

  async onError(stage: string, error: Error, message: any): Promise<void> {
    if (message !== null) {
      const outbound = new ChannelMessage(
        message.sessionId || "unknown",
        message.channel || "default",
        `An error occurred at stage '${stage}': ${error.message}`,
        message.chatId || "default",
        true,
        "error",
      );

      await this._framework.hookRuntime.callMany("dispatchOutbound", [
        outbound,
      ]);
    }
  }

  async dispatchOutbound(message: Envelope): Promise<boolean> {
    const content = contentOf(message);
    const sessionId = fieldOf(message, "session_id");

    if (fieldOf(message, "output_channel") !== "cli") {
      console.info(
        `session.run.outbound session_id=${sessionId} content=${content}`,
      );
    }

    return await this._framework.dispatchViaRouter(message);
  }

  renderOutbound(
    message: any,
    sessionId: string,
    state: State,
    modelOutput: string,
  ): any[] {
    return [
      {
        session_id: sessionId,
        channel: message.channel || "default",
        chat_id: message.chat_id || "default",
        content: modelOutput,
        output_channel: message.output_channel || "default",
        kind: message.kind || "normal",
      },
    ];
  }

  provideTapeStore(): FileTapeStore {
    return new FileTapeStore(`${this.agent.settings.home}/tapes`);
  }

  private async _readAgentsFile(state: State): Promise<string> {
    const workspace = state["_runtime_workspace"] ?? process.cwd();
    const promptPath = join(workspace, AGENTS_FILE_NAME);

    try {
      await fs.access(promptPath);
      const content = await fs.readFile(promptPath, "utf-8");
      return content.trim();
    } catch {
      return "";
    }
  }
}
