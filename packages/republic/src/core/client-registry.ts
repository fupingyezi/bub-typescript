import { ChatOpenAI } from "@langchain/openai";

/**
 * LLM配置接口
 */
export interface LLMConfig {
  /**
   * 模型名称
   */
  model: string;
  /**
   * 提供商名称
   */
  provider?: string;
  /**
   * API密钥
   */
  apiKey?: string;
  /**
   * API基础URL
   */
  apiBaseUrl?: string;
  /**
   * 配置选项
   */
  configuration?: Record<string, any>;
}

/**
 * 创建LangChain LLM客户端
 * @param config LLM配置
 * @returns ChatOpenAI客户端
 */
export function createLangchainLLMClient(config: LLMConfig): ChatOpenAI {
  const { model, provider, apiKey, apiBaseUrl, configuration } = config;

  // 如果没有显式提供 provider，从 model 字符串中解析
  const resolvedProvider =
    provider || (model.includes(":") ? model.split(":")[0] : "unknown");

  // 打印 provider 信息用于调试
  if (provider || !model.includes(":")) {
    console.log(`[LLM] Using provider: ${resolvedProvider}, model: ${model}`);
  }

  return new ChatOpenAI({
    model,
    apiKey,
    configuration: apiBaseUrl ? { baseURL: apiBaseUrl } : undefined,
    ...configuration,
  });
}
