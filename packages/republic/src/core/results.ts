/**
 * 处理result的相关类
 */
import { ErrorKind, StreamEventKind, ToolCall } from "@/types";

/**
 * 错误处理相关类
 */
export class ErrorPayload extends Error {
  /**
   * 错误类型
   */
  readonly kind: (typeof ErrorKind)[keyof typeof ErrorKind];
  /**
   * 错误详情
   */
  readonly details: Record<string, any> | null;

  /**
   * 构造函数
   * @param kind 错误类型
   * @param message 错误消息
   * @param details 错误详情
   */
  constructor(
    kind: (typeof ErrorKind)[keyof typeof ErrorKind],
    message: string,
    details?: Record<string, any> | null,
  ) {
    super(message);
    this.name = "ErrorPayload";
    this.kind = kind;
    this.details = details ?? null;
  }

  /**
   * 返回错误字符串表示
   * @returns 错误字符串
   */
  override toString(): string {
    return `[${this.kind}] ${this.message}`;
  }

  /**
   * 转换为字典
   * @returns 错误字典
   */
  asDict(): Record<string, any> {
    const payload: Record<string, any> = {
      kind: this.kind,
      message: this.message,
    };
    if (this.details) {
      payload.details = this.details;
    }
    return payload;
  }
}

/**
 * 流状态接口
 */
export interface StreamState {
  /**
   * 错误
   */
  error: ErrorPayload | null;
  /**
   * 使用量
   */
  usage: Record<string, any> | null;
}

/**
 * 创建流状态
 * @returns 流状态对象
 */
const createStreamState = (): StreamState => ({
  error: null,
  usage: null,
});

/**
 * 文本流类，实现可迭代接口
 */
export class TextStream implements Iterable<string> {
  private readonly _iterator: Iterator<string>;
  private readonly _state: StreamState;

  /**
   * 构造函数
   * @param iterator 迭代器
   * @param state 流状态
   */
  constructor(iterator: Iterator<string>, state?: StreamState | null) {
    this._iterator = iterator;
    this._state = state ?? createStreamState();
  }

  /**
   * 获取迭代器
   * @returns 迭代器
   */
  [Symbol.iterator](): Iterator<string> {
    return this._iterator;
  }

  /**
   * 获取错误
   * @returns 错误对象
   */
  get error(): ErrorPayload | null {
    return this._state.error;
  }

  /**
   * 获取使用量
   * @returns 使用量信息
   */
  get usage(): Record<string, any> | null {
    return this._state.usage;
  }
}

/**
 * 异步文本流类，实现异步可迭代接口
 */
export class AsyncTextStream implements AsyncIterable<string> {
  private readonly _iterator: AsyncIterator<string>;
  private readonly _state: StreamState;

  /**
   * 构造函数
   * @param iterator 异步迭代器
   * @param state 流状态
   */
  constructor(iterator: AsyncIterator<string>, state?: StreamState | null) {
    this._iterator = iterator;
    this._state = state ?? createStreamState();
  }

  /**
   * 获取异步迭代器
   * @returns 异步迭代器
   */
  [Symbol.asyncIterator](): AsyncIterator<string> {
    return this._iterator;
  }

  /**
   * 获取错误
   * @returns 错误对象
   */
  get error(): ErrorPayload | null {
    return this._state.error;
  }

  /**
   * 获取使用量
   * @returns 使用量信息
   */
  get usage(): Record<string, any> | null {
    return this._state.usage;
  }
}

/**
 * 流事件类
 */
export class StreamEvent {
  /**
   * 事件类型
   */
  readonly kind: StreamEventKind;
  /**
   * 事件数据
   */
  readonly data: Record<string, any>;

  /**
   * 构造函数
   * @param kind 事件类型
   * @param data 事件数据
   */
  constructor(kind: StreamEventKind, data: Record<string, any>) {
    this.kind = kind;
    this.data = data;
  }
}

/**
 * 流事件集合类，实现可迭代接口
 */
export class StreamEvents implements Iterable<StreamEvent> {
  private readonly _iterator: Iterator<StreamEvent>;
  private readonly _state: StreamState;

  /**
   * 构造函数
   * @param iterator 迭代器
   * @param state 流状态
   */
  constructor(iterator: Iterator<StreamEvent>, state?: StreamState | null) {
    this._iterator = iterator;
    this._state = state ?? createStreamState();
  }

