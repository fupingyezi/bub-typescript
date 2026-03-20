import { ChatClient } from "@/clients/chat";
import {
  AsyncStreamEvents,
  AsyncTextStream,
  StreamEvents,
  TextStream,
  ToolAutoResult,
} from "@/core/results";
import { TapeContext } from "./context";
import { TapeEntry } from "./entries";
import { TapeQuery } from "./query";
import { AsyncTapeStore, TapeStore } from "@/types";
import { ToolInput } from "@/tools/schema";

abstract class TapeBase {
  protected _name: string;
  protected _client: ChatClient;
  protected _localContext: TapeContext | null;

  constructor(
    name: string,
    chatClient: ChatClient,
    context: TapeContext | null = null,
  ) {
    this._name = name;
    this._client = chatClient;
    this._localContext = context;
  }

  toString(): string {
    return `<Tape name=${this._name}>`;
  }

  get name(): string {
    return this._name;
  }

  get context(): TapeContext {
    return this._localContext || this._client.defaultContext;
  }

  set context(value: TapeContext | null) {
    this._localContext = value;
  }
}

export class Tape extends TapeBase {
  readMessages(context: TapeContext | null = null): Record<string, any>[] {
    const activeContext = context || this.context;
    return this._client["_tape"].readMessages(this._name, activeContext);
  }

  append(entry: TapeEntry): void {
    this._client["_tape"].appendEntry(this._name, entry);
  }

  get query(): TapeQuery<TapeStore> {
    return this._client["_tape"].queryTape(this._name);
  }

  reset(): void {
    this._client["_tape"].resetTape(this._name);
  }

  handoff(
    name: string,
    state: Record<string, any> | null = null,
    meta: Record<string, any> = {},
  ): TapeEntry[] {
    return this._client["_tape"].handoff(
      this._name,
      name,
      state || undefined,
      meta,
    );
  }

