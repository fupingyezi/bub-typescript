import { LLMCore, TransportKind } from "@/core/execution";
import {
  ErrorPayload,
  AsyncTextStream,
  StreamState,
  StreamEvent,
  AsyncStreamEvents,
} from "@/core/results";
import { ErrorKind, StreamEventKind } from "@/types";
import { TapeContext } from "@/tape/context";
import { TapeManager, AsyncTapeManager } from "@/tape/manager";
import { parserForTransport, ResponseFormat } from "./parsing";
import { field } from "./parsing/common";
import { normalizeTools } from "@/tools/schema";

type MessageInput = Record<string, any>;
type ToolInput = any;

interface ToolSet {
  payload: any[];
  runnable: any[];
  requireRunnable(): void;
}

interface PreparedChat {
  payload: Record<string, any>[];
  newMessages: Record<string, any>[];
  toolset: ToolSet;
  tape: string | null;
  shouldUpdate: boolean;
  contextError: ErrorPayload | null;
  runId: string;
  systemPrompt: string | null;
  context: TapeContext | null;
}

class ToolCallAssembler {
  private _calls: Map<any, Record<string, any>> = new Map();
  private _order: any[] = [];
  private _indexToKey: Map<any, any> = new Map();

  addDeltas(toolCalls: any[]): void {
    for (let position = 0; position < toolCalls.length; position++) {
      const toolCall = toolCalls[position];
      const key = this._resolveKey(toolCall, position);
      if (!this._calls.has(key)) {
        this._order.push(key);
        this._calls.set(key, { function: { name: "", arguments: "" } });
      }
      const entry = this._calls.get(key)!;
      const callId = field(toolCall, "id");
      if (callId) {
        entry["id"] = callId;
      }
      const callType = field(toolCall, "type");
      if (callType) {
        entry["type"] = callType;
      }
      const func = field(toolCall, "function");
      if (func === null) {
        continue;
      }
      const name = field(func, "name");
      if (name) {
        entry["function"]["name"] = name;
      }
      const arguments_ = field(func, "arguments");
      this._mergeArguments(
        entry,
        arguments_,
        Boolean(field(toolCall, "arguments_complete", false)),
      );
    }
  }

  private _resolveKey(toolCall: any, position: number): any {
    const callId = field(toolCall, "id");
    const index = field(toolCall, "index");

    if (callId !== null) {
      return this._resolveKeyById(callId, index, position);
    }

    if (index !== null) {
      return this._resolveKeyByIndex(toolCall, index, position);
    }

    const positionKey = this._keyAtPosition(position);
    if (positionKey !== null) {
      return positionKey;
    }
    return ["position", position];
  }

  private _resolveKeyById(callId: string, index: any, position: number): any {
    const idKey = ["id", callId];
    if (this._calls.has(idKey)) {
      if (index !== null) {
        this._indexToKey.set(index, idKey);
      }
      return idKey;
    }

    const mappedKey = this._indexToKey.get(index);
    if (
      mappedKey !== undefined &&
      this._calls.has(mappedKey) &&
      mappedKey !== idKey
    ) {
      this._replaceKey(mappedKey, idKey);
      this._indexToKey.set(index, idKey);
      return idKey;
    }

    if (index !== null) {
      const indexKey = ["index", index];
      if (this._calls.has(indexKey)) {
        this._replaceKey(indexKey, idKey);
        this._indexToKey.set(index, idKey);
        return idKey;
      }
    }

    const positionKey = this._keyAtPosition(position);
    if (positionKey !== null && this._calls.has(positionKey)) {
      this._replaceKey(positionKey, idKey);
      if (index !== null) {
        this._indexToKey.set(index, idKey);
      }
      return idKey;
    }
    if (index !== null) {
      this._indexToKey.set(index, idKey);
    }
    return idKey;
  }