  /**
   * 获取迭代器
   * @returns 迭代器
   */
  [Symbol.iterator](): Iterator<StreamEvent> {
    return this._iterator;
  }

  /**
   * 获取错误
   * @returns 错误对象
   */
  get error(): ErrorPayload | null {
    return this._state.error;
  }

  /**
   * 获取使用量
   * @returns 使用量信息
   */
  get usage(): Record<string, any> | null {
    return this._state.usage;
  }
}

/**
 * 异步流事件集合类，实现异步可迭代接口
 */
export class AsyncStreamEvents implements AsyncIterable<StreamEvent> {
  private readonly _iterator: AsyncIterator<StreamEvent>;
  private readonly _state: StreamState;

  /**
   * 构造函数
   * @param iterator 异步迭代器
   * @param state 流状态
   */
  constructor(
    iterator: AsyncIterator<StreamEvent>,
    state?: StreamState | null,
  ) {
    this._iterator = iterator;
    this._state = state ?? createStreamState();
  }

  /**
   * 获取异步迭代器
   * @returns 异步迭代器
   */
  [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
    return this._iterator;
  }

  /**
   * 获取错误
   * @returns 错误对象
   */
  get error(): ErrorPayload | null {
    return this._state.error;
  }

  /**
   * 获取使用量
   * @returns 使用量信息
   */
  get usage(): Record<string, any> | null {
    return this._state.usage;
  }
}

/**
 * 工具执行结果类
 */
export class ToolExecution {
  /**
   * 工具调用列表
   */
  readonly toolCalls: ToolCall[];
  /**
   * 工具结果列表
   */
  readonly toolResults: any[];
  /**
   * 错误
   */
  readonly error: ErrorPayload | null;

  /**
   * 构造函数
   * @param toolCalls 工具调用列表
   * @param toolResults 工具结果列表
   * @param error 错误
   */
  constructor(
    toolCalls: ToolCall[] = [],
    toolResults: any[] = [],
    error: ErrorPayload | null = null,
  ) {
    this.toolCalls = toolCalls;
    this.toolResults = toolResults;
    this.error = error;
  }
}

/**
 * 工具自动结果类型
 */
export type ToolAutoResultKind = "text" | "tools" | "error";

/**
 * 工具自动结果类
 */
export class ToolAutoResult {
  /**
   * 结果类型
   */
  readonly kind: ToolAutoResultKind;
  /**
   * 文本
   */
  readonly text: string | null;
  /**
   * 工具调用列表
   */
  readonly toolCalls: ToolCall[];
  /**
   * 工具结果列表
   */
  readonly toolResults: any[];
  /**
   * 错误
   */
  readonly error: ErrorPayload | null;

  /**
   * 私有构造函数
   * @param kind 结果类型
   * @param text 文本
   * @param toolCalls 工具调用列表
   * @param toolResults 工具结果列表
   * @param error 错误
   */
  private constructor(
    kind: ToolAutoResultKind,
    text: string | null,
    toolCalls: ToolCall[],
    toolResults: any[],
    error: ErrorPayload | null,
  ) {
    this.kind = kind;
    this.text = text;
    this.toolCalls = toolCalls;
    this.toolResults = toolResults;
    this.error = error;
  }

  /**
   * 创建文本结果
   * @param text 文本
   * @returns 工具自动结果
   */
  static textResult(text: string): ToolAutoResult {
    return new ToolAutoResult("text", text, [], [], null);
  }

  /**
   * 创建工具结果
   * @param toolCalls 工具调用列表
   * @param toolResults 工具结果列表
   * @returns 工具自动结果
   */
  static toolsResult(
    toolCalls: ToolCall[],
    toolResults: any[],
  ): ToolAutoResult {
    return new ToolAutoResult("tools", null, toolCalls, toolResults, null);
  }

  /**
   * 创建错误结果
   * @param error 错误
   * @param options 选项
   * @param options.toolCalls 工具调用列表
   * @param options.toolResults 工具结果列表
   * @returns 工具自动结果
   */
  static errorResult(
    error: ErrorPayload,
    options: {
      toolCalls?: ToolCall[];
      toolResults?: any[];
    } = {},
  ): ToolAutoResult {
    const { toolCalls = [], toolResults = [] } = options;
    return new ToolAutoResult("error", null, toolCalls, toolResults, error);
  }
}
