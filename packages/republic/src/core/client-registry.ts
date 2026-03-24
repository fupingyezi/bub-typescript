import { ChatOpenAI } from "@langchain/openai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { ZhipuAIEmbeddings } from "@langchain/community/embeddings/zhipuai";

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

  let resolvedProvider = provider || "unknown";
  let resolvedModel = model;

  if (!provider && model.includes(":")) {
    const parts = model.split(":");
    resolvedProvider = parts[0];
    resolvedModel = parts.slice(1).join(":");
  }

  console.log(
    `[LLM] Using provider: ${resolvedProvider}, model: ${resolvedModel}`,
  );

  return new ChatOpenAI({
    model: resolvedModel,
    apiKey,
    configuration: apiBaseUrl ? { baseURL: apiBaseUrl } : undefined,
    ...configuration,
  });
}

/**
 * Embeddings配置接口
 */
export interface EmbeddingsConfig {
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
 * 创建LangChain Embeddings客户端
 * @param config Embeddings配置
 * @returns Embeddings客户端
 */
export function createEmbeddingsClient(
  config: EmbeddingsConfig,
): OpenAIEmbeddings | ZhipuAIEmbeddings {
  const { model, provider, apiKey, apiBaseUrl, configuration } = config;

  let resolvedProvider = provider || "unknown";
  let resolvedModel = model;

  if (!provider && model.includes(":")) {
    const parts = model.split(":");
    resolvedProvider = parts[0];
    resolvedModel = parts.slice(1).join(":");
  }

  console.log(
    `[LLM] Using provider: ${resolvedProvider}, model: ${resolvedModel}`,
  );

  if (resolvedProvider === "zhipu" || resolvedProvider === "z.ai") {
    if (resolvedModel === "embedding-2" || resolvedModel === "embedding-3")
      return new ZhipuAIEmbeddings({
        modelName: resolvedModel,
        apiKey,
        ...configuration,
      });
    else
      return new ZhipuAIEmbeddings({
        modelName: "embedding-3",
        apiKey,
        ...configuration,
      });
  }

  return new OpenAIEmbeddings({
    model: resolvedModel,
    apiKey,
    configuration: apiBaseUrl ? { baseURL: apiBaseUrl } : undefined,
    ...configuration,
  });
}
