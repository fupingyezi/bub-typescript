import { TapeQuery as TapeContextInterface, AsyncTapeStore } from "@/types";

/**
 * Tape查询器类，负责根据查询条件从tape中提取数据
 */
export class TapeQuery<T> implements TapeContextInterface<T> {
  /**
   * Tape名称
   */
  tape: string;
  /**
   * 存储
   */
  store: T;
  /**
   * 模糊查询值
   */
  _query?: string;
  /**
   * 指定锚点，从该锚点开始查询
   */
  _afterAnchor?: string;
  /**
   * 是否从最后一个锚点开始查询
   */
  _afterLast?: boolean;
  /**
   * 指定锚点范围，从start到end
   */
  _betweenAnchors?: [string, string];
  /**
   * 指定日期范围，从start到end
   */
  _betweenDates?: [string, string];
  /**
   * 指定消息类型
   */
  _kinds?: string[];
  /**
   * 限制返回结果数量
   */
  _limit?: number;

  /**
   * 构造函数
   * @param tape Tape名称
   * @param store 存储
   */
  constructor(tape: string, store: T) {
    this.tape = tape;
    this.store = store;
  }

  /**
   * 设置模糊查询
   * @param value 查询值
   * @returns this
   */
  query(value: string): TapeContextInterface<T> {
    this._query = value;
    return this;
  }

  /**
   * 设置锚点查询
   * @param name 锚点名称
   * @returns this
   */
  afterAnchor(name: string): TapeContextInterface<T> {
    this._afterAnchor = name;
    return this;
  }

  /**
   * 设置从最后一个锚点开始查询
   * @returns this
   */
  lastAnchor(): TapeContextInterface<T> {
    this._afterLast = true;
    return this;
  }

  /**
   * 设置锚点范围查询
   * @param start 起始锚点
   * @param end 结束锚点
   * @returns this
   */
  betweenAnchors(start: string, end: string): TapeContextInterface<T> {
    this._betweenAnchors = [start, end];
    return this;
  }

  /**
   * 设置日期范围查询
   * @param start 起始日期
   * @param end 结束日期
   * @returns this
   */
  betweenDates(start: string, end: string): TapeContextInterface<T> {
    this._betweenDates = [start, end];
    return this;
  }

  /**
   * 设置消息类型过滤
   * @param kinds 消息类型
   * @returns this
   */
  kinds(...kinds: string[]): TapeContextInterface<T> {
    this._kinds = kinds;
    return this;
  }

  /**
   * 设置返回结果数量限制
   * @param value 限制数量
   * @returns this
   */
  limit(value: number): TapeContextInterface<T> {
    this._limit = value;
    return this;
  }

  /**
   * 执行查询
   * @returns 查询结果
   */
  all(): T extends AsyncTapeStore ? Promise<any[]> : any[] {
    if (typeof (this.store as any).fetchAll === "function") {
      return (this.store as any).fetchAll(this) as any;
    }
    return [] as any;
  }
}
