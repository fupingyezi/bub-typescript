import { LLMCore } from "@/core/execution";
import { ErrorPayload } from "@/core/results";

export class EmbeddingClient {
  private _core: LLMCore;

  constructor(core: LLMCore) {
    this._core = core;
  }

  private _resolveProviderModel(
    model: string | null,
    provider: string | null,
  ): [string, string] {
    if (model === null && provider === null) {
      return [this._core.provider, this._core.model];
    }
    const modelId = model || this._core.model;
    const resolved = LLMCore.resolveModelProvider(
      modelId,
      provider || undefined,
    );
    return [resolved.provider, resolved.model];
  }

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
    const client = await this._core.getClient(providerName);
    try {
      const response = await (client as any)._embedding({
        model: modelId,
        inputs,
        ...kwargs,
      });
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
