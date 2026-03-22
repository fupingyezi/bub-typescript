import { LLMCore } from "@/core/execution";
import { ErrorPayload } from "@/core/results";
import { ErrorKind } from "@/types";

export class InternalOps {
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
    const resolved = LLMCore.resolveModelProvider(
      modelId,
      provider || undefined,
    );
    return [resolved.provider, resolved.model];
  }

  /**
   * 解析提供商
   * @param provider 提供商名称
   * @returns 提供商名称
   */
  private _resolveProvider(provider: string | null): string {
    return provider || this._core.provider;
  }

  /**
   * 构建错误对象
   * @param exc 原始错误
   * @param options 配置选项
   * @returns 错误载荷
   */
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

  /**
   * 调用responses接口
   * @param inputData 输入数据
   * @param options 配置选项
   * @returns 响应结果
   */
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

  /**
   * 列出可用模型
   * @param options 配置选项
   * @returns 模型列表
   */
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

  /**
   * 创建批量任务
   * @param inputFilePath 输入文件路径
   * @param endpoint 端点
   * @param options 配置选项
   * @returns 批量任务结果
   */
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

  /**
   * 获取批量任务
   * @param batchId 批量任务ID
   * @param options 配置选项
   * @returns 批量任务结果
   */
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

  /**
   * 取消批量任务
   * @param batchId 批量任务ID
   * @param options 配置选项
   * @returns 取消结果
   */
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

  /**
   * 列出批量任务
   * @param options 配置选项
   * @returns 批量任务列表
   */
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