  private _resolveKeyByIndex(toolCall: any, index: any, position: number): any {
    const mappedKey = this._indexToKey.get(index);
    if (mappedKey !== undefined && this._calls.has(mappedKey)) {
      return mappedKey;
    }

    const indexKey = ["index", index];
    if (this._calls.has(indexKey)) {
      this._indexToKey.set(index, indexKey);
      return indexKey;
    }

    const positionKey = this._keyAtPosition(position);
    const func = field(toolCall, "function");
    const toolName = func !== null ? field(func, "name") : null;

    if (
      (toolName === null || toolName === "") &&
      positionKey !== null &&
      this._calls.has(positionKey)
    ) {
      this._indexToKey.set(index, positionKey);
      return positionKey;
    }

    if (
      positionKey !== null &&
      this._calls.has(positionKey) &&
      Array.isArray(positionKey) &&
      positionKey[0] === "position"
    ) {
      this._replaceKey(positionKey, indexKey);
      this._indexToKey.set(index, indexKey);
      return indexKey;
    }
    this._indexToKey.set(index, indexKey);
    return indexKey;
  }

  private _keyAtPosition(position: number): any | null {
    if (position < this._order.length) {
      return this._order[position];
    }
    return null;
  }

  private _replaceKey(oldKey: any, newKey: any): void {
    const entry = this._calls.get(oldKey)!;
    this._calls.delete(oldKey);
    this._calls.set(newKey, entry);
    const index = this._order.indexOf(oldKey);
    this._order[index] = newKey;
    for (const [idx, key] of this._indexToKey.entries()) {
      if (key === oldKey) {
        this._indexToKey.set(idx, newKey);
      }
    }
  }

  private _mergeArguments(
    entry: Record<string, any>,
    arguments_: any,
    argumentsComplete: boolean,
  ): void {
    if (arguments_ === null) {
      return;
    }
    if (typeof arguments_ !== "string") {
      entry["function"]["arguments"] = arguments_;
      return;
    }
    if (argumentsComplete) {
      entry["function"]["arguments"] = arguments_;
      return;
    }

    const existing = entry["function"]["arguments"] || "";
    if (typeof existing !== "string") {
      entry["function"]["arguments"] = "";
    } else {
      entry["function"]["arguments"] = existing + arguments_;
    }
  }

  finalize(): Record<string, any>[] {
    return this._order.map((key) => this._calls.get(key)!);
  }
}

export class ChatClient {
  private _core: LLMCore;
  private _toolExecutor: any;
  private _tape: TapeManager;
  private _asyncTape: AsyncTapeManager;

  constructor(
    core: LLMCore,
    toolExecutor: any,
    tape: TapeManager,
    asyncTape: AsyncTapeManager,
  ) {
    this._core = core;
    this._toolExecutor = toolExecutor;
    this._tape = tape;
    this._asyncTape = asyncTape;
  }

  get defaultContext(): TapeContext {
    return this._tape.defaultContext;
  }

  private static _isTransportResponse(
    response: any,
  ): response is { transport: TransportKind; payload: any } {
    return (
      response &&
      typeof response === "object" &&
      "transport" in response &&
      "payload" in response
    );
  }

  private static _unwrapResponse(response: any): [any, TransportKind | null] {
    if (ChatClient._isTransportResponse(response)) {
      return [response.payload, response.transport];
    }
    return [response, null];
  }

  private static _resolveResponseFormat(
    payload: any,
    transport: TransportKind | null = null,
  ): ResponseFormat {
    if (
      transport !== null &&
      (transport === "invoke" || transport === "stream")
    ) {
      if (Array.isArray(payload)) {
        return "responses";
      }
      if (field(payload, "output") !== null) {
        return "responses";
      }
      if (field(payload, "output_text") !== null) {
        return "responses";
      }
      const eventType = field(payload, "type");
      if (typeof eventType === "string" && eventType.startsWith("response.")) {
        return "responses";
      }
      return "completion";
    }
    if (Array.isArray(payload)) {
      return "responses";
    }
    if (field(payload, "output") !== null) {
      return "responses";
    }
    if (field(payload, "output_text") !== null) {
      return "responses";
    }
    const eventType = field(payload, "type");
    if (typeof eventType === "string" && eventType.startsWith("response.")) {
      return "responses";
    }
    return "completion";
  }

