import { ChatOpenAI } from "@langchain/openai";

export interface LLMConfig {
  model: string;
  provider: string;
  apiKey?: string;
  apiBaseUrl?: string;
  configuration?: Record<string, any>;
}

export function createLangchainLLMClient(config: LLMConfig): ChatOpenAI {
  const { model, provider, apiKey, apiBaseUrl, configuration } = config;

  return new ChatOpenAI({
    model,
    apiKey,
    configuration: apiBaseUrl ? { baseURL: apiBaseUrl } : undefined,
    ...configuration,
  });
}