  chat(
    prompt: string | null = null,
    options: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: Record<string, any>[] | null;
      maxTokens?: number | null;
      tape?: string | null;
      context?: TapeContext | null;
      [key: string]: any;
    } = {},
  ): Promise<string> {
    const {
      systemPrompt = null,
      model = null,
      provider = null,
      messages = null,
      maxTokens = null,
      ...kwargs
    } = options;
    return this._client.create(prompt, {
      systemPrompt,
      model,
      provider,
      messages,
      maxTokens,
      tape: this._name,
      context: this.context,
      ...kwargs,
    });
  }

  toolCalls(
    prompt: string | null = null,
    options: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: Record<string, any>[] | null;
      maxTokens?: number | null;
      tools?: ToolInput;
      [key: string]: any;
    } = {},
  ): Promise<Record<string, any>[]> {
    const {
      systemPrompt = null,
      model = null,
      provider = null,
      messages = null,
      maxTokens = null,
      tools = null,
      ...kwargs
    } = options;
    throw new Error("toolCalls is not implemented in ChatClient");
  }

  runTools(
    prompt: string | null = null,
    options: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: Record<string, any>[] | null;
      maxTokens?: number | null;
      tools?: ToolInput;
      [key: string]: any;
    } = {},
  ): Promise<ToolAutoResult> {
    const {
      systemPrompt = null,
      model = null,
      provider = null,
      messages = null,
      maxTokens = null,
      tools = null,
      ...kwargs
    } = options;
    throw new Error("runTools is not implemented in ChatClient");
  }

  stream(
    prompt: string | null = null,
    options: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: Record<string, any>[] | null;
      maxTokens?: number | null;
      [key: string]: any;
    } = {},
  ): Promise<AsyncTextStream> {
    const {
      systemPrompt = null,
      model = null,
      provider = null,
      messages = null,
      maxTokens = null,
      ...kwargs
    } = options;
    return this._client.stream(prompt, {
      systemPrompt,
      model,
      provider,
      messages,
      maxTokens,
      tape: this._name,
      context: this.context,
      ...kwargs,
    });
  }

  streamEvents(
    prompt: string | null = null,
    options: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: Record<string, any>[] | null;
      maxTokens?: number | null;
      tools?: ToolInput;
      [key: string]: any;
    } = {},
  ): Promise<AsyncStreamEvents> {
    const {
      systemPrompt = null,
      model = null,
      provider = null,
      messages = null,
      maxTokens = null,
      tools = null,
      ...kwargs
    } = options;
    throw new Error("streamEvents is not implemented in ChatClient");
  }

  get queryAsync(): TapeQuery<AsyncTapeStore> {
    return this._client["_asyncTape"].queryTape(this._name);
  }

  async readMessagesAsync(
    context: TapeContext | null = null,
  ): Promise<Record<string, any>[]> {
    const activeContext = context || this.context;
    return await this._client["_asyncTape"].readMessages(
      this._name,
      activeContext,
    );
  }

  async appendAsync(entry: TapeEntry): Promise<void> {
    await this._client["_asyncTape"].appendEntry(this._name, entry);
  }

  async resetAsync(): Promise<void> {
    await this._client["_asyncTape"].resetTape(this._name);
  }

  async handoffAsync(
    name: string,
    state: Record<string, any> | null = null,
    meta: Record<string, any> = {},
  ): Promise<TapeEntry[]> {
    return await this._client["_asyncTape"].handoff(
      this._name,
      name,
      state || undefined,
      meta,
    );
  }

  async chatAsync(
    prompt: string | null = null,
    options: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: Record<string, any>[] | null;
      maxTokens?: number | null;
      [key: string]: any;
    } = {},
  ): Promise<string> {
    const {
      systemPrompt = null,
      model = null,
      provider = null,
      messages = null,
      maxTokens = null,
      ...kwargs
    } = options;
    return await this._client.create(prompt, {
      systemPrompt,
      model,
      provider,
      messages,
      maxTokens,
      tape: this._name,
      context: this.context,
      ...kwargs,
    });
  }

  async toolCallsAsync(
    prompt: string | null = null,
    options: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: Record<string, any>[] | null;
      maxTokens?: number | null;
      tools?: ToolInput;
      [key: string]: any;
    } = {},
  ): Promise<Record<string, any>[]> {
    const {
      systemPrompt = null,
      model = null,
      provider = null,
      messages = null,
      maxTokens = null,
      tools = null,
      ...kwargs
    } = options;
    throw new Error("toolCallsAsync is not implemented in ChatClient");
  }

  async runToolsAsync(
    prompt: string | null = null,
    options: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: Record<string, any>[] | null;
      maxTokens?: number | null;
      tools?: ToolInput;
      [key: string]: any;
    } = {},
  ): Promise<ToolAutoResult> {
    const {
      systemPrompt = null,
      model = null,
      provider = null,
      messages = null,
      maxTokens = null,
      tools = null,
      ...kwargs
    } = options;
    throw new Error("runToolsAsync is not implemented in ChatClient");
  }

  async streamAsync(
    prompt: string | null = null,
    options: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: Record<string, any>[] | null;
      maxTokens?: number | null;
      [key: string]: any;
    } = {},
  ): Promise<AsyncTextStream> {
    const {
      systemPrompt = null,
      model = null,
      provider = null,
      messages = null,
      maxTokens = null,
      ...kwargs
    } = options;
    return await this._client.stream(prompt, {
      systemPrompt,
      model,
      provider,
      messages,
      maxTokens,
      tape: this._name,
      context: this.context,
      ...kwargs,
    });
  }

  async streamEventsAsync(
    prompt: string | null = null,
    options: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: Record<string, any>[] | null;
      maxTokens?: number | null;
      tools?: ToolInput;
      [key: string]: any;
    } = {},
  ): Promise<AsyncStreamEvents> {
    const {
      systemPrompt = null,
      model = null,
      provider = null,
      messages = null,
      maxTokens = null,
      tools = null,
      ...kwargs
    } = options;
    throw new Error("streamEventsAsync is not implemented in ChatClient");
  }
}
