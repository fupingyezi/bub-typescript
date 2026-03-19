/**
 * 处理result的相关类
 */
import { ErrorKind, StreamEventKind, ToolCall } from "@/types";

/**
 * 错误处理相关类
 */
export class ErrorPayload extends Error {
  readonly kind: (typeof ErrorKind)[keyof typeof ErrorKind];
  readonly details: Record<string, any> | null;

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

  override toString(): string {
    return `[${this.kind}] ${this.message}`;
  }

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
 * 流状态相关类
 */
export interface StreamState {
  error: ErrorPayload | null;
  usage: Record<string, any> | null;
}

const createStreamState = (): StreamState => ({
  error: null,
  usage: null,
});

export class TextStream implements Iterable<string> {
  private readonly _iterator: Iterator<string>;
  private readonly _state: StreamState;

  constructor(iterator: Iterator<string>, state?: StreamState | null) {
    this._iterator = iterator;
    this._state = state ?? createStreamState();
  }

  [Symbol.iterator](): Iterator<string> {
    return this._iterator;
  }

  get error(): ErrorPayload | null {
    return this._state.error;
  }

  get usage(): Record<string, any> | null {
    return this._state.usage;
  }
}

export class AsyncTextStream implements AsyncIterable<string> {
  private readonly _iterator: AsyncIterator<string>;
  private readonly _state: StreamState;

  constructor(iterator: AsyncIterator<string>, state?: StreamState | null) {
    this._iterator = iterator;
    this._state = state ?? createStreamState();
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return this._iterator;
  }

  get error(): ErrorPayload | null {
    return this._state.error;
  }

  get usage(): Record<string, any> | null {
    return this._state.usage;
  }
}

export class StreamEvent {
  readonly kind: StreamEventKind;
  readonly data: Record<string, any>;

  constructor(kind: StreamEventKind, data: Record<string, any>) {
    this.kind = kind;
    this.data = data;
  }
}

export class StreamEvents implements Iterable<StreamEvent> {
  private readonly _iterator: Iterator<StreamEvent>;
  private readonly _state: StreamState;

  constructor(iterator: Iterator<StreamEvent>, state?: StreamState | null) {
    this._iterator = iterator;
    this._state = state ?? createStreamState();
  }

  [Symbol.iterator](): Iterator<StreamEvent> {
    return this._iterator;
  }

  get error(): ErrorPayload | null {
    return this._state.error;
  }

  get usage(): Record<string, any> | null {
    return this._state.usage;
  }
}

export class AsyncStreamEvents implements AsyncIterable<StreamEvent> {
  private readonly _iterator: AsyncIterator<StreamEvent>;
  private readonly _state: StreamState;

  constructor(
    iterator: AsyncIterator<StreamEvent>,
    state?: StreamState | null,
  ) {
    this._iterator = iterator;
    this._state = state ?? createStreamState();
  }

  [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
    return this._iterator;
  }

  get error(): ErrorPayload | null {
    return this._state.error;
  }

  get usage(): Record<string, any> | null {
    return this._state.usage;
  }
}

/**
 * 工具调用相关类
 */

export class ToolExecution {
  readonly toolCalls: ToolCall[];
  readonly toolResults: any[];
  readonly error: ErrorPayload | null;

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
export type ToolAutoResultKind = "text" | "tools" | "error";

export class ToolAutoResult {
  readonly kind: ToolAutoResultKind;
  readonly text: string | null;
  readonly toolCalls: ToolCall[];
  readonly toolResults: any[];
  readonly error: ErrorPayload | null;

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

  static textResult(text: string): ToolAutoResult {
    return new ToolAutoResult("text", text, [], [], null);
  }

  static toolsResult(
    toolCalls: ToolCall[],
    toolResults: any[],
  ): ToolAutoResult {
    return new ToolAutoResult("tools", null, toolCalls, toolResults, null);
  }

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
