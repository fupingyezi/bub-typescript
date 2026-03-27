import { ChannelMessage } from "@/channels/message";
import { ChannelManager } from "@/channels/manager";
import { BubFramework } from "@/framework";

export const DEFAULT_CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";

export interface RunOptions {
  message: string;
  channel?: string;
  chatId?: string;
  senderId?: string;
  sessionId?: string | null;
}

/**
 * 处理单条入站消息并返回模型输出。
 * @param options - 运行选项，包含消息内容、channel、chatId 等
 * @param framework - BubFramework 实例
 * @returns 模型输出文本
 */
export async function run(options: RunOptions, framework: BubFramework): Promise<string> {
  const channel = options.channel || "cli";
  const chatId = options.chatId || "default";
  const sessionId = options.sessionId || `${channel}:${chatId}`;

  const message = new ChannelMessage(
    sessionId,
    channel,
    options.message,
    chatId,
    true,
    "normal",
  );

  const result = await framework.processInbound(message);
  return result.modelOutput;
}

/**
 * 列出所有已注册插件的钉子实现报告。
 * @param framework - BubFramework 实例
 * @returns 钉子实现报告字符串
 */
export async function listHooks(framework: BubFramework): Promise<string> {
  const report = framework.hookReport?.();
  if (!report) return "(no hook implementations)";

  const lines: string[] = [];
  for (const [hookName, adapterNames] of Object.entries(report)) {
    lines.push(`${hookName}: ${(adapterNames as string[]).join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * 启动所有已启用的 Channel 并进入消息处理循环（网关模式）。
 * 监听 SIGINT/SIGTERM 信号以优雅关闭。
 * @param framework - BubFramework 实例
 * @param enableChannels - 可选的已启用 channel 名称列表
 */
export async function gateway(framework: BubFramework, enableChannels?: string[]): Promise<void> {
  const manager = new ChannelManager(framework, enableChannels);
  await manager.init();

  // 处理进程退出信号，优雅关闭
  const shutdown = async () => {
    await manager.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await manager.listenAndRun();
}

/**
 * 启动交互式 CLI 聊天界面（仅激活 CLI channel）。
 * 监听 SIGINT/SIGTERM 信号以优雅关闭。
 * @param framework - BubFramework 实例
 * @param chatId - 可选的聊天 ID
 * @param sessionId - 可选的 session ID
 */
export async function chat(framework: BubFramework, chatId?: string, sessionId?: string | null): Promise<void> {
  // 只激活 CLI channel
  const manager = new ChannelManager(framework, ["cli"]);
  await manager.init();

  // 如果指定了 chatId 或 sessionId，通过 CliChannel.setMetadata 设置
  if (chatId !== undefined || sessionId !== undefined) {
    const cliChannel = manager.getChannel("cli") as any;
    if (cliChannel && typeof cliChannel.setMetadata === "function") {
      cliChannel.setMetadata({
        chatId: chatId,
        sessionId: sessionId ?? undefined,
      });
    }
  }

  // 处理进程退出信号，优雅关闭
  const shutdown = async () => {
    await manager.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await manager.listenAndRun();
}

export interface LoginOptions {
  provider: string;
  codexHome?: string;
  openBrowser?: boolean;
  manual?: boolean;
  timeoutSeconds?: number;
}

/**
 * 执行 OAuth 登录流程。
 * @param options - 登录选项，包含 provider、超时等
 * @throws 不支持的 provider 或尚未实现时抛出错误
 */
export async function login(options: LoginOptions): Promise<void> {
  if (options.provider !== "openai") {
    throw new Error(`Unsupported auth provider: ${options.provider}`);
  }
  throw new Error("TODO: cli.login requires OAuth login implementation");
}
