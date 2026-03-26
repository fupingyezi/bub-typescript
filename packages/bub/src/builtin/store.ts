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
              (entry.payload as Record<string, any>).get("name") ===
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
    const store = new InMemoryTapeStore();
    const token = currentStore.set(store);
    try {
      // fork scope - would need async context manager
    } finally {
      currentStore.reset(token);
      if (mergeBack) {
        const entries = (store as any).read(tape);
        if (entries) {
          for (const entry of entries) {
            await this._parent.append(tape, entry);
          }
        }
      }
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
    // Would need fs readdir - placeholder
    return [];
  }

  reset(tape: string): void {
    this._tapeFile(tape).reset();
  }

  append(tape: string, entry: TapeEntry): void {
    this._tapeFile(tape).append(entry);
  }

  read(tape: string): TapeEntry[] | null {
    return this._tapeFile(tape).read();
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
    // Would need fs unlink - placeholder
    this._reset();
  }

  read(): TapeEntry[] | null {
    // Would need fs read - placeholder
    return this._readEntries.length > 0 ? this._readEntries : null;
  }

  append(entry: TapeEntry): void {
    // Would need fs append - placeholder
    const nextId = this._nextId();
    const stored = new TapeEntry(
      nextId,
      entry.kind,
      { ...entry.payload },
      { ...entry.meta },
      entry.timestamp,
    );
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
