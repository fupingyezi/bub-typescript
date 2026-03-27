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

export async function listHooks(framework: BubFramework): Promise<string> {
  const report = framework.hookReport?.();
  if (!report) return "(no hook implementations)";

  const lines: string[] = [];
  for (const [hookName, adapterNames] of Object.entries(report)) {
    lines.push(`${hookName}: ${(adapterNames as string[]).join(", ")}`);
  }
  return lines.join("\n");
}

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

export async function login(options: LoginOptions): Promise<void> {
  if (options.provider !== "openai") {
    throw new Error(`Unsupported auth provider: ${options.provider}`);
  }
  throw new Error("TODO: cli.login requires OAuth login implementation");
}
