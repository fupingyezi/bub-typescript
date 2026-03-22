import { ChatOpenAI } from "@langchain/openai";
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  ToolMessage,
  BaseMessage,
} from "@langchain/core/messages";
import { createLangchainLLMClient } from "./client-registry";
import { ErrorKindType, ErrorKind } from "@/types";
import { RepbulicError } from "./errors";

export type AttemptDecision = "retry_same_model" | "retry_next_model";

export type AttemptOutCome = {
  error: RepbulicError;
  decision: AttemptDecision;
};

export type TransportKind = "invoke" | "stream";

export type StreamMode = "messages" | "updates" | "values";

export type TransportResponse = {
  transport: TransportKind;
  streamMode?: StreamMode;
  payload: any;
};

export type TransportCallRequest = {
  client: ChatOpenAI;
  providerName: string;
  modelId: string;
  messagePayload: Record<string, any>[];
  toolsPayload: Record<string, any>[] | undefined;
  maxTokens: number | undefined;
  stream: boolean;
  reasoningEffort: any | undefined;
  kwargs: Record<string, any>;
};

export class LLMCore {
  private _provider: string;
  private _model: string;
  private _fallback_models: string[];
  private _max_retries: number;
  private _api_key: string | Record<string, string> | undefined;
  private _api_key_resolver: (
    key: string,
  ) => Promise<string | undefined> | undefined;
  private _api_base: string | Record<string, string> | undefined;
  private _client_args: Record<string, any> | undefined;
  private _api_format: "invoke" | "stream";
  private _verbose: number; // 详细程度级别，0-不详细，1-详细，2-详细且包含调试信息
  private _error_classifier: (error: Error) => ErrorKindType | undefined;
  private _client_cache: Record<string, any> = {};

  constructor(
    provider: string,
    model: string,
    fallback_models: string[],
    max_retries: number,
    api_key: string | Record<string, string> | undefined,
    api_key_resolver: (key: string) => Promise<string | undefined> | undefined,
    api_base: string | Record<string, string> | undefined,
    client_args: Record<string, any> | undefined,
    api_format: "invoke" | "stream",
    verbose: number,
    error_classifier: (error: Error) => ErrorKindType | undefined,
  ) {
    this._provider = provider;
    this._model = model;
    this._fallback_models = fallback_models;
    this._max_retries = max_retries;
    this._api_key = api_key;
    this._api_key_resolver = api_key_resolver;
    this._api_base = api_base;
    this._client_args = client_args;
    this._api_format = api_format;
    this._verbose = verbose;
    this._error_classifier = error_classifier;
  }

  /**
   * 获取提供商名称
   * @returns 提供商名称
   */
  get provider(): string {
    return this._provider;
  }

  /**
   * 获取模型名称
   * @returns 模型名称
   */
  get model(): string {
    return this._model;
  }

  /**
   * 获取备用模型列表
   * @returns 备用模型列表
   */
  get fallback_models(): string[] {
    return this._fallback_models;
  }

  /**
   * 获取最大重试次数
   * @returns 最大重试次数
   */
  get max_retries(): number {
    return this._max_retries;
  }

  /**
   * 获取最大尝试次数
   * @returns 最大尝试次数
   */
  maxAttempts(): number {
    return Math.max(this._max_retries + 1, 1);
  }

  /**
   * 解析模型提供商
   * @param model 模型名称，可以是"provider:model"格式或仅模型名称
   * @param provider 提供商名称，可选
   * @returns 包含provider和model的对象
   */
  static resolveModelProvider(
    model: string,
    provider: string | undefined,
  ): Record<string, any> {
    if (provider) {
      if (model.includes(":")) {
        throw new RepbulicError(
          ErrorKind.INVALID_INPUT,
          "Model name cannot contain ':'",
        );
      }
      console.log(
        `[LLMCore] Using explicit provider: ${provider} for model: ${model}`,
      );
      return {
        provider,
        model,
      };
    }

    // 如果没有提供 provider，尝试从 model 字符串中解析
    if (model.includes(":")) {
      const [providerName, modelId] = model.split(":");
      if (!providerName || !modelId) {
        throw new RepbulicError(
          ErrorKind.INVALID_INPUT,
          "Model must be in 'provider:model' format.",
        );
      }
      console.log(
        `[LLMCore] Auto-resolved provider: ${providerName} for model: ${modelId}`,
      );
      return {
        provider: providerName,
        model: modelId,
      };
    }

    // 如果没有提供 provider 且 model 不包含分隔符，使用默认 provider
    console.log(
      `[LLMCore] No provider specified, using default "unknown" for model: ${model}`,
    );
    return {
      provider: "unknown",
      model,
    };
  }

