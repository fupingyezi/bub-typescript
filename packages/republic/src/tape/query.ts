import { TapeQuery as TapeContextInterface, AsyncTapeStore } from "@/types";

/**
 * tape查询器，负责根据查询条件从tape中提取数据
 */
export class TapeQuery<T> implements TapeContextInterface<T> {
  tape: string;
  store: T;
  _query?: string; // 模糊查询值
  _afterAnchor?: string; // 指定锚点，从该锚点开始查询
  _afterLast?: boolean; // 是否从最后一个锚点开始查询
  _betweenAnchors?: [string, string]; // 指定锚点范围，从start到end
  _betweenDates?: [string, string]; // 指定日期范围，从start到end
  _kinds?: string[]; // 指定消息类型
  _limit?: number; // 限制返回结果数量

  constructor(tape: string, store: T) {
    this.tape = tape;
    this.store = store;
  }

  query(value: string): TapeContextInterface<T> {
    this._query = value;
    return this;
  }

  afterAnchor(name: string): TapeContextInterface<T> {
    this._afterAnchor = name;
    return this;
  }

  lastAnchor(): TapeContextInterface<T> {
    this._afterLast = true;
    return this;
  }

  betweenAnchors(start: string, end: string): TapeContextInterface<T> {
    this._betweenAnchors = [start, end];
    return this;
  }

  betweenDates(start: string, end: string): TapeContextInterface<T> {
    this._betweenDates = [start, end];
    return this;
  }

  kinds(...kinds: string[]): TapeContextInterface<T> {
    this._kinds = kinds;
    return this;
  }

  limit(value: number): TapeContextInterface<T> {
    this._limit = value;
    return this;
  }

  all(): T extends AsyncTapeStore ? Promise<any[]> : any[] {
    if (typeof (this.store as any).fetchAll === "function") {
      return (this.store as any).fetchAll(this) as any;
    }
    return [] as any;
  }
}
