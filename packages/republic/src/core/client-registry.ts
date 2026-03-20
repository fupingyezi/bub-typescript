import { ChatOpenAI } from "@langchain/openai";

export interface LLMConfig {
  model: string;
  provider?: string; // 设为可选
  apiKey?: string;
  apiBaseUrl?: string;
  configuration?: Record<string, any>;
}

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
