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

/**
 * CLI 交互界面 Channel，提供基于命令行的交互式对话界面。
 * 支持代理模式和 shell 模式切换、命令补全和历史记录。
 */
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

  /**
   * 启动 CLI 主循环。
   * @param stop_event - 停止信号对象
   */
  async start(stop_event: { isSet: () => boolean }): Promise<void> {
    this._stop_event = false;
    this._main_task = this._main_loop(stop_event);
  }

  /**
   * 停止 CLI 主循环并关闭 readline 界面。
   */
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

  /**
   * 将出站消息输出到终端。
   * 根据消息类型选择错误、命令输出或普通助手输出格式。
   * @param message - 出站的 ChannelMessage
   */
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

  /**
   * CLI 主循环：显示欢迎信息、初始化 readline，并循环读取用户输入。
   * @param stop_event - 停止信号对象
   */
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
          request,
          this._message_template.chat_id,
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

  /**
   * 显示命令行提示符并等待用户输入。
   * @returns 用户输入的字符串（已去除首尾空白）
   * @throws 用户按下 Ctrl+C 时抛出 SIGINT 错误
   */
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

  /**
   * 将用户输入规范化：在 shell 模式下，非命令输入会自动加上 `,` 前缀。
   * @param raw - 用户原始输入
   * @returns 规范化后的输入字符串
   */
  private _normalizeInput(raw: string): string {
    if (this._mode !== "shell") {
      return raw;
    }
    if (raw.startsWith(",")) {
      return raw;
    }
    return `,${raw}`;
  }

  /**
   * 创建 Tab 补全器，根据已注册的工具名称进行补全。
   * @returns readline 补全器函数
   */
  private _createCompleter(): (line: string) => [string[], string] {
    return (line: string) => {
      const toolNames = Object.keys(REGISTRY).map((name) => `,${name}`);
      const hits = toolNames.filter((name) => name.startsWith(line));
      return [hits, line];
    };
  }

  /**
   * 设置键盘绑定：SIGTSTP 和 Ctrl+X 模式切换。
   */
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

  /**
   * 从历史文件中加载命令历史记录。
   * @returns 历史命令字符串数组
   */
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

  /**
   * 将命令追加到历史文件。
   * @param command - 要保存的命令字符串
   */
  private async _saveHistory(command: string): Promise<void> {
    try {
      const historyFile = this._historyFile();
      await fs.appendFile(historyFile, command + "\n");
    } catch {
      // Ignore history save errors
    }
  }

  /**
   * 获取当前工作区对应的历史文件路径。
   * 历史文件以工作区路径的 MD5 哈希命名。
   * @returns 历史文件的绝对路径
   */
  private _historyFile(): string {
    const workspaceHash = createHash("md5")
      .update(this._workspace)
      .digest("hex");
    const historyDir = join(this._agent.settings.home, "history");
    return join(historyDir, `${workspaceHash}.history`);
  }

  /**
   * 刷新当前 tape 的概要信息并更新 `_last_tape_info`。
   */
  private async _refreshTapeInfo(): Promise<void> {
    const tape = this._agent.tapes.sessionTape(
      this._message_template.session_id,
      this._workspace,
    );
    this._last_tape_info = await this._agent.tapes.info(tape.name);
  }

  /**
   * 设置 CLI 会话元数据（sessionId 和 chatId）。
   * @param options - 包含可选 sessionId 和 chatId 的对象
   */
  setMetadata(options: { sessionId?: string; chatId?: string }): void {
    if (options.sessionId !== undefined) {
      this._message_template.session_id = options.sessionId;
    }
    if (options.chatId !== undefined) {
      this._message_template.chat_id = options.chatId;
    }
  }
}
