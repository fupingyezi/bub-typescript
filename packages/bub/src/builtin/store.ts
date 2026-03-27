import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import {
  AsyncTapeStore,
  AsyncTapeStoreAdapter,
  InMemoryTapeStore,
  TapeEntry,
  TapeQuery,
  TapeStore,
} from "republic";

export class CurrentStore {
  _value: TapeStore | null = null;
  _tokens: string[] = [];

  /**
   * 获取当前活跃的 TapeStore。
   * @returns 当前 TapeStore 实例
   */
  get(): TapeStore {
    return this._value!;
  }

  /**
   * 设置新的 TapeStore 并返回一个重置令牌。
   * @param store - 新的 TapeStore 实例
   * @returns 用于后续重置的令牌字符串
   */
  set(store: TapeStore): string {
    const token = Math.random().toString(36);
    this._tokens.push(token);
    this._value = store;
    return token;
  }

  /**
   * 根据令牌重置 TapeStore。
   * @param token - 由 `set()` 返回的令牌字符串
   */
  reset(token: string): void {
    const index = this._tokens.indexOf(token);
    if (index > 0) {
      this._tokens.splice(index, 1);
      this._value = null;
    }
  }
}

/**
 * 当前活跃的 TapeStore 单例管理器。
 * 用于在请求周期内共享当前使用的 TapeStore。
 */
export const currentStore = new CurrentStore();

export class ForkTapeStore {
  private _parent: AsyncTapeStore | TapeStore;
  private _current: TapeStore;

  constructor(parent: AsyncTapeStore | TapeStore) {
    if (this._isAsyncTapeStore(parent)) {
      this._parent = parent;
    } else {
      this._parent = new AsyncTapeStoreAdapter(parent);
    }
    this._current = new InMemoryTapeStore();
  }

  /**
   * 判断一个对象是否实现了 `AsyncTapeStore` 接口。
   * @param store - 待判断的对象
   * @returns 是 AsyncTapeStore 时返回 `true`
   */
  private _isAsyncTapeStore(store: any): store is AsyncTapeStore {
    return (
      typeof store.listTapes === "function" &&
      typeof store.reset === "function" &&
      typeof store.fetchAll === "function" &&
      typeof store.append === "function"
    );
  }

  /**
   * 列出父存储中所有 tape 的名称列表。
   * @returns tape 名称数组
   */
  async listTapes(): Promise<string[]> {
    return await this._parent.listTapes();
  }

  /**
   * 重置指定 tape：清空内存存储并重置父存储。
   * @param tape - tape 名称
   */
  async reset(tape: string): Promise<void> {
    this._current.reset(tape);
    await this._parent.reset(tape);
  }

  /**
   * 获取指定 tape 的所有条目，合并父存储和内存存储的条目。
   * @param query - tape 查询对象
   * @returns 合并后的 TapeEntry 数组
   */
  async fetchAll(query: TapeQuery<AsyncTapeStore>): Promise<TapeEntry[]> {
    let parentEntries: TapeEntry[] = [];
    try {
      parentEntries = await this._parent.fetchAll(query);
    } catch {
      parentEntries = [];
    }

    const thisEntries: TapeEntry[] = [];
    if (typeof (this._current as any).read === "function") {
      const entries = (this._current as any).read(query.tape) || [];
      for (const entry of entries) {
        if (query._kinds && !query._kinds.includes(entry.kind)) {
          continue;
        }
        if (entry.kind === "anchor") {
          if (
            query._afterLast ||
            (query._afterAnchor &&
              (entry.payload as Record<string, any>)["name"] ===
                query._afterAnchor)
          ) {
            thisEntries.length = 0;
            parentEntries = [];
          }
        }
        thisEntries.push(entry);
      }
    }

    return [...parentEntries, ...thisEntries];
  }

  /**
   * 将一个条目追加到内存存储。
   * @param tape - tape 名称
   * @param entry - 要追加的 TapeEntry
   */
  async append(tape: string, entry: TapeEntry): Promise<void> {
    this._current.append(tape, entry);
  }

