import * as os from "os";
import * as path from "path";

export const DEFAULT_MODEL = "openrouter:qwen/qwen3-coder-next";
export const DEFAULT_MAX_TOKENS = 1024;
export const DEFAULT_HOME = process.env.BUB_HOME ?? path.join(os.homedir(), ".bub");

export interface AgentSettings {
  home: string;
  model: string;
  apiKey: string | Record<string, string> | null;
  apiBase: string | Record<string, string> | null;
  maxSteps: number;
  maxTokens: number;
  modelTimeoutSeconds: number | null;
}

/**
 * 从环境变量中读取字符串值。
 * @param key - 环境变量名
 * @returns 环境变量的字符串值，不存在时返回 `undefined`
 */
function getEnv(key: string): string | undefined {
  return process.env[key];
}

/**
 * 从环境变量中读取整数值。
 * @param key - 环境变量名
 * @param defaultValue - 环境变量不存在或无法解析时的默认值
 * @returns 解析后的整数值
 */
function getEnvInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

export class AgentSettingsImpl implements AgentSettings {
  home: string;
  model: string;
  apiKey: string | Record<string, string> | null;
  apiBase: string | Record<string, string> | null;
  maxSteps: number;
  maxTokens: number;
  modelTimeoutSeconds: number | null;

  constructor(data?: Partial<AgentSettings>) {
    this.home = data?.home ?? (process.env.BUB_HOME ?? path.join(os.homedir(), ".bub"));
    this.model = data?.model ?? DEFAULT_MODEL;
    this.apiKey = data?.apiKey ?? null;
    this.apiBase = data?.apiBase ?? null;
    this.maxSteps = data?.maxSteps ?? 50;
    this.maxTokens = data?.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.modelTimeoutSeconds = data?.modelTimeoutSeconds ?? null;
  }

  /**
   * 从环境变量中读取配置并创建 AgentSettingsImpl 实例。
   * 支持单一 API Key/Base 和多提供商模式（`BUB_<PROVIDER>_API_KEY`）。
   * @returns 从环境变量初始化的 AgentSettingsImpl 实例
   */
  static fromEnv(): AgentSettingsImpl {
    const apiKey = getEnv("BUB_API_KEY");
    const apiBase = getEnv("BUB_API_BASE");

    if (apiKey && apiBase) {
      return new AgentSettingsImpl({
        apiKey,
        apiBase,
      });
    }

    const multiApiKey: Record<string, string> = {};
    const multiApiBase: Record<string, string> = {};

    if (apiKey) {
      multiApiKey["default"] = apiKey;
    }
    if (apiBase) {
      multiApiBase["default"] = apiBase;
    }

    const envRegex = /^BUB_(.+)_API_KEY$/;
    const baseRegex = /^BUB_(.+)_API_BASE$/;

    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;

      const keyMatch = key.match(envRegex);
      if (keyMatch) {
        const provider = keyMatch[1].toLowerCase();
        multiApiKey[provider] = value;
        continue;
      }

      const baseMatch = key.match(baseRegex);
      if (baseMatch) {
        const provider = baseMatch[1].toLowerCase();
        multiApiBase[provider] = value;
      }
    }

    return new AgentSettingsImpl({
      apiKey: Object.keys(multiApiKey).length > 0 ? multiApiKey : null,
      apiBase: Object.keys(multiApiBase).length > 0 ? multiApiBase : null,
    });
  }
}
