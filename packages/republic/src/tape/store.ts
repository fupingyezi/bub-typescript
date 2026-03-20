import {
  TapeEntry,
  TapeQuery,
  TapeStore as TapeStoreInterface,
  AsyncTapeStore as AsyncTapeStoreInterface,
} from "@/types";
import { TapeEntry as TapeEntryImpl } from "./entries";

export function isAsyncTapeStore(
  store: TapeStoreInterface | AsyncTapeStoreInterface,
): store is AsyncTapeStoreInterface {
  const appendMethod = (store as any).append;
  if (typeof appendMethod !== "function") return false;

  return typeof (store as any)._isAsync === "boolean"
    ? (store as any)._isAsync
    : false;
}

export function findAnchorIndex(
  entries: TapeEntry[],
  name: string | null,
  defaultIndex: number,
  forward: boolean,
  startIndex: number = 0,
): number {
  if (forward) {
    for (let i = startIndex; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.kind !== "anchor") continue;
      if (!name && entry.payload.name !== name) continue;
      return i;
    }
  } else {
    for (let i = entries.length - 1; i >= startIndex; i--) {
      const entry = entries[i];
      if (entry.kind !== "anchor") continue;
      if (!name && entry.payload.name !== name) continue;
      return i;
    }
  }
  return defaultIndex;
}

export function parseDateTimeBoundary(value: string, isEnd: boolean): Date {
  return new Date(value);
}

export function isEntryInDateRange(
  entry: TapeEntry,
  startDate: Date,
  endDate: Date,
) {
  const entryDate = new Date(entry.timestamp);
  return (
    entryDate.getTime() >= startDate.getTime() &&
    entryDate.getTime() <= endDate.getTime()
  );
}

export function isEntryMatchingQuery(entry: TapeEntry, query: string): boolean {
  const needle = query.toLowerCase();
  const haystack = JSON.stringify(
    {
      kind: entry.kind,
      date: entry.timestamp,
      payload: entry.payload,
      meta: entry.meta,
    },
    (key, value) => (value === undefined ? null : value),
  ).toLowerCase();
  return haystack.includes(needle);
}

class InMemoryQueryMixin {
  read(tape: string): TapeEntry[] | null {
    throw new Error("Method not implemented.");
  }

  fetchAll(query: TapeQuery<TapeStoreInterface>): TapeEntry[] {
    const entries = this.read(query.tape) || [];
    let startIndex = 0;
    let endIndex: number | null = null;

    if (
      query._betweenAnchors !== undefined &&
      query._betweenAnchors.length > 0
    ) {
      const [startTapeName, endTapeName] = query._betweenAnchors;
      startIndex = findAnchorIndex(entries, startTapeName, -1, false);
      if (startIndex < 0) {
        throw new Error("Start anchor not found.");
      }
      endIndex = findAnchorIndex(
        entries,
        endTapeName,
        -1,
        true,
        startIndex + 1,
      );
      if (endIndex < 0) {
        throw new Error("End anchor not found.");
      }
    } else if (query._afterLast) {
      const anchorIndex = findAnchorIndex(entries, null, -1, false);
      if (anchorIndex < 0) {
        throw new Error("No anchor found.");
      }
      startIndex = Math.min(anchorIndex + 1, entries.length);
    } else if (query._afterAnchor) {
      const anchorIndex = findAnchorIndex(
        entries,
        query._afterAnchor,
        -1,
        false,
      );
      if (anchorIndex < 0) {
        throw new Error("Anchor not found.");
      }
      startIndex = Math.min(anchorIndex + 1, entries.length);
    }

    let slicedEntries = entries.slice(startIndex, endIndex ?? entries.length);

    if (query._betweenDates !== undefined && query.betweenDates.length > 0) {
      const [startDate, endDate] = query._betweenDates;
      const startDateTime = parseDateTimeBoundary(startDate, false);
      const endDateTime = parseDateTimeBoundary(endDate, true);
      if (startDateTime.getTime() > endDateTime.getTime()) {
        throw new Error("Start date must be before end date.");
      }
      slicedEntries = slicedEntries.filter((entry) =>
        isEntryInDateRange(entry, startDateTime, endDateTime),
      );
    }

    if (query._query) {
      slicedEntries = slicedEntries.filter((entry) =>
        isEntryMatchingQuery(entry, query._query || ""),
      );
    }

    if (query._kinds) {
      slicedEntries = slicedEntries.filter((entry) =>
        query._kinds ? query._kinds.includes(entry.kind) : true,
      );
    }

    if (query._limit) {
      slicedEntries = slicedEntries.slice(0, query._limit);
    }

    return slicedEntries;
  }
}

export class InMemoryTapeStore
  extends InMemoryQueryMixin
  implements TapeStoreInterface
{
  private _tapes: Map<string, TapeEntryImpl[]> = new Map();
  private _nextId: Record<string, number> = {};

  constructor() {
    super();
  }

  listTapes(): string[] {
    return [...this._tapes.keys()].sort();
  }

  reset(tape: string): void {
    this._tapes.set(tape, []);
    this._nextId[tape] = 0;
  }

  read(tape: string): TapeEntry[] | null {
    const entries = this._tapes.get(tape);
    if (!entries) {
      return null;
    }
    return entries.map((entry) => entry.copy());
  }

  append(tape: string, entry: TapeEntry): void {
    const nextId = this._nextId[tape] || 0;
    this._nextId[tape] = nextId + 1;
    const stored = new TapeEntryImpl(
      nextId,
      entry.kind,
      Object.assign({}, entry.payload),
      Object.assign({}, entry.meta),
      entry.timestamp,
    );
    this._tapes.set(tape, [...(this._tapes.get(tape) || []), stored]);
  }
}

export class AsyncTapeStoreAdapter implements AsyncTapeStoreInterface {
  private _store: TapeStoreInterface;
  public readonly _isAsync: boolean = true;

  constructor(store: TapeStoreInterface) {
    this._store = store;
  }

  async listTapes(): Promise<string[]> {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(this._store.listTapes());
      }, 0);
    });
  }

  async reset(tape: string): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        this._store.reset(tape);
        resolve();
      }, 0);
    });
  }

  async fetchAll(query: TapeQuery<AsyncTapeStoreInterface>): Promise<TapeEntry[]> {
    return new Promise((resolve) => {
      setTimeout(() => {
        if (this._store instanceof InMemoryQueryMixin) {
          // @ts-ignore - 类型转换，因为内部存储是同步的
          resolve(this._store.fetchAll(query));
        } else {
          resolve([]);
        }
      }, 0);
    });
  }

  async append(tape: string, entry: TapeEntry): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        this._store.append(tape, entry);
        resolve();
      }, 0);
    });
  }
}
