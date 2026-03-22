import {
  TapeContext as TapeContextInterface,
  TapeEntry,
  TapeQuery,
  selectMessage,
} from "@/types";

class LastAnchor {
  private static readonly instance = new LastAnchor();

  private constructor() {}

  public static getInstance(): LastAnchor {
    return LastAnchor.instance;
  }

  public toString(): string {
    return "LAST_ANCHOR";
  }

  /**
   * 控制对象在控制台打印时的标签 (Chrome/Node DevTools)
   * 让对象显示为 [object LAST_ANCHOR]
   * @returns 标签字符串
   */
  get [Symbol.toStringTag](): string {
    return "LAST_ANCHOR";
  }
}

export const LAST_ANCHOR = LastAnchor.getInstance();

export type AnchorSelector = typeof LAST_ANCHOR | string | null;

/**
 * Tape上下文类，管理上下文，决定进入提示词的tape窗口
 */
export class TapeContext implements TapeContextInterface {
  /**
   * 决定进入上下文tape窗口的锚点
   */
  public readonly anchor: AnchorSelector;
  /**
   * 选择器
   */
  public readonly select: selectMessage | null;
  /**
   * 状态
   */
  public readonly state: Record<string, any> = {};

  constructor(
    anchor?: AnchorSelector,
    select?: selectMessage | null,
    state?: Record<string, any>,
  ) {
    this.anchor = anchor ?? LAST_ANCHOR;
    this.select = select ?? null;
    this.state = state ? { ...state } : {};
    Object.freeze(this);
  }

  /**
   * 构建查询
   * @param query 查询对象
   * @returns 修改后的查询对象
   */
  public buildQuery<T>(query: TapeQuery<T>): TapeQuery<T> {
    if (!this.anchor) {
      return query as TapeQuery<T>;
    }
    if (this.anchor instanceof LastAnchor) {
      return query.lastAnchor();
    }
    return query.afterAnchor(this.anchor);
  }
}

/**
 * 根据上下文从tape条目构建消息
 * @param entries Tape条目
 * @param context Tape上下文
 * @returns 消息列表
 */
export function buildMessage(
  entries: Iterable<TapeEntry>,
  context: TapeContextInterface,
): Record<string, any>[] {
  if (context.select) {
    return context.select(entries, context);
  }
  return defaultMessage(entries);
}

/**
 * 构建默认消息列表
 * @param entries Tape条目
 * @returns 消息列表
 */
export function defaultMessage(
  entries: Iterable<TapeEntry>,
): Record<string, any>[] {
  const messages = [];
  for (const entry of entries) {
    if (entry.kind !== "message") {
      continue;
    }
    const payload = entry.payload;
    messages.push(payload);
  }
  return messages;
}
