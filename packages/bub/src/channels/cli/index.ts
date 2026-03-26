import * as readline from "readline";
import { createInterface } from "readline";
import { EventEmitter } from "events";
import { promises as fs } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import chalk from "chalk";

import { Agent, TapeInfo } from "@/builtin";
import { CliRenderer } from "./render";
import { ChannelMessage } from "../message";
import { contentOf } from "@/envelope";
import { REGISTRY } from "@/tools";
import { MessageHandler } from "@/types";

export { CliRenderer };

export class CliChannel extends EventEmitter {
  name = "cli";
  private _stop_event: boolean = false;
  private _on_receive: MessageHandler;
  private _agent: Agent;
  private _message_template: Record<string, string>;
  private _mode: "agent" | "shell" = "agent";
  private _main_task: Promise<void> | null = null;
  private _renderer: CliRenderer;
  private _workspace: string;
  private _last_tape_info: TapeInfo | null = null;
  private _rl: readline.Interface | null = null;

  constructor(options: { onReceive: MessageHandler; agent: Agent }) {
    super();
    this._on_receive = options.onReceive;
    this._agent = options.agent;
    this._message_template = {
      chat_id: "cli_chat",
      channel: this.name,
      session_id: "cli_session",
    };
    this._renderer = new CliRenderer();
    this._workspace = process.cwd();
  }

  async start(stop_event: { isSet: () => boolean }): Promise<void> {
    this._stop_event = false;
    this._main_task = this._main_loop(stop_event);
  }

  async stop(): Promise<void> {
    this._stop_event = true;
    if (this._rl) {
      this._rl.close();
      this._rl = null;
    }
    if (this._main_task) {
      try {
        await this._main_task;
      } catch (error) {
        // Ignore cancellation errors
      }
    }
  }

  async send(message: ChannelMessage): Promise<void> {
    const content = contentOf(message);
    switch (message.kind) {
      case "error":
        this._renderer.error(content);
        break;
      case "command":
        this._renderer.commandOutput(content);
        break;
      default:
        this._renderer.assistantOutput(content);
        break;
    }
  }

  private async _main_loop(stop_event: {
    isSet: () => boolean;
  }): Promise<void> {
    this._renderer.welcome({
      model: this._agent.settings.model,
      workspace: this._workspace,
    });

    await this._refreshTapeInfo();

    this._rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      completer: this._createCompleter(),
      history: await this._loadHistory(),
    });

    this._setupKeyBindings();

    while (!this._stop_event && !stop_event.isSet()) {
      try {
        const raw = await this._prompt();
        if (!raw) continue;

        if (raw === ",quit" || raw === ",exit") {
          break;
        }

        const request = this._normalizeInput(raw);
        const message = new ChannelMessage(
          this._message_template.session_id,
          this._message_template.channel,
          this._message_template.chat_id,
          request,
        );

        this._renderer.info("Processing...");
        try {
          await this._on_receive(message);
        } finally {
          await this._refreshTapeInfo();
        }
      } catch (error) {
        if (error instanceof Error && error.message === "SIGINT") {
          this._renderer.info("Interrupted. Use ',quit' to exit.");
          continue;
        }
        break;
      }
    }

    this._renderer.info("Bye.");
    this._stop_event = true;
  }

  private async _prompt(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this._rl) {
        reject(new Error("Readline interface not initialized"));
        return;
      }

      const cwd = require("path").basename(process.cwd());
      const symbol = this._mode === "agent" ? ">" : ",";
      const prompt = chalk.bold(`${cwd} ${symbol} `);

      this._rl.question(prompt, (answer) => {
        resolve(answer.trim());
      });

      this._rl.on("SIGINT", () => {
        reject(new Error("SIGINT"));
      });
    });
  }

  private _normalizeInput(raw: string): string {
    if (this._mode !== "shell") {
      return raw;
    }
    if (raw.startsWith(",")) {
      return raw;
    }
    return `,${raw}`;
  }

  private _createCompleter(): (line: string) => [string[], string] {
    return (line: string) => {
      const toolNames = Object.keys(REGISTRY).map((name) => `,${name}`);
      const hits = toolNames.filter((name) => name.startsWith(line));
      return [hits, line];
    };
  }

  private _setupKeyBindings(): void {
    if (!this._rl) return;

    this._rl.on("SIGTSTP", () => {
      // Handle Ctrl+Z
      process.emit("SIGTSTP");
    });

    // Simple mode toggle with Ctrl+X (simplified implementation)
    process.stdin.setRawMode(true);
    process.stdin.on("data", (key) => {
      if (key[0] === 24) {
        // Ctrl+X
        this._mode = this._mode === "agent" ? "shell" : "agent";
        this._renderer.info(`Switched to ${this._mode} mode`);
      }
    });
  }

  private async _loadHistory(): Promise<string[]> {
    try {
      const historyFile = this._historyFile();
      await fs.access(historyFile);
      const content = await fs.readFile(historyFile, "utf-8");
      return content.split("\n").filter((line) => line.trim());
    } catch {
      return [];
    }
  }

  private async _saveHistory(command: string): Promise<void> {
    try {
      const historyFile = this._historyFile();
      await fs.appendFile(historyFile, command + "\n");
    } catch {
      // Ignore history save errors
    }
  }

  private _historyFile(): string {
    const workspaceHash = createHash("md5")
      .update(this._workspace)
      .digest("hex");
    const historyDir = join(this._agent.settings.home, "history");
    return join(historyDir, `${workspaceHash}.history`);
  }

  private async _refreshTapeInfo(): Promise<void> {
    const tape = this._agent.tapes.sessionTape(
      this._message_template.session_id,
      this._workspace,
    );
    this._last_tape_info = await this._agent.tapes.info(tape.name);
  }

  setMetadata(options: { sessionId?: string; chatId?: string }): void {
    if (options.sessionId !== undefined) {
      this._message_template.session_id = options.sessionId;
    }
    if (options.chatId !== undefined) {
      this._message_template.chat_id = options.chatId;
    }
  }
}