  /**
   * 解析备用模型
   * @param model 备用模型名称，可以是"provider:model"格式或仅模型名称
   * @returns 包含provider和model的对象
   */
  resolveFallback(model: string): Record<string, any> {
    if (model.includes(":")) {
      const [providerName, modelId] = model.split(":");
      if (!providerName || !modelId) {
        throw new RepbulicError(
          ErrorKind.INVALID_INPUT,
          "Fallback models must be in 'provider:model' format.",
        );
      }
      return {
        provider: providerName,
        model: modelId,
      };
    }
    if (this._provider) {
      return {
        provider: this._provider,
        model: model,
      };
    }
    throw new RepbulicError(
      ErrorKind.INVALID_INPUT,
      "Fallback models must include provider or LLM must be initialized with a provider.",
    );
  }

  /**
   * 获取模型候选列表
   * @param overrideModel 覆盖的模型名称，可选
   * @param overrideProvider 覆盖的提供商名称，可选
   * @returns 模型候选列表，每个元素是[provider, model]的元组
   */
  modelCandidates(
    overrideModel: string | undefined,
    overrideProvider: string | undefined,
  ): Array<[string, string]> {
    if (overrideModel) {
      const resolved = LLMCore.resolveModelProvider(
        overrideModel,
        overrideProvider,
      );
      return [[resolved.provider, resolved.model]];
    }

    const candidates: Array<[string, string]> = [[this._provider, this._model]];
    for (const model of this._fallback_models) {
      const resolved = this.resolveFallback(model);
      candidates.push([resolved.provider, resolved.model]);
    }
    return candidates;
  }

  /**
   * 迭代获取客户端实例
   * @param overrideModel 覆盖的模型名称，可选
   * @param overrideProvider 覆盖的提供商名称，可选
   * @returns 异步生成器，产生[provider, model, client]的元组
   */
  async *iterClients(
    overrideModel: string | undefined,
    overrideProvider: string | undefined,
  ): AsyncGenerator<[string, string, ChatOpenAI]> {
    for (const [providerName, modelId] of this.modelCandidates(
      overrideModel,
      overrideProvider,
    )) {
      yield [providerName, modelId, await this.getClient(providerName)];
    }
  }

  /**
   * 解析API密钥
   * @param provider 提供商名称
   * @returns API密钥
   */
  private async _resolveApiKey(provider: string): Promise<string | undefined> {
    if (typeof this._api_key === "object" && this._api_key !== null) {
      const key = this._api_key[provider];
      if (key !== undefined) {
        return key;
      }
      if (this._api_key_resolver) {
        const resolvedKey = this._api_key_resolver(provider);
        return resolvedKey instanceof Promise ? await resolvedKey : resolvedKey;
      }
      return undefined;
    }
    if (this._api_key !== undefined) {
      return this._api_key;
    }
    if (this._api_key_resolver) {
      const resolvedKey = this._api_key_resolver(provider);
      return resolvedKey instanceof Promise ? await resolvedKey : resolvedKey;
    }
    return undefined;
  }

  /**
   * 解析API基础URL
   * @param provider 提供商名称
   * @returns API基础URL
   */
  private _resolveApiBase(provider: string): string | undefined {
    if (typeof this._api_base === "object" && this._api_base !== null) {
      return this._api_base[provider];
    }
    return this._api_base;
  }

  /**
   * 生成缓存键
   * @param provider 提供商名称
   * @param apiKey API密钥
   * @param apiBase API基础URL
   * @returns 缓存键
   */
  private _freezeCacheKey(
    provider: string,
    apiKey: string | undefined,
    apiBase: string | undefined,
  ): string {
    const _freeze = (value: any): any => {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
      ) {
        return value;
      }
      if (Array.isArray(value)) {
        return value.map(_freeze);
      }
      if (typeof value === "object" && value !== null) {
        const result: Record<string, any> = {};
        const sortedKeys = Object.keys(value).sort();
        for (const key of sortedKeys) {
          result[key] = _freeze(value[key]);
        }
        return result;
      }
      return String(value);
    };