  private static _parserForPayload(
    payload: any,
    transport: TransportKind | null = null,
  ): any {
    const responseFormat = ChatClient._resolveResponseFormat(
      payload,
      transport,
    );
    return parserForTransport(responseFormat);
  }

  private _validateChatInput(
    prompt: string | null,
    messages: MessageInput[] | null,
    systemPrompt: string | null,
    tape: string | null,
  ): void {
    if (prompt !== null && messages !== null) {
      throw new ErrorPayload(
        ErrorKind.INVALID_INPUT,
        "Provide either prompt or messages, not both.",
      );
    }
    if (prompt === null && messages === null) {
      throw new ErrorPayload(
        ErrorKind.INVALID_INPUT,
        "Either prompt or messages is required.",
      );
    }
    if (messages !== null && (systemPrompt !== null || tape !== null)) {
      throw new ErrorPayload(
        ErrorKind.INVALID_INPUT,
        "system_prompt and tape are not supported with messages input.",
      );
    }
  }

  private _prepareMessages(
    prompt: string | null,
    systemPrompt: string | null,
    tape: string | null,
    messages: MessageInput[] | null,
    context: TapeContext | undefined,
  ): [Record<string, any>[], Record<string, any>[]] {
    this._validateChatInput(prompt, messages, systemPrompt, tape);

    if (messages !== null) {
      const payload = messages.map((message) => ({ ...message }));
      return [payload, []];
    }

    if (prompt === null) {
      throw new ErrorPayload(
        ErrorKind.INVALID_INPUT,
        "prompt is required when messages is not provided",
      );
    }

    const userMessage = { role: "user", content: prompt };

    if (tape === null) {
      const payload: Record<string, any>[] = [];
      if (systemPrompt) {
        payload.push({ role: "system", content: systemPrompt });
      }
      payload.push(userMessage);
      return [payload, []];
    }

    const history = this._tape.readMessages(tape, context);
    const payload: Record<string, any>[] = [];
    if (systemPrompt) {
      payload.push({ role: "system", content: systemPrompt });
    }
    payload.push(...history);
    payload.push(userMessage);
    return [payload, [userMessage]];
  }

  private async _prepareMessagesAsync(
    prompt: string | null,
    systemPrompt: string | null,
    tape: string | null,
    messages: MessageInput[] | null,
    context: TapeContext | undefined,
  ): Promise<[Record<string, any>[], Record<string, any>[]]> {
    this._validateChatInput(prompt, messages, systemPrompt, tape);

    if (messages !== null) {
      const payload = messages.map((message) => ({ ...message }));
      return [payload, []];
    }

    if (prompt === null) {
      throw new ErrorPayload(
        ErrorKind.INVALID_INPUT,
        "prompt is required when messages is not provided",
      );
    }

    const userMessage = { role: "user", content: prompt };

    if (tape === null) {
      const payload: Record<string, any>[] = [];
      if (systemPrompt) {
        payload.push({ role: "system", content: systemPrompt });
      }
      payload.push(userMessage);
      return [payload, []];
    }

    const history = await this._asyncTape.readMessages(tape, context);
    const payload: Record<string, any>[] = [];
    if (systemPrompt) {
      payload.push({ role: "system", content: systemPrompt });
    }
    payload.push(...history);
    payload.push(userMessage);
    return [payload, [userMessage]];
  }

