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

/**
 * bub 内置插件实现，实现了核心的所有钉子接口。
 * 负责会话解析、状态加载/保存、prompt 构建、模型调用、消息分发等。
 */
export class BuiltinImpl {
  private _framework: BubFramework;
  public agent: Agent;

  constructor(framework: BubFramework) {
    require("./tools");
    this._framework = framework;
    this.agent = new Agent(framework);
  }

  /**
   * 解析当前消息的 session ID。
   * 优先使用 `message.sessionId`，否则拼接 `channel:chatId`。
   * @param message - 入站消息
   * @returns session ID 字符串
   */
  resolveSession(message: ChannelMessage): string {
    const sessionId = message.sessionId;
    if (sessionId && String(sessionId).trim()) {
      return String(sessionId);
    }
    const channel = String(message.channel || "default");
    const chatId = String(message.chatId || "default");
    return `${channel}:${chatId}`;
  }

  /**
   * 加载运行时状态，并在必要时调用 lifespan.enter。
   * @param message - 入站消息
   * @param sessionId - 当前 session ID
   * @returns 包含 sessionId 和 _runtime_agent 的状态对象
   */
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

  /**
   * 保存运行时状态，并在必要时调用 lifespan.exit。
   * @param sessionId - 当前 session ID
   * @param state - 运行时状态对象
   * @param message - 入站消息
   * @param modelOutput - 模型输出文本
   */
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

  /**
   * 构建模型输入的 prompt。
   * 若消息内容以 `,` 开头，则标记为命令类型并直接返回内容。
   * 否则拼接上下文和时间戳前缀，并处理多媒体内容。
   * @param message - 入站消息
   * @param sessionId - 当前 session ID
   * @param state - 运行时状态对象
   * @returns 构建好的 prompt（字符串或多模态数组）
   */
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

  /**
   * 调用 Agent 执行模型推理。
   * @param prompt - 构建好的 prompt
   * @param sessionId - 当前 session ID
   * @param state - 运行时状态对象
   * @returns 模型输出文本
   */
  async runModel(
    prompt: string | Record<string, any>[],
    sessionId: string,
    state: State,
  ): Promise<string> {
    return await this.agent.run(sessionId, prompt, state);
  }

  /**
   * 向 CLI 应用注册内置命令：run、chat、login、hooks、gateway。
   * @param app - CLI 应用对象
   */
  registerCliCommands(app: any): void {
    app.command("run")(run);
    app.command("chat")(chat);
    app.command("login")(login);
    app.command("hooks", { hidden: true })(listHooks);
    app.command("message", { hidden: true })(app.command("gateway")(gateway));
  }

  /**
   * 返回系统提示词，包含默认指令和 AGENTS.md 文件内容。
   * @param prompt - 当前用户 prompt
   * @param state - 运行时状态对象
   * @returns 系统提示词字符串
   */
  async systemPrompt(
    prompt: string | Record<string, any>[],
    state: State,
  ): Promise<string> {
    const agentsContent = await this._readAgentsFile(state);
    return DEFAULT_SYSTEM_PROMPT + "\n\n" + agentsContent;
  }

  /**
   * 提供内置的 Channel 列表：TelegramChannel 和 CliChannel。
   * @param messageHandler - 消息处理回调函数
   * @returns Channel 实例数组
   */
  provideChannels(messageHandler: MessageHandler): any[] {
    return [
      new TelegramChannel(messageHandler),
      new CliChannel({ onReceive: messageHandler, agent: this.agent }),
    ];
  }

  /**
   * 错误处理钉子：将错误信息作为出站消息分发。
   * @param stage - 发生错误的处理阶段名称
   * @param error - 错误对象
   * @param message - 触发错误的原始消息
   */
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

  /**
   * 分发出站消息：记录日志并通过路由器转发。
   * @param message - 出站消息信封
   * @returns 分发成功返回 `true`，否则返回 `false`
   */
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

  /**
   * 将模型输出渲染为出站消息对象数组。
   * @param message - 入站消息
   * @param sessionId - 当前 session ID
   * @param state - 运行时状态对象
   * @param modelOutput - 模型输出文本
   * @returns 出站消息对象数组
   */
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

  /**
   * 提供内置的 FileTapeStore 实例。
   * @returns 以 `{home}/tapes` 为存储目录的 FileTapeStore
   */
  provideTapeStore(): FileTapeStore {
    return new FileTapeStore(`${this.agent.settings.home}/tapes`);
  }

  /**
   * 读取工作区中的 AGENTS.md 文件内容。
   * @param state - 运行时状态对象，用于获取工作区路径
   * @returns AGENTS.md 的文本内容，文件不存在时返回空字符串
   */
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
