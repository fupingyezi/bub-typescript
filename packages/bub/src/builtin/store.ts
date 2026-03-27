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

  get(): TapeStore {
    return this._value!;
  }

  set(store: TapeStore): string {
    const token = Math.random().toString(36);
    this._tokens.push(token);
    this._value = store;
    return token;
  }

  reset(token: string): void {
    const index = this._tokens.indexOf(token);
    if (index > 0) {
      this._tokens.splice(index, 1);
      this._value = null;
    }
  }
}

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

  private _isAsyncTapeStore(store: any): store is AsyncTapeStore {
    return (
      typeof store.listTapes === "function" &&
      typeof store.reset === "function" &&
      typeof store.fetchAll === "function" &&
      typeof store.append === "function"
    );
  }

  async listTapes(): Promise<string[]> {
    return await this._parent.listTapes();
  }

  async reset(tape: string): Promise<void> {
    this._current.reset(tape);
    await this._parent.reset(tape);
  }

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

  async append(tape: string, entry: TapeEntry): Promise<void> {
    this._current.append(tape, entry);
  }

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

export class FileTapeStore implements TapeStore {
  private _directory: string;
  private _tapeFiles: Map<string, TapeFile> = new Map();

  constructor(directory: string) {
    this._directory = directory;
  }

  private _tapeFile(tape: string): TapeFile {
    if (!this._tapeFiles.has(tape)) {
      this._tapeFiles.set(
        tape,
        new TapeFile(`${this._directory}/${tape}.jsonl`),
      );
    }
    return this._tapeFiles.get(tape)!;
  }

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

  private _getEntryText(entry: TapeEntry): string {
    const payload = entry.payload as Record<string, any>;
    if (typeof payload.content === "string") return payload.content;
    if (typeof payload.text === "string") return payload.text;
    if (typeof payload.prompt === "string") return payload.prompt;
    return JSON.stringify(payload);
  }

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

  reset(tape: string): void {
    this._tapeFile(tape).reset();
  }

  append(tape: string, entry: TapeEntry): void {
    this._ensureDirectory();
    this._tapeFile(tape).append(entry);
  }

  read(tape: string): TapeEntry[] | null {
    return this._tapeFile(tape).read();
  }

  private _ensureDirectory(): void {
    if (!fs.existsSync(this._directory)) {
      fs.mkdirSync(this._directory, { recursive: true });
    }
  }
}

export class TapeFile {
  private _path: string;
  private _readEntries: TapeEntry[] = [];
  private _readOffset: number = 0;

  constructor(path: string) {
    this._path = path;
  }

  private _nextId(): number {
    if (this._readEntries.length > 0) {
      const lastEntry = this._readEntries[this._readEntries.length - 1];
      return (lastEntry.id as number) + 1;
    }
    return 1;
  }

  private _reset(): void {
    this._readEntries = [];
    this._readOffset = 0;
  }

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