  private _prepareRequest(
    prompt: string | null,
    systemPrompt: string | null,
    messages: MessageInput[] | null,
    tape: string | null,
    context: TapeContext | undefined,
    tools: ToolInput,
    requireTools: boolean = false,
    requireRunnable: boolean = false,
  ): PreparedChat {
    let contextError: ErrorPayload | null = null;
    let payload: Record<string, any>[] = [];
    let newMessages: Record<string, any>[] = [];
    let toolset: ToolSet;

    try {
      [payload, newMessages] = this._prepareMessages(
        prompt,
        systemPrompt,
        tape,
        messages,
        context,
      );
      if (requireTools && !tools) {
        throw new ErrorPayload(
          ErrorKind.INVALID_INPUT,
          "tools are required for this operation.",
        );
      }
      toolset = this._normalizeTools(tools);
      if (requireRunnable) {
        toolset.requireRunnable();
      }
    } catch (exc) {
      if (exc instanceof ErrorPayload) {
        contextError = exc;
      }
      toolset = { payload: [], runnable: [], requireRunnable: () => {} };
    }

    const shouldUpdate = tape !== null && messages === null;
    const runId = crypto.randomUUID();
    return {
      payload,
      newMessages,
      toolset,
      tape,
      shouldUpdate,
      contextError,
      runId,
      systemPrompt,
      context: context || null,
    };
  }

  private async _prepareRequestAsync(
    prompt: string | null,
    systemPrompt: string | null,
    messages: MessageInput[] | null,
    tape: string | null,
    context: TapeContext | undefined,
    tools: ToolInput,
    requireTools: boolean = false,
    requireRunnable: boolean = false,
  ): Promise<PreparedChat> {
    let contextError: ErrorPayload | null = null;
    let payload: Record<string, any>[] = [];
    let newMessages: Record<string, any>[] = [];
    let toolset: ToolSet;

    try {
      [payload, newMessages] = await this._prepareMessagesAsync(
        prompt,
        systemPrompt,
        tape,
        messages,
        context,
      );
      if (requireTools && !tools) {
        throw new ErrorPayload(
          ErrorKind.INVALID_INPUT,
          "tools are required for this operation.",
        );
      }
      toolset = this._normalizeTools(tools);
      if (requireRunnable) {
        toolset.requireRunnable();
      }
    } catch (exc) {
      if (exc instanceof ErrorPayload) {
        contextError = exc;
      }
      toolset = { payload: [], runnable: [], requireRunnable: () => {} };
    }

    const shouldUpdate = tape !== null && messages === null;
    const runId = crypto.randomUUID();
    return {
      payload,
      newMessages,
      toolset,
      tape,
      shouldUpdate,
      contextError,
      runId,
      systemPrompt,
      context: context || null,
    };
  }

  private _normalizeTools(tools: ToolInput): ToolSet {
    try {
      return normalizeTools(tools);
    } catch (exc) {
      throw new ErrorPayload(ErrorKind.INVALID_INPUT, String(exc));
    }
  }

  async toolCallsAsync(
    prompt: string | null = null,
    options: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: MessageInput[] | null;
      maxTokens?: number | null;
      tape?: string | null;
      context?: TapeContext | null;
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
      tape = null,
      context = null,
      tools = null,
      ...kwargs
    } = options;

    const prepared = await this._prepareRequestAsync(
      prompt,
      systemPrompt,
      messages,
      tape,
      context || undefined,
      tools,
      true,
      true,
    );
    if (prepared.contextError !== null) {
      throw prepared.contextError;
    }

    const response = await this._core.runChat(
      prepared.payload,
      prepared.toolset.payload || undefined,
      model || undefined,
      provider || undefined,
      maxTokens || undefined,
      false,
      undefined,
      undefined,
      kwargs,
    );

    const [payload, transport] = ChatClient._unwrapResponse(response);
    const parser = ChatClient._parserForPayload(payload, transport);
    const toolCalls = parser.extractToolCalls(payload);
    const usage = this._extractUsage(payload, transport);

    await this._updateTapeAsync(prepared, null, {
      toolCalls,
      response: payload,
      provider,
      model,
      usage,
    });

