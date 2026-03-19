import {
  TapeEntry as TapeEntryInterface,
  TapeEntryKind,
  ErrorPayload,
} from "@/types";

/**
 * tape条目数据类型，包含类型转换方法
 */
export class TapeEntry implements TapeEntryInterface {
  public readonly id: number;
  public readonly kind: TapeEntryKind;
  public readonly payload: any;
  public readonly meta: Record<string, any>;
  public readonly timestamp: string;

  constructor(
    id: number,
    kind: TapeEntryKind,
    payload: any,
    meta: Record<string, any>,
    timestamp?: string,
  ) {
    this.id = id;
    this.kind = kind;
    this.payload = { ...payload };
    this.meta = { ...meta };
    this.timestamp = timestamp || new Date().toISOString();
    Object.freeze(this);
  }

  copy(): TapeEntryInterface {
    return new TapeEntry(
      this.id,
      this.kind,
      this.payload,
      this.meta,
      this.timestamp,
    );
  }

  /**
   *  类型转换方法
   */
  static message(
    message: Record<string, any>,
    meta: Record<string, any> = {},
  ): TapeEntry {
    return new TapeEntry(0, "message", message, meta);
  }

  static system(content: string, meta: Record<string, any> = {}): TapeEntry {
    return new TapeEntry(0, "system", { content }, meta);
  }

  static anchor(
    name: string,
    state: Record<string, any> | null = null,
    meta: Record<string, any> = {},
  ): TapeEntry {
    const payload: Record<string, any> = { name };
    if (state !== null) {
      payload.state = { ...state };
    }
    return new TapeEntry(0, "anchor", payload, meta);
  }

  static toolCall(
    calls: Record<string, any>[],
    meta: Record<string, any> = {},
  ): TapeEntry {
    return new TapeEntry(0, "tool_call", { calls: [...calls] }, meta);
  }

  static toolResult(results: any[], meta: Record<string, any> = {}): TapeEntry {
    return new TapeEntry(0, "tool_result", { results: [...results] }, meta);
  }

  static error(error: ErrorPayload, meta: Record<string, any> = {}): TapeEntry {
    return new TapeEntry(0, "error", error.as_dict(), meta);
  }

  static event(
    name: string,
    data: Record<string, any> | null = null,
    meta: Record<string, any> = {},
  ): TapeEntry {
    const payload: Record<string, any> = { name };
    if (data !== null) {
      payload.data = { ...data };
    }
    return new TapeEntry(0, "event", payload, meta);
  }
}