  /**
   * Fork 指定 tape：在 fork 期间新写入的条目会写入临时存储。
   * `mergeBack=true` 时，fork 结束后将临时存储的条目写回父存储；
   * `mergeBack=false` 时直接丢弃临时存储的数据。
   * @param tape - tape 名称
   * @param mergeBack - 是否将 fork 期间的条目写回父存储，默认 `true`
   */
  async fork(tape: string, mergeBack: boolean = true): Promise<void> {
    // 将当前 _current 中已有的条目保存，fork 期间写入新的临时存储
    const forkStore = new InMemoryTapeStore();
    const prevCurrent = this._current;
    this._current = forkStore;
    try {
      // fork 作用域：调用方在此期间执行 append 操作，写入 forkStore
      // 此方法本身不执行任何业务逻辑，由外部在 fork 后调用 append
    } finally {
      this._current = prevCurrent;
      if (mergeBack) {
        const entries = (forkStore as any).read(tape);
        if (entries) {
          for (const entry of entries) {
            await this._parent.append(tape, entry);
          }
        }
      }
      // mergeBack=false 时直接丢弃 forkStore 数据
    }
  }
}

/**
 * 空实现的 TapeStore，所有操作均为 no-op。
 * 用于占位或测试场景。
 */
export class EmptyTapeStore implements TapeStore {
  listTapes(): string[] {
    return [];
  }

  reset(tape: string): void {
    // no-op
  }

  fetchAll(query: TapeQuery<TapeStore>): TapeEntry[] {
    return [];
  }

  append(tape: string, entry: TapeEntry): void {
    // no-op
  }
}

/**
 * 基于文件系统的 TapeStore 实现，将 tape 条目以 JSONL 格式存储到磁盘。
 * 支持全量读取和关键词搜索。
 */
export class FileTapeStore implements TapeStore {
  private _directory: string;
  private _tapeFiles: Map<string, TapeFile> = new Map();

  constructor(directory: string) {
    this._directory = directory;
  }

  /**
   * 获取或创建指定 tape 的 TapeFile 实例。
   * @param tape - tape 名称
   * @returns 对应的 TapeFile 实例
   */
  private _tapeFile(tape: string): TapeFile {
    if (!this._tapeFiles.has(tape)) {
      this._tapeFiles.set(
        tape,
        new TapeFile(`${this._directory}/${tape}.jsonl`),
      );
    }
    return this._tapeFiles.get(tape)!;
  }

  /**
   * 获取指定 tape 的所有条目。
   * 若查询包含关键词，则进行内容过滤；否则返回全量条目。
   * @param query - tape 查询对象
   * @returns 匹配的 TapeEntry 数组
   */
  fetchAll(query: TapeQuery<TapeStore>): TapeEntry[] {
    if (!query._query) {
      return (this._tapeFile(query.tape).read() || []).slice(
        0,
        query._limit || undefined,
      );
    }
    const entries = this._tapeFile(query.tape).read() || [];
    return this._filterEntries(entries, query._query, query._limit || 20);
  }

  /**
   * 对条目列表进行关键词过滤，从最新条目倒序搜索，去重并限制数量。
   * @param entries - 待过滤的条目数组
   * @param query - 搜索关键词
   * @param limit - 最多返回条目数
   * @returns 匹配的 TapeEntry 数组
   */
  private _filterEntries(
    entries: TapeEntry[],
    query: string,
    limit: number,
  ): TapeEntry[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];

    const results: TapeEntry[] = [];
    const seen = new Set<string>();

    let count = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      const payloadText = this._getEntryText(entry).toLowerCase();
      if (payloadText === "") continue;
      if (seen.has(payloadText)) continue;
      seen.add(payloadText);

      if (payloadText.includes(normalizedQuery)) {
        results.push(entry);
        count++;
        if (count >= limit) break;
      }
    }
    return results;
  }

  /**
   * 提取 TapeEntry 中用于搜索的文本内容。
   * 依次尝试 `content`、`text`、`prompt` 字段，否则返回 JSON 序列化结果。
   * @param entry - 待提取的 TapeEntry
   * @returns 条目的文本表示
   */
  private _getEntryText(entry: TapeEntry): string {
    const payload = entry.payload as Record<string, any>;
    if (typeof payload.content === "string") return payload.content;
    if (typeof payload.text === "string") return payload.text;
    if (typeof payload.prompt === "string") return payload.prompt;
    return JSON.stringify(payload);
  }

  /**
   * 列出存储目录中所有 tape 的名称列表。
   * @returns tape 名称数组，目录不存在或读取失败时返回空数组
   */
  listTapes(): string[] {
    try {
      if (!fs.existsSync(this._directory)) {
        return [];
      }
      return fs
        .readdirSync(this._directory)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => f.slice(0, -6));
    } catch {
      return [];
    }
  }

  /**
   * 重置指定 tape，删除对应的 JSONL 文件。
   * @param tape - tape 名称
   */
  reset(tape: string): void {
    this._tapeFile(tape).reset();
  }

  /**
   * 将一个条目追加到指定 tape 的 JSONL 文件。
   * @param tape - tape 名称
   * @param entry - 要追加的 TapeEntry
   */
  append(tape: string, entry: TapeEntry): void {
    this._ensureDirectory();
    this._tapeFile(tape).append(entry);
  }

  /**
   * 读取指定 tape 的所有条目。
   * @param tape - tape 名称
   * @returns TapeEntry 数组，若文件不存在则返回 `null`
   */
  read(tape: string): TapeEntry[] | null {
    return this._tapeFile(tape).read();
  }

  /**
   * 确保存储目录存在，不存在时递归创建。
   */
  private _ensureDirectory(): void {
    if (!fs.existsSync(this._directory)) {
      fs.mkdirSync(this._directory, { recursive: true });
    }
  }
}

