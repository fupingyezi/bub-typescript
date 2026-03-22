import { LLMCore } from "@/core/execution";
import {
  AsyncStreamEvents,
  AsyncTextStream,
  ToolAutoResult,
} from "@/core/results";
import {
  AsyncTapeManager,
  AsyncTapeStoreAdapter,
  InMemoryTapeStore,
  Tape,
  TapeContext,
  TapeManager,
} from "@/tape";
import { ToolExecutor } from "@/tools/executor";
import { ToolInput } from "@/tools/schema";
import { DEFAULT_MODEL } from "./version";
import { ChatClient, EmbeddingClient, TextClient } from "@/clients";
import { AsyncTapeStore, TapeStore } from "@/types";

export class LLM {
  private _core: LLMCore;
  private _tape: TapeManager;
  private _asyncTape: AsyncTapeManager;
  private _chatClient: ChatClient;
  private _textClient: TextClient;
  public embeddings: EmbeddingClient;
  public tools: ToolExecutor;

  constructor(
    model?: string,
    options?: {
      provider?: string;
      fallbackModels?: string[];
      maxRetries?: number;
      apiKey?: string | Record<string, string>;
      apiKeyResolver?: any;
      apiBase?: string | Record<string, string>;
      clientArgs?: Record<string, any>;
      apiFormat?: "invoke" | "stream";
      streamMode?: "messages" | "updates" | "values";
      verbose?: number;
      tapeStore?: TapeStore | AsyncTapeStore;
      context?: TapeContext;
      errorClassifier?: (error: Error) => string | undefined;
    },
  ) {
    const {
      provider,
      fallbackModels = [],
      maxRetries = 3,
      apiKey,
      apiKeyResolver,
      apiBase,
      clientArgs = {},
      apiFormat = "invoke",
      streamMode = "messages",
      verbose = 0,
      tapeStore,
      context,
      errorClassifier,
    } = options || {};

    if (verbose < 0 || verbose > 2) {
      throw new Error("verbose must be 0, 1, or 2");
    }
    if (maxRetries < 0) {
      throw new Error("maxRetries must be >= 0");
    }
    if (!["invoke", "stream"].includes(apiFormat)) {
      throw new Error("apiFormat must be 'invoke' or 'stream'");
    }

    const resolvedModel = model || DEFAULT_MODEL;

    // 解析模型和提供商
    const modelParts = resolvedModel.split(":");
    let resolvedProvider =
      provider || (modelParts.length > 1 ? modelParts[0] : "");
    const resolvedModelId =
      modelParts.length > 1 ? modelParts.slice(1).join(":") : resolvedModel;

    // 如果没有提供 provider，使用默认值 "unknown"
    if (!resolvedProvider) {
      console.log(
        `[LLM] No provider specified, using default "unknown" for model: ${resolvedModel}`,
      );
      resolvedProvider = "unknown";
    }

    // 如果从 model 字符串中解析出了 provider，并且用户也提供了 provider，检查是否匹配
    if (modelParts.length > 1 && provider && provider !== modelParts[0]) {
      console.warn(
        `[LLM] Provider mismatch: specified "${provider}" but model string suggests "${modelParts[0]}", using "${provider}"`,
      );
    }

    this._core = new LLMCore(
      resolvedProvider,
      resolvedModelId,
      fallbackModels,
      maxRetries,
      apiKey,
      apiKeyResolver,
      apiBase,
      clientArgs,
      apiFormat,
      streamMode,
      verbose,
      errorClassifier || (() => undefined),
    );

    const toolExecutor = new ToolExecutor();
    let syncTapeStore: TapeStore;
    let asyncTapeStore: AsyncTapeStore;

    if (!tapeStore) {
      const sharedTapeStore = new InMemoryTapeStore();
      syncTapeStore = sharedTapeStore;
      asyncTapeStore = new AsyncTapeStoreAdapter(sharedTapeStore);
    } else if ((tapeStore as any)._isAsync) {
      // 处理异步 tape store
      syncTapeStore = {
        listTapes: () => {
          throw new Error(
            "Sync tape APIs are unavailable when tapeStore is AsyncTapeStore; use async chat/tool APIs.",
          );
        },
        reset: () => {
          throw new Error(
            "Sync tape APIs are unavailable when tapeStore is AsyncTapeStore; use async chat/tool APIs.",
          );
        },
        fetchAll: () => {
          throw new Error(
            "Sync tape APIs are unavailable when tapeStore is AsyncTapeStore; use async chat/tool APIs.",
          );
        },
        append: () => {
          throw new Error(
            "Sync tape APIs are unavailable when tapeStore is AsyncTapeStore; use async chat/tool APIs.",
          );
        },
      };
      asyncTapeStore = tapeStore as AsyncTapeStore;
    } else {
      syncTapeStore = tapeStore as TapeStore;
      asyncTapeStore = new AsyncTapeStoreAdapter(tapeStore as TapeStore);
    }

    this._tape = new TapeManager(syncTapeStore, context || new TapeContext());
    this._asyncTape = new AsyncTapeManager(
      asyncTapeStore,
      context || new TapeContext(),
    );
    this._chatClient = new ChatClient(
      this._core,
      toolExecutor,
      this._tape,
      this._asyncTape,
    );
    this._textClient = new TextClient(this._chatClient);
    this.embeddings = new EmbeddingClient(this._core);
    this.tools = toolExecutor;
  }