    const payload = {
      provider,
      api_key: apiKey,
      api_base: apiBase,
      client_args: _freeze(this._client_args),
    };
    return JSON.stringify(payload);
  }

  /**
   * 根据对应供应商获取相关的client实例
   * @param provider
   * @returns Langchian的ChatOpenAI实例
   */
  async getClient(provider: string): Promise<ChatOpenAI> {
    const apiKey = await this._resolveApiKey(provider);
    const apiBase = this._resolveApiBase(provider);
    const cacheKey = this._freezeCacheKey(provider, apiKey, apiBase);

    if (!(cacheKey in this._client_cache)) {
      const client = createLangchainLLMClient({
        provider,
        model: this._model,
        apiKey,
        apiBaseUrl: apiBase,
        configuration: this._client_args,
      });
      this._client_cache[cacheKey] = client;
    }
    return this._client_cache[cacheKey];
  }

  /**
   * 记录错误
   * @param error 错误对象
   * @param provider 提供商名称
   * @param model 模型ID
   * @param attempt 尝试次数
   */
  private logError(
    error: RepbulicError,
    provider: string,
    model: string,
    attempt: number,
  ): void {
    if (this._verbose === 0) {
      return;
    }

    const prefix = `[${provider}:${model}] attempt ${attempt + 1}/${this.maxAttempts()}`;
    if (error.cause) {
      console.warn(`${prefix} failed: ${error} (cause=${error.cause})`);
    } else {
      console.warn(`${prefix} failed: ${error}`);
    }
  }

  /**
   * 提取错误状态码
   * @param exc 异常对象
   * @returns 状态码
   */
  private static _extractStatusCode(exc: Error): number | undefined {
    const status = (exc as any).status_code;
    if (typeof status === "number") {
      return status;
    }

    const response = (exc as any).response;
    const responseStatus = response?.status_code;
    if (typeof responseStatus === "number") {
      return responseStatus;
    }
    return undefined;
  }

  /**
   * 检查文本是否匹配任一模式
   * @param text 文本
   * @param patterns 模式列表
   * @returns 是否匹配
   */
  private static _textMatches(text: string, patterns: string[]): boolean {
    return patterns.some((pattern) => new RegExp(pattern, "i").test(text));
  }

  /**
   * 根据HTTP状态码分类异常
   * @param exc 异常对象
   * @returns 异常类型
   */
  private _classifyByHttpStatus(exc: Error): ErrorKindType | undefined {
    const status = LLMCore._extractStatusCode(exc);
    if (status === 401 || status === 403) {
      return ErrorKind.CONFIG;
    }
    if ([400, 404, 413, 422].includes(status!)) {
      return ErrorKind.INVALID_INPUT;
    }
    if ([408, 409, 425, 429].includes(status!)) {
      return ErrorKind.TEMPORARY;
    }
    if (status !== undefined && status >= 500 && status < 600) {
      return ErrorKind.PROVIDER;
    }
    return undefined;
  }

  /**
   * 根据文本特征分类异常
   * @param exc 异常对象
   * @returns 异常类型
   */
  private _classifyByTextSignature(exc: Error): ErrorKindType | undefined {
    const name = exc.constructor.name.toLowerCase();
    const text = `${name} ${exc.message}`.toLowerCase();

    if (
      LLMCore._textMatches(text, [
        "auth|authentication|unauthorized|forbidden|permission denied|access denied",
        "invalid[_\\s-]?api[_\\s-]?key|incorrect api key|api key.*not valid",
      ])
    ) {
      return ErrorKind.CONFIG;
    }

    if (
      LLMCore._textMatches(text, [
        "ratelimit|rate[_\\s-]?limit|too many requests|quota exceeded",
        "\\b429\\b",
      ])
    ) {
      return ErrorKind.TEMPORARY;
    }

    if (
      LLMCore._textMatches(text, [
        "invalid request|bad request|validation|unprocessable",
        "model.*not.*found|does not exist",
        "context.*length|maximum.*context|token limit",
        "unsupported parameter",
      ])
    ) {
      return ErrorKind.INVALID_INPUT;
    }

    if (
      LLMCore._textMatches(text, [
        "timeout|timed out|connection error|network error",
        "internal server|service unavailable|gateway timeout",
      ])
    ) {
      return ErrorKind.PROVIDER;
    }
    return undefined;
  }

  /**
   * 分类异常
   * @param exc 异常对象
   * @returns 异常类型
   */
  classifyException(exc: Error): ErrorKindType {
    if (exc instanceof RepbulicError) {
      return (exc as any).kind;
    }

    if (this._error_classifier) {
      try {
        const kind = this._error_classifier(exc);
        if (kind) {
          return kind;
        }
      } catch (classifierExc) {
        console.warn("error_classifier failed:", classifierExc);
      }
    }

    const classifiers = [
      this._classifyByHttpStatus.bind(this),
      this._classifyByTextSignature.bind(this),
    ];

    for (const classifier of classifiers) {
      const mapped = classifier(exc);
      if (mapped) {
        return mapped;
      }
    }

    return ErrorKind.UNKNOWN;
  }

  /**
   * 判断是否应该重试
   * @param kind 异常类型
   * @returns 是否应该重试
   */
  shouldRetry(kind: ErrorKindType): boolean {
    return kind === ErrorKind.TEMPORARY || kind === ErrorKind.PROVIDER;
  }

  /**
   * 包装异常
   * @param exc 原始异常对象
   * @param kind 异常类型
   * @param provider 提供商名称
   * @param model 模型ID
   * @returns 包装后的RepbulicError对象
   */
  wrapError(
    exc: Error,
    kind: ErrorKindType,
    provider: string,
    model: string,
  ): RepbulicError {
    const message = `${provider}:${model}: ${exc}`;
    return new RepbulicError(kind, message, exc);
  }

  /**
   * 处理尝试错误
   * @param exc 异常对象
   * @param providerName 提供商名称
   * @param modelId 模型ID
   * @param attempt 尝试次数
   * @returns 尝试结果
   */
  private _handleAttemptError(
    exc: Error,
    providerName: string,
    modelId: string,
    attempt: number,
  ): AttemptOutCome {
    let wrapped: RepbulicError;
    let kind: ErrorKindType;

    if (exc instanceof RepbulicError) {
      wrapped = exc;
      kind = (exc as any).kind;
    } else {
      kind = this.classifyException(exc);
      wrapped = this.wrapError(exc, kind, providerName, modelId);
    }

    this.logError(wrapped, providerName, modelId, attempt);

    const canRetrySameModel =
      this.shouldRetry(kind) && attempt + 1 < this.maxAttempts();

    if (canRetrySameModel) {
      return {
        error: wrapped,
        decision: "retry_same_model",
      };
    }

    return {
      error: wrapped,
      decision: "retry_next_model",
    };
  }

  /**
   * 运行聊天
   * @param messagesPayload 消息负载
   * @param toolsPayload 工具负载
   * @param model 模型名称，可选
   * @param provider 提供商名称，可选
   * @param maxTokens 最大token数
   * @param stream 是否流式传输
   * @param streamMode 流模式 (messages, updates, values)
   * @param reasoningEffort 推理努力程度
   * @param kwargs 其他参数
   * @returns 传输响应
   */
  async runChat(
    messagesPayload: Record<string, any>[],
    toolsPayload: Record<string, any>[] | undefined,
    model: string | undefined,
    provider: string | undefined,
    maxTokens: number | undefined,
    stream: boolean,
    streamMode: StreamMode | undefined,
    reasoningEffort: any | undefined,
    kwargs: Record<string, any>,
  ): Promise<TransportResponse> {
    let lastProvider: string | undefined;
    let lastModel: string | undefined;
    let lastError: RepbulicError | undefined;

    for await (const [providerName, modelId, client] of this.iterClients(
      model,
      provider,
    )) {
      lastProvider = providerName;
      lastModel = modelId;

      for (let attempt = 0; attempt < this.maxAttempts(); attempt++) {
        try {
          const response = await this._callClient(
            client,
            providerName,
            modelId,
            messagesPayload,
            toolsPayload,
            maxTokens,
            stream,
            streamMode,
            reasoningEffort,
            kwargs,
          );
          return response;
        } catch (exc) {
          const outcome = this._handleAttemptError(
            exc as Error,
            providerName,
            modelId,
            attempt,
          );
          lastError = outcome.error;

          if (outcome.decision === "retry_same_model") {
            continue;
          }
          break;
        }
      }
    }

    if (lastError) {
      throw lastError;
    }

    if (lastProvider && lastModel) {
      throw new RepbulicError(
        ErrorKind.TEMPORARY,
        `${lastProvider}:${lastModel}: LLM call failed after retries`,
      );
    }

    throw new RepbulicError(
      ErrorKind.UNKNOWN,
      "LLM call failed with unknown error",
    );
  }

  /**
   * 选择传输调用方式
   * @param client ChatOpenAI客户端实例
   * @param stream 是否流式传输
   * @returns 传输类型
   */
  private _selectedTransport(
    client: ChatOpenAI,
    stream: boolean,
  ): TransportKind {
    if (stream) {
      return "stream";
    }
    return "invoke";
  }

  /**
   * 调用客户端 - LangChain 统一风格
   * @param client ChatOpenAI客户端实例
   * @param providerName 提供商名称
   * @param modelId 模型ID
   * @param messagesPayload 消息负载
   * @param toolsPayload 工具负载
   * @param maxTokens 最大token数
   * @param stream 是否流式传输
   * @param reasoningEffort 推理努力程度
   * @param kwargs 其他参数
   * @returns 传输响应
   */
  private async _callClient(
    client: ChatOpenAI,
    providerName: string,
    modelId: string,
    messagesPayload: Record<string, any>[],
    toolsPayload: Record<string, any>[] | undefined,
    maxTokens: number | undefined,
    stream: boolean,
    streamMode: StreamMode | undefined,
    reasoningEffort: any | undefined,
    kwargs: Record<string, any>,
  ): Promise<TransportResponse> {
    const transport = this._selectedTransport(client, stream);
    const langChainMessages = this._convertToLangChainMessages(messagesPayload);

    const invokeOptions: Record<string, any> = {
      ...kwargs,
    };

    if (maxTokens !== undefined) {
      invokeOptions.maxTokens = maxTokens;
    }

    if (stream) {
      invokeOptions.stream = true;
      if (streamMode) {
        invokeOptions.streamMode = streamMode;
      }
    }

    if (reasoningEffort !== undefined) {
      invokeOptions.reasoningEffort = reasoningEffort;
    }

    if (toolsPayload && toolsPayload.length > 0) {
      invokeOptions.tools = this._convertToolsForLangChain(toolsPayload);
    }

    let payload: any;
    if (transport === "stream") {
      payload = await client.stream(langChainMessages, invokeOptions);
    } else {
      payload = await client.invoke(langChainMessages, invokeOptions);
    }

    return { transport, streamMode, payload };
  }

  /**
   * 将工具负载转换为LangChain格式
   * LangChain的工具格式为: { type: "function", function: { name, description, parameters } }
   * @param toolsPayload 原始工具负载
   * @returns LangChain格式的工具数组
   */
  private _convertToolsForLangChain(
    toolsPayload: Record<string, any>[],
  ): Record<string, any>[] {
    return toolsPayload.map((tool) => {
      if (tool.type === "function" && tool.function) {
        return {
          type: "function",
          function: {
            name: tool.function.name || "",
            description: tool.function.description || "",
            parameters: tool.function.parameters || {
              type: "object",
              properties: {},
            },
          },
        };
      }

      if (tool.type === "function") {
        return tool;
      }

      return {
        type: "function",
        function: {
          name: tool.name || "",
          description: tool.description || "",
          parameters: tool.parameters || { type: "object", properties: {} },
        },
      };
    });
  }

  /**
   * 将原始messages转化为LangChain的封装定义格式
   * @param messages 原始消息列表
   * @returns LangChain格式的BaseMessage数组
   */
  private _convertToLangChainMessages(
    messages: Record<string, any>[],
  ): BaseMessage[] {
    const langChainMessages: BaseMessage[] = [];

    for (const message of messages) {
      const role = message.role;
      const content = message.content;

      switch (role) {
        case "system":
        case "developer": {
          const systemContent = typeof content === "string" ? content : "";
          langChainMessages.push(new SystemMessage(systemContent));
          break;
        }
        case "user": {
          const userContent = typeof content === "string" ? content : "";
          langChainMessages.push(new HumanMessage(userContent));
          break;
        }
        case "assistant": {
          const assistantContent = typeof content === "string" ? content : "";
          const toolCalls = message.tool_calls;

          if (toolCalls && toolCalls.length > 0) {
            const lcToolCalls = toolCalls.map((tc: Record<string, any>) => {
              const func = tc.function || {};
              return {
                id: tc.id || tc.call_id || "",
                name: func.name || "",
                arguments:
                  typeof func.arguments === "string"
                    ? func.arguments
                    : JSON.stringify(func.arguments || {}),
              };
            });

            langChainMessages.push(
              new AIMessage({
                content: assistantContent,
                tool_calls: lcToolCalls,
              }),
            );
          } else {
            langChainMessages.push(new AIMessage(assistantContent));
          }
          break;
        }
        case "tool": {
          const toolContent = typeof content === "string" ? content : "";
          const toolCallId = message.tool_call_id || message.call_id || "";
          const toolName = message.name;

          langChainMessages.push(
            new ToolMessage({
              content: toolContent,
              tool_call_id: toolCallId,
              name: toolName,
            }),
          );
          break;
        }
      }
    }

    return langChainMessages;
  }
}
