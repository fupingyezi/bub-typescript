/**
 * Tape条目模块
 */

import {
  TapeEntry as TapeEntryInterface,
  TapeEntryKind,
  ErrorPayload,
} from "@/types";

/**
 * Tape条目实现类
 */
export class TapeEntry implements TapeEntryInterface {
  /**
   * 唯一标识符
   */
  public readonly id: number;
  /**
   * 条目类型
   */
  public readonly kind: TapeEntryKind;
  /**
   * 条目载荷
   */
  public readonly payload: any;
  /**
   * 条目元数据
   */
  public readonly meta: Record<string, any>;
  /**
   * 时间戳
   */
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

  /**
   * 复制条目
   * @returns 条目副本
   */
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
   * 获取字符串表示
   * @returns 字符串表示
   */
  toString(): string {
    return JSON.stringify(
      {
        id: this.id,
        kind: this.kind,
        payload: this.payload,
        meta: this.meta,
        timestamp: this.timestamp,
      },
      null,
      2,
    );
  }

  /**
   * 创建消息条目
   * @param message 消息载荷
   * @param meta 元数据
   * @returns TapeEntry
   */
  static message(
    message: Record<string, any>,
    meta: Record<string, any> = {},
  ): TapeEntry {
    return new TapeEntry(0, "message", message, meta);
  }

  /**
   * 创建系统消息条目
   * @param content 内容
   * @param meta 元数据
   * @returns TapeEntry
   */
  static system(content: string, meta: Record<string, any> = {}): TapeEntry {
    return new TapeEntry(0, "system", { content }, meta);
  }

  /**
   * 创建锚点条目
   * @param name 锚点名称
   * @param state 状态
   * @param meta 元数据
   * @returns TapeEntry
   */
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

  /**
   * 创建工具调用条目
   * @param calls 工具调用列表
   * @param meta 元数据
   * @returns TapeEntry
   */
  static toolCall(
    calls: Record<string, any>[],
    meta: Record<string, any> = {},
  ): TapeEntry {
    return new TapeEntry(0, "tool_call", { calls: [...calls] }, meta);
  }

  /**
   * 创建工具结果条目
   * @param results 结果列表
   * @param meta 元数据
   * @returns TapeEntry
   */
  static toolResult(results: any[], meta: Record<string, any> = {}): TapeEntry {
    return new TapeEntry(0, "tool_result", { results: [...results] }, meta);
  }

  /**
   * 创建错误条目
   * @param error 错误对象
   * @param meta 元数据
   * @returns TapeEntry
   */
  static error(error: ErrorPayload, meta: Record<string, any> = {}): TapeEntry {
    return new TapeEntry(0, "error", error.as_dict(), meta);
  }

  /**
   * 创建事件条目
   * @param name 事件名称
   * @param data 事件数据
   * @param meta 元数据
   * @returns TapeEntry
   */
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

/**
 * 创建Tape条目
 * @param kind 条目类型
 * @param payload 条目载荷
 * @param meta 条目元数据
 * @param timestamp 时间戳
 * @returns Tape条目
 */
export function createTapeEntry(
  kind: TapeEntryKind,
  payload: any = {},
  meta: Record<string, any> = {},
  timestamp?: string,
): TapeEntry {
  return new TapeEntry(generateId(), kind, payload, meta, timestamp);
}

/**
 * 生成唯一ID
 * @returns 唯一ID
 */
function generateId(): number {
  return Date.now();
}