  /**
   * 获取模型名称
   * @returns 模型名称
   */
  get model(): string {
    return this._core.model;
  }

  /**
   * 获取提供商名称
   * @returns 提供商名称
   */
  get provider(): string {
    return this._core.provider;
  }

  /**
   * 获取备用模型列表
   * @returns 备用模型列表
   */
  get fallbackModels(): string[] {
    return this._core.fallback_models;
  }

  /**
   * 获取默认上下文
   * @returns Tape上下文
   */
  get context(): TapeContext {
    return this._asyncTape.defaultContext;
  }

  /**
   * 设置默认上下文
   * @param value Tape上下文
   */
  set context(value: TapeContext) {
    this._tape.defaultContext = value;
    this._asyncTape.defaultContext = value;
  }

  /**
   * 创建一个新的Tape实例
   * @param name Tape名称
   * @param options 配置选项
   * @param options.context Tape上下文
   * @returns Tape实例
   */
  tape(
    name: string,
    options?: {
      context?: TapeContext;
    },
  ): Tape {
    return new Tape(name, this._chatClient, options?.context);
  }

  /**
   * 发起聊天请求
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 聊天回复文本
   */
  chat(
    prompt: string | null = null,
    options?: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: Record<string, any>[] | null;
      maxTokens?: number | null;
      tape?: string | null;
      context?: TapeContext | null;
      [key: string]: any;
    },
  ): Promise<string> {
    return this._chatClient.create(prompt, {
      ...options,
    });
  }

  /**
   * 异步发起聊天请求
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 聊天回复文本
   */
  async chatAsync(
    prompt: string | null = null,
    options?: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: Record<string, any>[] | null;
      maxTokens?: number | null;
      tape?: string | null;
      context?: TapeContext | null;
      [key: string]: any;
    },
  ): Promise<string> {
    return await this._chatClient.create(prompt, {
      ...options,
    });
  }

  /**
   * 获取工具调用
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 工具调用列表
   */
  toolCalls(
    prompt: string | null = null,
    options?: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: Record<string, any>[] | null;
      maxTokens?: number | null;
      tape?: string | null;
      context?: TapeContext | null;
      tools?: ToolInput;
      [key: string]: any;
    },
  ): Promise<Record<string, any>[]> {
    return this._chatClient.toolCallsAsync(prompt, {
      ...options,
    });
  }

  /**
   * 异步获取工具调用
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 工具调用列表
   */
  async toolCallsAsync(
    prompt: string | null = null,
    options?: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: Record<string, any>[] | null;
      maxTokens?: number | null;
      tape?: string | null;
      context?: TapeContext | null;
      tools?: ToolInput;
      [key: string]: any;
    },
  ): Promise<Record<string, any>[]> {
    return await this._chatClient.toolCallsAsync(prompt, {
      ...options,
    });
  }

  /**
   * 执行工具调用
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 工具执行结果
   */
  async runTools(
    prompt: string | null = null,
    options?: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: Record<string, any>[] | null;
      maxTokens?: number | null;
      tape?: string | null;
      context?: TapeContext | null;
      tools?: ToolInput;
      [key: string]: any;
    },
  ): Promise<ToolAutoResult> {
    return await this.runToolsAsync(prompt, options);
  }

  /**
   * 异步执行工具调用
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 工具执行结果
   */
  async runToolsAsync(
    prompt: string | null = null,
    options?: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: Record<string, any>[] | null;
      maxTokens?: number | null;
      tape?: string | null;
      context?: TapeContext | null;
      tools?: ToolInput;
      [key: string]: any;
    },
  ): Promise<ToolAutoResult> {
    const toolCalls = await this._chatClient.toolCallsAsync(prompt, {
      ...options,
    });

    if (!toolCalls || toolCalls.length === 0) {
      const textResult = await this._chatClient.create(prompt, {
        ...options,
      });
      return ToolAutoResult.textResult(textResult);
    }

    const toolResults = await this.tools.executeAsync(
      toolCalls,
      options?.tools || null,
      null,
    );

    if (toolResults.error) {
      return ToolAutoResult.errorResult(toolResults.error, {
        toolCalls,
        toolResults: toolResults.toolResults,
      });
    }

    return ToolAutoResult.toolsResult(toolCalls, toolResults.toolResults);
  }

  /**
   * 判断输入文本是否满足条件
   * @param inputText 输入文本
   * @param question 判断问题
   * @param options 配置选项
   * @returns 判断结果
   */
  if_(
    inputText: string,
    question: string,
    options?: {
      tape?: string | null;
      context?: TapeContext | null;
    },
  ): Promise<boolean> {
    return this._textClient.if_(inputText, question, options);
  }

  /**
   * 异步判断输入文本是否满足条件
   * @param inputText 输入文本
   * @param question 判断问题
   * @param options 配置选项
   * @returns 判断结果
   */
  async ifAsync(
    inputText: string,
    question: string,
    options?: {
      tape?: string | null;
      context?: TapeContext | null;
    },
  ): Promise<boolean> {
    return await this._textClient.if_(inputText, question, options);
  }

  /**
   * 对输入文本进行分类
   * @param inputText 输入文本
   * @param choices 分类选项列表
   * @param options 配置选项
   * @returns 分类标签
   */
  classify(
    inputText: string,
    choices: string[],
    options?: {
      tape?: string | null;
      context?: TapeContext | null;
    },
  ): Promise<string> {
    return this._textClient.classify(inputText, choices, options);
  }

  /**
   * 异步对输入文本进行分类
   * @param inputText 输入文本
   * @param choices 分类选项列表
   * @param options 配置选项
   * @returns 分类标签
   */
  async classifyAsync(
    inputText: string,
    choices: string[],
    options?: {
      tape?: string | null;
      context?: TapeContext | null;
    },
  ): Promise<string> {
    return await this._textClient.classify(inputText, choices, options);
  }

  /**
   * 获取文本嵌入
   * @param inputs 输入文本或文本数组
   * @param options 配置选项
   * @returns 嵌入结果
   */
  embed(
    inputs: string | string[],
    options?: {
      model?: string | null;
      provider?: string | null;
      [key: string]: any;
    },
  ): Promise<any> {
    return this.embeddings.embed(inputs, options);
  }

  /**
   * 异步获取文本嵌入
   * @param inputs 输入文本或文本数组
   * @param options 配置选项
   * @returns 嵌入结果
   */
  async embedAsync(
    inputs: string | string[],
    options?: {
      model?: string | null;
      provider?: string | null;
      [key: string]: any;
    },
  ): Promise<any> {
    return await this.embeddings.embed(inputs, options);
  }

  /**
   * 流式发起聊天请求
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 异步文本流
   */
  stream(
    prompt: string | null = null,
    options?: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: Record<string, any>[] | null;
      maxTokens?: number | null;
      tape?: string | null;
      context?: TapeContext | null;
      [key: string]: any;
    },
  ): Promise<AsyncTextStream> {
    return this._chatClient.stream(prompt, {
      ...options,
    });
  }

  /**
   * 异步流式发起聊天请求
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 异步文本流
   */
  async streamAsync(
    prompt: string | null = null,
    options?: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: Record<string, any>[] | null;
      maxTokens?: number | null;
      tape?: string | null;
      context?: TapeContext | null;
      [key: string]: any;
    },
  ): Promise<AsyncTextStream> {
    return await this._chatClient.stream(prompt, {
      ...options,
    });
  }

  /**
   * 获取流式事件
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 异步流事件
   */
  streamEvents(
    prompt: string | null = null,
    options?: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: Record<string, any>[] | null;
      maxTokens?: number | null;
      tape?: string | null;
      context?: TapeContext | null;
      tools?: ToolInput;
      [key: string]: any;
    },
  ): Promise<AsyncStreamEvents> {
    return this._chatClient.streamEventsAsync(prompt, {
      ...options,
    });
  }

  /**
   * 异步获取流式事件
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 异步流事件
   */
  async streamEventsAsync(
    prompt: string | null = null,
    options?: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: Record<string, any>[] | null;
      maxTokens?: number | null;
      tape?: string | null;
      context?: TapeContext | null;
      tools?: ToolInput;
      [key: string]: any;
    },
  ): Promise<AsyncStreamEvents> {
    return await this._chatClient.streamEventsAsync(prompt, {
      ...options,
    });
  }

  toString(): string {
    const modelDisplay =
      this._core.provider === "unknown"
        ? this._core.model
        : `${this._core.provider}:${this._core.model}`;
    return `<LLM provider=${this._core.provider} model=${modelDisplay} fallbackModels=${this._core.fallback_models.join(",")} maxRetries=${this._core.max_retries}>`;
  }
}
