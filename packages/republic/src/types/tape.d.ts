import { AnchorSelector } from "@/tape/context";

export type TapeEntryKind =
  | "message"
  | "event"
  | "anchor"
  | "error"
  | "system"
  | "tool_call"
  | "tool_result";

export interface ErrorPayload {
  message: string;
  code?: string;
  details?: Record<string, any>;
  as_dict(): Record<string, any>;
}

export interface TapeEntry {
  id: number;
  kind: TapeEntryKind;
  payload: any;
  meta: Record<string, any>;
  timestamp: string;

  copy(): TapeEntry;
}

export type selectMessage = (
  entries: Iterable<TapeEntry>,
  context: TapeContext,
) => Record<string, any>[];

export interface TapeContext {
  anchor: AnchorSelector;
  select: selectMessage | null;
  state: Record<string, any>;
  buildQuery<T>(query: TapeQuery<T>): TapeQuery<T>;
}

export interface TapeStore {
  listTapes(): string[];
  reset(tape: string): void;
  fetchAll(query: TapeQuery<TapeStore>): TapeEntry[];
  append(tape: string, entry: TapeEntry): void;
}

export interface AsyncTapeStore {
  listTapes(): Promise<string[]>;
  reset(tape: string): Promise<void>;
  fetchAll(query: TapeQuery<TapeStore>): Promise<TapeEntry[]>;
  append(tape: string, entry: TapeEntry): Promise<void>;
}

export interface TapeQuery<T> {
  tape: string;
  store: T;
  _query?: string;
  _afterAnchor?: string;
  _afterLast?: boolean;
  _betweenAnchors?: [string, string];
  _betweenDates?: [string, string];
  _kinds?: string[];
  _limit?: number;

  query(value: string): TapeQuery<T>;
  afterAnchor(name: string): TapeQuery<T>;
  lastAnchor(): TapeQuery<T>;
  betweenAnchors(start: string, end: string): TapeQuery<T>;
  betweenDates(start: string, end: string): TapeQuery<T>;
  kinds(...kinds: string[]): TapeQuery<T>;
  limit(value: number): TapeQuery<T>;

  all(): T extends AsyncTapeStore ? Promise<TapeEntry[]> : TapeEntry[];
}

/**
 * 管理器接口
 */

export interface TapeManager {
  tapeStore: TapeStore;
  globalContext: TapeContext;
  defaultContext: TapeContext;

  getDefaultContext(): TapeContext;
  setDefaultContext(context: TapeContext): void;

  getTapeList(): string[];
  readMessages(tape: string, context?: TapeContext): any[];

  appendEntry(tape: string, entry: TapeEntry): void;
  queryTape(tape: string): TapeQuery<TapeStore>;
  resetTape(tape: string): void;

  handoff(
    tape: string,
    name: string,
    state?: Record<string, any>,
    meta?: Record<string, any>,
  ): TapeEntry[];

  recordChat(
    tape: string,
    runId: string,
    systemPrompt?: string,
    contextError?: any,
    newMessages?: Record<string, any>[],
    responseText?: string,
    toolCalls?: Record<string, any>[],
    toolResults?: any[], // toolResults 不一定是 Record，可能是任意类型
    error?: any,
    response?: any,
    provider?: string,
    model?: string,
    usage?: Record<string, any>,
  ): void;
}

export interface AsyncTapeManager {
  tapeStore: AsyncTapeStore;
  globalContext: TapeContext;
  defaultContext: TapeContext;

  setDefaultContext(context: TapeContext): void;
  getDefaultContext(): TapeContext;

  getTapeList(): Promise<string[]>;

  readMessages(tape: string, context?: TapeContext): Promise<any[]>;

  appendEntry(tape: string, entry: TapeEntry): Promise<void>;

  queryTape(tape: string): TapeQuery<AsyncTapeStore>;

  resetTape(tape: string): Promise<void>;

  handoff(
    tape: string,
    name: string,
    state?: Record<string, any>,
    meta?: Record<string, any>,
  ): Promise<TapeEntry[]>;

  recordChat(
    tape: string,
    runId: string,
    systemPrompt?: string,
    contextError?: any,
    newMessages?: Record<string, any>[],
    responseText?: string,
    toolCalls?: Record<string, any>[],
    toolResults?: any[],
    error?: any,
    response?: any,
    provider?: string,
    model?: string,
    usage?: Record<string, any>,
  ): Promise<void>;
}