/**
 * 单个 JSONL 文件的读写封装，支持增量读取和追加写入。
 */
export class TapeFile {
  private _path: string;
  private _readEntries: TapeEntry[] = [];
  private _readOffset: number = 0;

  constructor(path: string) {
    this._path = path;
  }

  /**
   * 计算下一个条目的 ID（已有最大 ID + 1，或从 1 开始）。
   * @returns 下一个条目的 ID
   */
  private _nextId(): number {
    if (this._readEntries.length > 0) {
      const lastEntry = this._readEntries[this._readEntries.length - 1];
      return (lastEntry.id as number) + 1;
    }
    return 1;
  }

  /**
   * 重置内存缓存和读取偏移量。
   */
  private _reset(): void {
    this._readEntries = [];
    this._readOffset = 0;
  }

  /**
   * 重置 tape 文件：删除磁盘文件并清空内存缓存。
   */
  reset(): void {
    try {
      if (fs.existsSync(this._path)) {
        fs.unlinkSync(this._path);
      }
    } catch {
      // 忽略删除失败
    }
    this._reset();
  }

  /**
   * 增量读取 JSONL 文件，只处理自上次读取后新增的行。
   * @returns 所有已读取的 TapeEntry 数组，若无条目则返回 `null`
   */
  read(): TapeEntry[] | null {
    // 增量读取：只读取自上次读取后新增的行
    try {
      if (!fs.existsSync(this._path)) {
        return this._readEntries.length > 0 ? this._readEntries : null;
      }
      const content = fs.readFileSync(this._path, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      // 只处理新增的行（_readOffset 之后的行）
      const newLines = lines.slice(this._readOffset);
      for (const line of newLines) {
        try {
          const payload = JSON.parse(line);
          const entry = TapeFile.entryFromPayload(payload);
          if (entry !== null) {
            this._readEntries.push(entry);
          }
        } catch {
          // 跳过无法解析的行
        }
      }
      this._readOffset = lines.length;
    } catch {
      // 读取失败时返回已缓存的条目
    }
    return this._readEntries.length > 0 ? this._readEntries : null;
  }

  /**
   * 将一个条目追加到 JSONL 文件并更新内存缓存。
   * @param entry - 要追加的 TapeEntry
   */
  append(entry: TapeEntry): void {
    const nextId = this._nextId();
    const stored = new TapeEntry(
      nextId,
      entry.kind,
      { ...entry.payload },
      { ...entry.meta },
      entry.timestamp,
    );
    // 写入磁盘（JSONL 格式追加）
    try {
      const dir = path.dirname(this._path);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const line = JSON.stringify({
        id: stored.id,
        kind: stored.kind,
        payload: stored.payload,
        meta: stored.meta,
        date: stored.timestamp,
      }) + "\n";
      fs.appendFileSync(this._path, line, "utf-8");
      this._readOffset += 1;
    } catch {
      // 写入失败时仅保留内存缓存
    }
    this._readEntries.push(stored);
  }

  /**
   * 将原始 JSON 对象解析为 TapeEntry。
   * @param payload - 待解析的 JSON 对象
   * @returns 解析成功时返回 TapeEntry，格式不合法时返回 `null`
   */
  static entryFromPayload(payload: any): TapeEntry | null {
    if (typeof payload !== "object" || payload === null) return null;

    const entryId = payload.id;
    const kind = payload.kind;
    const entryPayload = payload.payload;
    const meta = payload.meta || {};

    if (typeof entryId !== "number") return null;
    if (typeof kind !== "string") return null;
    if (typeof entryPayload !== "object") return null;

    let date: string;
    if ("date" in payload) {
      date = payload.date;
    } else {
      const timestamp = payload.timestamp || 0;
      date = new Date(timestamp * 1000).toISOString();
    }

    return new TapeEntry(entryId, kind, { ...entryPayload }, { ...meta }, date);
  }
}
