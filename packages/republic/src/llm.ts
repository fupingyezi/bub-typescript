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
      apiFormat?: "completion" | "response" | "messages";
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
      apiFormat = "completion",
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
    if (!["completion", "response", "messages"].includes(apiFormat)) {
      throw new Error(
        "apiFormat must be 'completion', 'response', or 'messages'",
      );
    }

    const resolvedModel = model || DEFAULT_MODEL;

    // 解析模型和提供商
    const modelParts = resolvedModel.split(":");
    const resolvedProvider =
      provider || (modelParts.length > 1 ? modelParts[0] : "");

    if (!resolvedProvider) {
      throw new Error(
        "Provider must be specified either in the model string or as a separate option",
      );
    }

    this._core = new LLMCore(
      resolvedProvider,
      resolvedModel,
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
    throw new Error("toolCalls is not implemented in ChatClient");
  }

  async toolCallsAsync(
    _prompt: string | null = null,
    _options?: {
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
    throw new Error("toolCallsAsync is not implemented in ChatClient");
  }

  runTools(
    _prompt: string | null = null,
    _options?: {
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
    throw new Error("runTools is not implemented in ChatClient");
  }

  async runToolsAsync(
    _prompt: string | null = null,
    _options?: {
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
    throw new Error("runToolsAsync is not implemented in ChatClient");
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
    _prompt: string | null = null,
    _options?: {
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
    throw new Error("streamEvents is not implemented in ChatClient");
  }

  async streamEventsAsync(
    _prompt: string | null = null,
    _options?: {
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
    throw new Error("streamEventsAsync is not implemented in ChatClient");
  }

  toString(): string {
    return `<LLM provider=${this._core.provider} model=${this._core.model} fallbackModels=${this._core.fallback_models} maxRetries=${this._core.max_retries}>`;
  }
}
