export const DEFAULT_CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";

export interface RunOptions {
  message: string;
  channel?: string;
  chatId?: string;
  senderId?: string;
  sessionId?: string | null;
}

export async function run(options: RunOptions, framework: any): Promise<string> {
  throw new Error("TODO: cli.run requires framework.processInbound implementation");
}

export async function listHooks(framework: any): Promise<string> {
  const report = framework.hookReport?.();
  if (!report) return "(no hook implementations)";

  const lines: string[] = [];
  for (const [hookName, adapterNames] of Object.entries(report)) {
    lines.push(`${hookName}: ${(adapterNames as string[]).join(", ")}`);
  }
  return lines.join("\n");
}

export async function gateway(framework: any, enableChannels?: string[]): Promise<void> {
  throw new Error("TODO: cli.gateway requires ChannelManager implementation");
}

export async function chat(framework: any, chatId?: string, sessionId?: string | null): Promise<void> {
  throw new Error("TODO: cli.chat requires ChannelManager and CLI channel implementation");
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