    return toolCalls;
  }

  async create(
    prompt: string | null = null,
    options: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: MessageInput[] | null;
      maxTokens?: number | null;
      tape?: string | null;
      context?: TapeContext | null;
      tools?: ToolInput;
      [key: string]: any;
    } = {},
  ): Promise<string> {
    const {
      systemPrompt = null,
      model = null,
      provider = null,
      messages = null,
      maxTokens = null,
      tape = null,
      context = null,
      tools = null,
      ...kwargs
    } = options;

    const prepared = this._prepareRequest(
      prompt,
      systemPrompt,
      messages,
      tape,
      context || undefined,
      tools,
    );
    if (prepared.contextError !== null) {
      throw prepared.contextError;
    }

    const response = await this._core.runChat(
      prepared.payload,
      prepared.toolset.payload || undefined,
      model || undefined,
      provider || undefined,
      maxTokens || undefined,
      false,
      undefined,
      undefined,
      kwargs,
    );

    const [payload, transport] = ChatClient._unwrapResponse(response);
    const text = this._extractText(payload, transport);
    const usage = this._extractUsage(payload, transport);

    this._updateTape(prepared, text, {
      response: payload,
      provider,
      model,
      usage,
    });

    return text || "";
  }

  async stream(
    prompt: string | null = null,
    options: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: MessageInput[] | null;
      maxTokens?: number | null;
      tape?: string | null;
      context?: TapeContext | null;
      tools?: ToolInput;
      streamMode?: "messages" | "updates" | "values";
      [key: string]: any;
    } = {},
  ): Promise<AsyncTextStream> {
    const {
      systemPrompt = null,
      model = null,
      provider = null,
      messages = null,
      maxTokens = null,
      tape = null,
      context = null,
      tools = null,
      streamMode = undefined,
      ...kwargs
    } = options;

    const prepared = await this._prepareRequestAsync(
      prompt,
      systemPrompt,
      messages,
      tape,
      context || undefined,
      tools,
    );
    if (prepared.contextError !== null) {
      throw prepared.contextError;
    }

    const response = await this._core.runChat(
      prepared.payload,
      prepared.toolset.payload || undefined,
      model || undefined,
      provider || undefined,
      maxTokens || undefined,
      true,
      streamMode,
      undefined,
      kwargs,
    );

    return this._buildAsyncTextStream(
      prepared,
      response,
      provider || this._core.provider,
      model || this._core.model,
      0,
    );
  }

  async streamEventsAsync(
    prompt: string | null = null,
    options: {
      systemPrompt?: string | null;
      model?: string | null;
      provider?: string | null;
      messages?: MessageInput[] | null;
      maxTokens?: number | null;
      tape?: string | null;
      context?: TapeContext | null;
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
      tape = null,
      context = null,
      tools = null,
      ...kwargs
    } = options;

    const prepared = await this._prepareRequestAsync(
      prompt,
      systemPrompt,
      messages,
      tape,
      context || undefined,
      tools,
    );
    if (prepared.contextError !== null) {
      throw prepared.contextError;
    }

    const response = await this._core.runChat(
      prepared.payload,
      prepared.toolset.payload || undefined,
      model || undefined,
      provider || undefined,
      maxTokens || undefined,
      true,
      undefined,
      undefined,
      kwargs,
    );

    return this._buildAsyncStreamEvents(
      prepared,
      response,
      provider || this._core.provider,
      model || this._core.model,
    );
  }

  private async _buildAsyncStreamEvents(
    prepared: PreparedChat,
    response: any,
    providerName: string,
    modelId: string,
  ): Promise<AsyncStreamEvents> {
    const { transport, payload } = response;
    const state: StreamState = { error: null, usage: null };
    const assembler = new ToolCallAssembler();
    let usage: Record<string, any> | null = null;
    let finalText = "";
    const toolCallDeltas: Record<string, any>[] = [];

    const self = this;

    async function* _iterator(): AsyncGenerator<StreamEvent> {
      try {
        if (transport === "stream" && Symbol.asyncIterator in payload) {
          for await (const chunk of payload) {
            const deltas = self._extractChunkToolCallDeltas(chunk, transport);
            if (deltas && deltas.length > 0) {
              assembler.addDeltas(deltas);
              for (const delta of deltas) {
                yield new StreamEvent("tool_call", delta);
              }
            }
            const text = self._extractChunkText(chunk, transport);
            if (text) {
              finalText += text;
              yield new StreamEvent("text", { text });
            }
            const chunkUsage = self._extractUsage(chunk, transport);
            if (chunkUsage) {
              usage = chunkUsage;
            }
          }
        } else if (Array.isArray(payload)) {
          for (const chunk of payload) {
            const deltas = self._extractChunkToolCallDeltas(chunk, transport);
            if (deltas && deltas.length > 0) {
              assembler.addDeltas(deltas);
              for (const delta of deltas) {
                yield new StreamEvent("tool_call", delta);
              }
            }
            const text = self._extractChunkText(chunk, transport);
            if (text) {
              finalText += text;
              yield new StreamEvent("text", { text });
            }
            const chunkUsage = self._extractUsage(chunk, transport);
            if (chunkUsage) {
              usage = chunkUsage;
            }
          }
        } else {
          const deltas = self._extractChunkToolCallDeltas(payload, transport);
          if (deltas && deltas.length > 0) {
            assembler.addDeltas(deltas);
            for (const delta of deltas) {
              yield new StreamEvent("tool_call", delta);
            }
          }
          const text = self._extractText(payload, transport);
          if (text) {
            finalText = text;
            yield new StreamEvent("text", { text });
          }
          usage = self._extractUsage(payload, transport);
        }

        if (usage) {
          yield new StreamEvent("usage", { usage });
        }
        yield new StreamEvent("final", { text: finalText });
      } catch (exc) {
        state.error = new ErrorPayload(ErrorKind.PROVIDER, String(exc));
        yield new StreamEvent("error", { error: state.error });
      }
    }

    await this._updateTapeAsync(prepared, finalText || null, {
      response: payload,
      provider: providerName,
      model: modelId,
      usage,
    });

    return new AsyncStreamEvents(_iterator(), state);
  }

  private _extractText(payload: any, transport: TransportKind | null): string {
    if (Array.isArray(payload)) {
      const parts: string[] = [];
      for (const chunk of payload) {
        const text = this._extractChunkText(chunk, transport);
        if (text) {
          parts.push(text);
        }
      }
      return parts.join("");
    }

    // 处理LangChain AIMessage对象
    if (payload && typeof payload === "object" && "content" in payload) {
      return payload.content || "";
    }

    const parser = ChatClient._parserForPayload(payload, transport);
    return parser.extractText(payload);
  }

  private _extractUsage(
    payload: any,
    transport: TransportKind | null,
  ): Record<string, any> | null {
    const parser = ChatClient._parserForPayload(payload, transport);
    return parser.extractUsage(payload);
  }

  private _extractChunkToolCallDeltas(
    chunk: any,
    transport: TransportKind | null,
  ): any[] {
    const parser = ChatClient._parserForPayload(chunk, transport);
    return parser.extractChunkToolCallDeltas(chunk);
  }

  private _processStreamChunk(
    chunk: any,
    streamMode: "messages" | "updates" | "values" | undefined,
  ): any {
    if (!streamMode || streamMode === "messages") {
      return chunk;
    }

    if (streamMode === "updates") {
      if (chunk && typeof chunk === "object") {
        if (chunk.data !== undefined) {
          return chunk.data;
        }
        if (chunk.content !== undefined) {
          return chunk.content;
        }
      }
      return chunk;
    }

    if (streamMode === "values") {
      if (chunk && typeof chunk === "object") {
        if (chunk.messages !== undefined) {
          const messages = chunk.messages;
          if (Array.isArray(messages) && messages.length > 0) {
            return messages[messages.length - 1];
          }
        }
        if (chunk.data !== undefined) {
          return chunk.data;
        }
      }
      return chunk;
    }

    return chunk;
  }

  private _extractChunkText(
    chunk: any,
    transport: TransportKind | null,
  ): string {
    const parser = ChatClient._parserForPayload(chunk, transport);
    return parser.extractChunkText(chunk);
  }

  private _updateTape(
    prepared: PreparedChat,
    responseText: string | null,
    options: {
      toolCalls?: Record<string, any>[] | null;
      toolResults?: any[] | null;
      error?: ErrorPayload | null;
      response?: any | null;
      provider?: string | null;
      model?: string | null;
      usage?: Record<string, any> | null;
    } = {},
  ): void {
    if (!prepared.shouldUpdate || prepared.tape === null) {
      return;
    }
    this._tape.recordChat(
      prepared.tape,
      prepared.runId,
      prepared.systemPrompt || undefined,
      prepared.contextError || undefined,
      prepared.newMessages,
      responseText || undefined,
      options.toolCalls || undefined,
      options.toolResults || undefined,
      options.error || undefined,
      options.response,
      options.provider || undefined,
      options.model || undefined,
      options.usage || undefined,
    );
  }

  private async _updateTapeAsync(
    prepared: PreparedChat,
    responseText: string | null,
    options: {
      toolCalls?: Record<string, any>[] | null;
      toolResults?: any[] | null;
      error?: ErrorPayload | null;
      response?: any | null;
      provider?: string | null;
      model?: string | null;
      usage?: Record<string, any> | null;
    } = {},
  ): Promise<void> {
    if (!prepared.shouldUpdate || prepared.tape === null) {
      return;
    }
    await this._asyncTape.recordChat(
      prepared.tape,
      prepared.runId,
      prepared.systemPrompt || undefined,
      prepared.contextError || undefined,
      prepared.newMessages,
      responseText || undefined,
      options.toolCalls || undefined,
      options.toolResults || undefined,
      options.error || undefined,
      options.response,
      options.provider || undefined,
      options.model || undefined,
      options.usage || undefined,
    );
  }

  private async _buildAsyncTextStream(
    prepared: PreparedChat,
    response: any,
    providerName: string,
    modelId: string,
    attempt: number,
  ): Promise<AsyncTextStream> {
    const { transport, streamMode, payload } = response;
    const state: StreamState = { error: null, usage: null };
    const parts: string[] = [];
    const assembler = new ToolCallAssembler();
    let usage: Record<string, any> | null = null;

    const self = this;

    async function* _iterator(): AsyncGenerator<string> {
      try {
        if (transport === "stream" && Symbol.asyncIterator in payload) {
          for await (const chunk of payload) {
            const processedChunk = self._processStreamChunk(chunk, streamMode);
            const deltas = self._extractChunkToolCallDeltas(
              processedChunk,
              transport,
            );
            if (deltas && deltas.length > 0) {
              assembler.addDeltas(deltas);
            }
            const text = self._extractChunkText(processedChunk, transport);
            if (text) {
              parts.push(text);
              yield text;
            }
            usage = self._extractUsage(processedChunk, transport) || usage;
          }
        } else if (Array.isArray(payload)) {
          for (const chunk of payload) {
            const processedChunk = self._processStreamChunk(chunk, streamMode);
            const deltas = self._extractChunkToolCallDeltas(
              processedChunk,
              transport,
            );
            if (deltas && deltas.length > 0) {
              assembler.addDeltas(deltas);
            }
            const text = self._extractChunkText(processedChunk, transport);
            if (text) {
              parts.push(text);
              yield text;
            }
            usage = self._extractUsage(processedChunk, transport) || usage;
          }
        } else {
          const text = self._extractText(payload, transport);
          if (text) {
            parts.push(text);
            yield text;
          }
          usage = self._extractUsage(payload, transport);
        }
      } catch (exc) {
        state.error = new ErrorPayload(ErrorKind.PROVIDER, String(exc));
      }
    }

    await this._updateTapeAsync(prepared, parts.join("") || null, {
      response: payload,
      provider: providerName,
      model: modelId,
      usage,
    });

    return new AsyncTextStream(_iterator(), state);
  }
}
