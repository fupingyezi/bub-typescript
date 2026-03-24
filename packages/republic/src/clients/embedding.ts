import { LLMCore } from "@/core/execution";
import { ErrorPayload } from "@/core/results";

export class EmbeddingClient {
  private _core: LLMCore;

  constructor(core: LLMCore) {
    this._core = core;
  }

  /**
   * 解析提供商和模型
   * @param model 模型名称
   * @param provider 提供商名称
   * @returns [provider, model]元组
   */
  private _resolveProviderModel(
    model: string | null,
    provider: string | null,
  ): [string, string] {
    if (model === null && provider === null) {
      return [this._core.provider, this._core.model];
    }
    const modelId = model || this._core.model;
    const resolvedProvider = provider || this._core.provider;
    const resolved = LLMCore.resolveModelProvider(modelId, resolvedProvider);
    return [resolved.provider, resolved.model];
  }

  /**
   * 获取文本嵌入
   * @param inputs 输入文本或文本数组
   * @param options 配置选项
   * @returns 嵌入结果
   */
  async embed(
    inputs: string | string[],
    options: {
      model?: string | null;
      provider?: string | null;
      [key: string]: any;
    } = {},
  ): Promise<any> {
    const { model = null, provider = null, ...kwargs } = options;
    const [providerName, modelId] = this._resolveProviderModel(model, provider);
    const client = await this._core.getEmbeddingsClient(providerName, modelId);
    try {
      let response;
      if (typeof inputs === "string") {
        response = await client.embedQuery(inputs);
      } else {
        response = await client.embedDocuments(inputs);
      }
      return response;
    } catch (exc) {
      const kind = this._core.classifyException(exc as Error);
      const error = this._core.wrapError(
        exc as Error,
        kind,
        providerName,
        modelId,
      );
      throw new ErrorPayload(kind, error.message);
    }
  }
}
