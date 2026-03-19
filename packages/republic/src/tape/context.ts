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
   */
  get [Symbol.toStringTag](): string {
    return "LAST_ANCHOR";
  }
}

export const LAST_ANCHOR = LastAnchor.getInstance();

export type AnchorSelector = typeof LAST_ANCHOR | string | null;

/**
 * 管理上下文，决定进入提示词的tape窗口
 */
export class TapeContext implements TapeContextInterface {
  public readonly anchor: AnchorSelector; // 决定进入上下文tape窗口的锚点
  public readonly select: selectMessage | null;
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

export function buildMessage(
  entries: Iterable<TapeEntry>,
  context: TapeContextInterface,
): Record<string, any>[] {
  if (context.select) {
    return context.select(entries, context);
  }
  return defaultMessage(entries);
}

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
