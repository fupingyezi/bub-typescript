import { LLMCore } from "@/core/execution";
import { ErrorPayload } from "@/core/results";
import { ErrorKind } from "@/types";

export class InternalOps {
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

  private _resolveProvider(provider: string | null): string {
    return provider || this._core.provider;
  }

  private _error(
    exc: Error,
    options: {
      provider: string;
      model: string | null;
      operation: string;
    },
  ): ErrorPayload {
    let kind = this._core.classifyException(exc);
    if (exc.name === "NotImplementedError") {
      kind = ErrorKind.INVALID_INPUT;
    }
    const message = options.model
      ? `${options.provider}:${options.model}: ${exc.message}`
      : `${options.provider}: ${exc.message}`;
    return new ErrorPayload(kind, message, { operation: options.operation });
  }

  async responses(
    inputData: any,
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
      const value = await (client as any).responses({
        model: modelId,
        input_data: inputData,
        ...kwargs,
      });
      return value;
    } catch (exc) {
      throw this._error(exc as Error, {
        provider: providerName,
        model: modelId,
        operation: "responses",
      });
    }
  }

  async listModels(
    options: {
      provider?: string | null;
      [key: string]: any;
    } = {},
  ): Promise<any> {
    const { provider = null, ...kwargs } = options;
    const providerName = this._resolveProvider(provider);
    const client = await this._core.getClient(providerName);
    try {
      const value = await (client as any).listModels(kwargs);
      return value;
    } catch (exc) {
      throw this._error(exc as Error, {
        provider: providerName,
        model: null,
        operation: "list_models",
      });
    }
  }

  async createBatch(
    inputFilePath: string,
    endpoint: string,
    options: {
      completionWindow?: string;
      metadata?: Record<string, string> | null;
      provider?: string | null;
      [key: string]: any;
    } = {},
  ): Promise<any> {
    const {
      completionWindow = "24h",
      metadata = null,
      provider = null,
      ...kwargs
    } = options;
    const providerName = this._resolveProvider(provider);
    const client = await this._core.getClient(providerName);
    try {
      const value = await (client as any).createBatch({
        input_file_path: inputFilePath,
        endpoint,
        completion_window: completionWindow,
        metadata,
        ...kwargs,
      });
      return value;
    } catch (exc) {
      throw this._error(exc as Error, {
        provider: providerName,
        model: null,
        operation: "create_batch",
      });
    }
  }

  async retrieveBatch(
    batchId: string,
    options: {
      provider?: string | null;
      [key: string]: any;
    } = {},
  ): Promise<any> {
    const { provider = null, ...kwargs } = options;
    const providerName = this._resolveProvider(provider);
    const client = await this._core.getClient(providerName);
    try {
      const value = await (client as any).retrieveBatch({
        batch_id: batchId,
        ...kwargs,
      });
      return value;
    } catch (exc) {
      throw this._error(exc as Error, {
        provider: providerName,
        model: null,
        operation: "retrieve_batch",
      });
    }
  }

  async cancelBatch(
    batchId: string,
    options: {
      provider?: string | null;
      [key: string]: any;
    } = {},
  ): Promise<any> {
    const { provider = null, ...kwargs } = options;
    const providerName = this._resolveProvider(provider);
    const client = await this._core.getClient(providerName);
    try {
      const value = await (client as any).cancelBatch({
        batch_id: batchId,
        ...kwargs,
      });
      return value;
    } catch (exc) {
      throw this._error(exc as Error, {
        provider: providerName,
        model: null,
        operation: "cancel_batch",
      });
    }
  }

  async listBatches(
    options: {
      provider?: string | null;
      after?: string | null;
      limit?: number | null;
      [key: string]: any;
    } = {},
  ): Promise<any> {
    const { provider = null, after = null, limit = null, ...kwargs } = options;
    const providerName = this._resolveProvider(provider);
    const client = await this._core.getClient(providerName);
    try {
      const value = await (client as any).listBatches({
        after,
        limit,
        ...kwargs,
      });
      return value;
    } catch (exc) {
      throw this._error(exc as Error, {
        provider: providerName,
        model: null,
        operation: "list_batches",
      });
    }
  }
}
