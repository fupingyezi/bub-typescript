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

  get model(): string {
    return this._core.model;
  }

  get provider(): string {
    return this._core.provider;
  }

  get fallbackModels(): string[] {
    return this._core.fallback_models;
  }

  get context(): TapeContext {
    return this._asyncTape.defaultContext;
  }

  set context(value: TapeContext) {
    this._tape.defaultContext = value;
    this._asyncTape.defaultContext = value;
  }

  tape(
    name: string,
    options?: {
      context?: TapeContext;
    },
  ): Tape {
    return new Tape(name, this._chatClient, options?.context);
  }

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
