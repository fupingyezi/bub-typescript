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

  /**
   * 构造函数
   * @param name Tape名称
   * @param chatClient 聊天客户端
   * @param context Tape上下文
   */
  constructor(
    name: string,
    chatClient: ChatClient,
    context: TapeContext | null = null,
  ) {
    this._name = name;
    this._client = chatClient;
    this._localContext = context;
  }

  /**
   * 返回Tape的字符串表示
   * @returns 字符串表示
   */
  toString(): string {
    return `<Tape name=${this._name}>`;
  }

  /**
   * 获取Tape名称
   * @returns Tape名称
   */
  get name(): string {
    return this._name;
  }

  /**
   * 获取Tape上下文
   * @returns Tape上下文
   */
  get context(): TapeContext {
    return this._localContext || this._client.defaultContext;
  }

  /**
   * 设置Tape上下文
   * @param value Tape上下文
   */
  set context(value: TapeContext | null) {
    this._localContext = value;
  }
}

export class Tape extends TapeBase {
  /**
   * 读取Tape中的消息
   * @param context Tape上下文
   * @returns 消息列表
   */
  readMessages(context: TapeContext | null = null): Record<string, any>[] {
    const activeContext = context || this.context;
    return this._client["_tape"].readMessages(this._name, activeContext);
  }

  /**
   * 添加条目到Tape
   * @param entry Tape条目
   */
  append(entry: TapeEntry): void {
    this._client["_tape"].appendEntry(this._name, entry);
  }

  /**
   * 获取查询对象
   * @returns Tape查询对象
   */
  get query(): TapeQuery<TapeStore> {
    return this._client["_tape"].queryTape(this._name);
  }

  /**
   * 重置Tape
   */
  reset(): void {
    this._client["_tape"].resetTape(this._name);
  }

  /**
   * 交接Tape
   * @param name 交接名称
   * @param state 状态
   * @param meta 元数据
   * @returns Tape条目列表
   */
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

  /**
   * 发起聊天
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 聊天回复文本
   */
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

  /**
   * 获取工具调用
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 工具调用列表
   */
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

  /**
   * 执行工具
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 工具执行结果
   */
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

  /**
   * 流式发起聊天
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 异步文本流
   */
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

  /**
   * 获取流式事件
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 异步流事件
   */
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

  /**
   * 获取异步查询对象
   * @returns Tape查询对象
   */
  get queryAsync(): TapeQuery<AsyncTapeStore> {
    return this._client["_asyncTape"].queryTape(this._name);
  }

  /**
   * 异步读取Tape中的消息
   * @param context Tape上下文
   * @returns 包含消息列表的Promise
   */
  async readMessagesAsync(
    context: TapeContext | null = null,
  ): Promise<Record<string, any>[]> {
    const activeContext = context || this.context;
    return await this._client["_asyncTape"].readMessages(
      this._name,
      activeContext,
    );
  }

  /**
   * 异步添加条目到Tape
   * @param entry Tape条目
   * @returns Promise
   */
  async appendAsync(entry: TapeEntry): Promise<void> {
    await this._client["_asyncTape"].appendEntry(this._name, entry);
  }

  /**
   * 异步重置Tape
   * @returns Promise
   */
  async resetAsync(): Promise<void> {
    await this._client["_asyncTape"].resetTape(this._name);
  }

  /**
   * 异步交接Tape
   * @param name 交接名称
   * @param state 状态
   * @param meta 元数据
   * @returns 包含Tape条目列表的Promise
   */
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

  /**
   * 异步发起聊天
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 聊天回复文本
   */
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

  /**
   * 异步执行工具
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 工具执行结果
   */
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

  /**
   * 异步流式发起聊天
   * @param prompt 提示词
   * @param options 配置选项
   * @returns 异步文本流
   */
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
