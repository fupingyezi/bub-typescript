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

  /**
   * 获取默认上下文
   * @returns Tape上下文
   */
  get defaultContext(): TapeContext {
    return this._tape.defaultContext;
  }

  /**
   * 判断响应是否为传输响应
   * @param response 响应对象
   * @returns 是否为传输响应
   */
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

  /**
   * 解包响应数据
   * @param response 响应对象
   * @returns [payload, transport]元组
   */
  private static _unwrapResponse(response: any): [any, TransportKind | null] {
    if (ChatClient._isTransportResponse(response)) {
      return [response.payload, response.transport];
    }
    return [response, null];
  }

  /**
   * 解析响应格式
   * @param payload 响应载荷
   * @param transport 传输类型
   * @param streamMode 流模式，可选
   * @returns 响应格式
   */
  private static _resolveResponseFormat(
    payload: any,
    transport: TransportKind | null = null,
    streamMode?: "messages" | "updates" | "values",
  ): ResponseFormat {
    if (streamMode) {
      if (streamMode === "messages") {
        return "messages";
      }
      if (streamMode === "updates" || streamMode === "values") {
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
        if (
          typeof eventType === "string" &&
          eventType.startsWith("response.")
        ) {
          return "responses";
        }
        return "completion";
      }
    }

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

  /**
   * 根据载荷获取解析器
   * @param payload 响应载荷
   * @param transport 传输类型
   * @param streamMode 流模式，可选
   * @returns 解析器
   */
  private static _parserForPayload(
    payload: any,
    transport: TransportKind | null = null,
    streamMode?: "messages" | "updates" | "values",
  ): any {
    const responseFormat = ChatClient._resolveResponseFormat(
      payload,
      transport,
      streamMode,
    );
    return parserForTransport(responseFormat);
  }

  /**
   * 验证聊天输入
   * @param prompt 提示词
   * @param messages 消息列表
   * @param systemPrompt 系统提示词
   * @param tape Tape名称
   */
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

  /**
   * 准备消息
   * @param prompt 提示词
   * @param systemPrompt 系统提示词
   * @param tape Tape名称
   * @param messages 消息列表
   * @param context Tape上下文
   * @returns [payload, newMessages]元组
   */
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

  /**
   * 异步准备消息
   * @param prompt 提示词
   * @param systemPrompt 系统提示词
   * @param tape Tape名称
   * @param messages 消息列表
   * @param context Tape上下文
   * @returns 包含[payload, newMessages]元组的Promise
   */
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

  /**
   * 准备请求
   * @param prompt 提示词
   * @param systemPrompt 系统提示词
   * @param messages 消息列表
   * @param tape Tape名称
   * @param context Tape上下文
   * @param tools 工具输入
   * @param requireTools 是否需要工具
   * @param requireRunnable 是否需要可执行工具
   * @returns PreparedChat对象
   */
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

  /**
   * 异步准备请求
   * @param prompt 提示词
   * @param systemPrompt 系统提示词
   * @param messages 消息列表
   * @param tape Tape名称
   * @param context Tape上下文
   * @param tools 工具输入
   * @param requireTools 是否需要工具
   * @param requireRunnable 是否需要可执行工具
   * @returns 包含PreparedChat对象的Promise
   */
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

  /**
   * 规范化工具
   * @param tools 工具输入
   * @returns ToolSet
   */
  private _normalizeTools(tools: ToolInput): ToolSet {
    try {
      return normalizeTools(tools);
    } catch (exc) {
      throw new ErrorPayload(ErrorKind.INVALID_INPUT, String(exc));
    }
  }

  /**
   * 异步获取工具调用
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 工具调用列表
   */
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
      false,
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

  /**
   * 创建聊天回复
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 聊天回复文本
   */
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

  /**
   * 流式创建聊天回复
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 异步文本流
   */
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
      stream?: boolean;
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
      stream = true,
      streamMode,
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
      undefined,
      kwargs,
      stream,
      streamMode,
    );

    return this._buildAsyncTextStream(
      prepared,
      response,
      provider || this._core.provider,
      model || this._core.model,
      0,
    );
  }

  /**
   * 异步获取流式事件
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 异步流事件
   */
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
      stream?: boolean;
      streamMode?: "messages" | "updates" | "values";
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
      stream = true,
      streamMode,
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
      undefined,
      kwargs,
      stream,
      streamMode,
    );

    return this._buildAsyncStreamEvents(
      prepared,
      response,
      provider || this._core.provider,
      model || this._core.model,
    );
  }

  /**
   * 构建异步流事件
   * @param prepared PreparedChat对象
   * @param response 响应
   * @param providerName 提供商名称
   * @param modelId 模型ID
   * @returns 异步流事件
   */
  private async _buildAsyncStreamEvents(
    prepared: PreparedChat,
    response: any,
    providerName: string,
    modelId: string,
  ): Promise<AsyncStreamEvents> {
    const { transport, streamMode, payload } = response;
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
            const processedChunk = self._processStreamChunk(chunk, streamMode);
            const deltas = self._extractChunkToolCallDeltas(
              processedChunk,
              transport,
              streamMode,
            );
            if (deltas && deltas.length > 0) {
              assembler.addDeltas(deltas);
              for (const delta of deltas) {
                yield new StreamEvent("tool_call", delta);
              }
            }
            const text = self._extractChunkText(
              processedChunk,
              transport,
              streamMode,
            );
            if (text) {
              finalText += text;
              yield new StreamEvent("text", { delta: text });
            }
            const chunkUsage = self._extractUsage(processedChunk, transport);
            if (chunkUsage) {
              usage = chunkUsage;
            }
          }
        } else if (Array.isArray(payload)) {
          for (const chunk of payload) {
            const processedChunk = self._processStreamChunk(chunk, streamMode);
            const deltas = self._extractChunkToolCallDeltas(
              processedChunk,
              transport,
              streamMode,
            );
            if (deltas && deltas.length > 0) {
              assembler.addDeltas(deltas);
              for (const delta of deltas) {
                yield new StreamEvent("tool_call", delta);
              }
            }
            const text = self._extractChunkText(
              processedChunk,
              transport,
              streamMode,
            );
            if (text) {
              finalText += text;
              yield new StreamEvent("text", { delta: text });
            }
            const chunkUsage = self._extractUsage(processedChunk, transport);
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
            yield new StreamEvent("text", { delta: text });
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

  /**
   * 提取文本
   * @param payload 载荷
   * @param transport 传输类型
   * @returns 文本
   */
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

  /**
   * 提取使用量
   * @param payload 载荷
   * @param transport 传输类型
   * @returns 使用量信息
   */
  private _extractUsage(
    payload: any,
    transport: TransportKind | null,
  ): Record<string, any> | null {
    const parser = ChatClient._parserForPayload(payload, transport);
    return parser.extractUsage(payload);
  }

  /**
   * 提取工具调用增量
   * @param chunk 数据块
   * @param transport 传输类型
   * @param streamMode 流模式
   * @returns 工具调用增量数组
   */
  private _extractChunkToolCallDeltas(
    chunk: any,
    transport: TransportKind | null,
    streamMode?: "messages" | "updates" | "values",
  ): any[] {
    const parser = ChatClient._parserForPayload(chunk, transport, streamMode);
    return parser.extractChunkToolCallDeltas(chunk);
  }

  /**
   * 处理流数据块
   * @param chunk 数据块
   * @param streamMode 流模式
   * @returns 处理后的数据块
   */
  private _processStreamChunk(
    chunk: any,
    streamMode: "messages" | "updates" | "values" | undefined,
  ): any {
    if (!streamMode || streamMode === "messages") {
      return chunk;
    }

    if (streamMode === "updates") {
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

  /**
   * 提取数据块文本
   * @param chunk 数据块
   * @param transport 传输类型
   * @param streamMode 流模式
   * @returns 文本
   */
  private _extractChunkText(
    chunk: any,
    transport: TransportKind | null,
    streamMode?: "messages" | "updates" | "values",
  ): string {
    const parser = ChatClient._parserForPayload(chunk, transport, streamMode);
    return parser.extractChunkText(chunk);
  }

  /**
   * 更新Tape
   * @param prepared PreparedChat对象
   * @param responseText 回复文本
   * @param options 选项
   */
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

  /**
   * 异步更新Tape
   * @param prepared PreparedChat对象
   * @param responseText 回复文本
   * @param options 选项
   * @returns Promise
   */
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

  /**
   * 构建异步文本流
   * @param prepared PreparedChat对象
   * @param response 响应
   * @param providerName 提供商名称
   * @param modelId 模型ID
   * @param attempt 尝试次数
   * @returns 异步文本流
   */
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
              streamMode,
            );
            if (deltas && deltas.length > 0) {
              assembler.addDeltas(deltas);
            }
            const text = self._extractChunkText(
              processedChunk,
              transport,
              streamMode,
            );
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
              streamMode,
            );
            if (deltas && deltas.length > 0) {
              assembler.addDeltas(deltas);
            }
            const text = self._extractChunkText(
              processedChunk,
              transport,
              streamMode,
            );
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
