import { createHash } from "crypto";
import { LLM, Tape, TapeEntry, TapeQuery, AsyncTapeStore } from "republic";
import { ForkTapeStore } from "./store";

export interface TapeInfo {
  name: string;
  entries: number;
  anchors: number;
  lastAnchor: string | null;
  entriesSinceLastAnchor: number;
  lastTokenUsage: number | null;
}

export interface AnchorSummary {
  name: string;
  state: Record<string, object>;
}

export class TapeService {
  private _llm: LLM;
  private _archivePath: string;
  private _store: ForkTapeStore;

  constructor(llm: LLM, archivePath: string, store: ForkTapeStore) {
    this._llm = llm;
    this._archivePath = archivePath;
    this._store = store;
  }

  get tapes(): ForkTapeStore {
    return this._store;
  }

  async info(tapeName: string): Promise<TapeInfo> {
    const tape = this._llm.tape(tapeName);
    const entries = await listAsync<TapeEntry>(tape.queryAsync.all());
    const anchors = entries.filter((e) => e.kind === "anchor");
    const lastAnchorEntry = anchors.length > 0 ? anchors[anchors.length - 1] : null;
    const lastAnchor = lastAnchorEntry
      ? String((lastAnchorEntry.payload as Record<string, any>).name ?? "-")
      : null;

    let entriesSinceLastAnchor: TapeEntry[];
    if (lastAnchorEntry !== null) {
      entriesSinceLastAnchor = entries.filter(
        (e) => e.id > (lastAnchorEntry.id as number),
      );
    } else {
      entriesSinceLastAnchor = entries;
    }

    let lastTokenUsage: number | null = null;
    for (let i = entriesSinceLastAnchor.length - 1; i >= 0; i--) {
      const entry = entriesSinceLastAnchor[i];
      const payload = entry.payload as Record<string, any>;
      if (entry.kind === "event" && payload.name === "run") {
        try {
          const usage = payload.data?.usage?.total_tokens;
          if (usage && typeof usage === "number") {
            lastTokenUsage = usage;
            break;
          }
        } catch {
          // ignore
        }
      }
    }

    return {
      name: tape.name,
      entries: entries.length,
      anchors: anchors.length,
      lastAnchor: lastAnchor !== null ? String(lastAnchor) : null,
      entriesSinceLastAnchor: entriesSinceLastAnchor.length,
      lastTokenUsage,
    };
  }

  async ensureBootstrapAnchor(tapeName: string): Promise<void> {
    const tape = this._llm.tape(tapeName);
    const anchors = await listAsync(tape.queryAsync.kinds("anchor").all());
    if (anchors.length === 0) {
      await tape.handoffAsync("session/start", { owner: "human" });
    }
  }

  async anchors(
    tapeName: string,
    limit: number = 20,
  ): Promise<AnchorSummary[]> {
    const tape = this._llm.tape(tapeName);
    const entries = await listAsync<TapeEntry>(
      tape.queryAsync.kinds("anchor").all(),
    );
    const results: AnchorSummary[] = [];
    const sliced = entries.slice(-limit);

    for (const entry of sliced) {
      const payload = entry.payload as Record<string, any>;
      const name = String(payload.name ?? "-");
      const state = payload.state;
      const stateDict: Record<string, object> =
        typeof state === "object" && state !== null ? { ...state } : {};
      results.push({ name, state: stateDict });
    }

    return results;
  }

  async reset(tapeName: string, archive: boolean = false): Promise<string> {
    const tape = this._llm.tape(tapeName);
    let archivePath: string | null = null;

    if (archive) {
      archivePath = await this._archive(tapeName);
    }

    await tape.resetAsync();

    const state: Record<string, any> = { owner: "human" };
    if (archivePath !== null) {
      state["archived"] = archivePath as unknown as object;
    }

    await tape.handoffAsync("session/start", state);
    return archivePath !== null ? `Archived: ${archivePath}` : "ok";
  }

  private async _archive(tapeName: string): Promise<string> {
    const tape = this._llm.tape(tapeName);
    const stamp =
      new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z";
    const archivePath = `${this._archivePath}/${tape.name}.jsonl.${stamp}.bak`;
    // Would need fs write - placeholder
    return archivePath;
  }

  async handoff(
    tapeName: string,
    name: string,
    state: Record<string, object> | null = null,
  ): Promise<TapeEntry[]> {
    const tape = this._llm.tape(tapeName);
    const entries = await tape.handoffAsync(name, state);
    return entries as TapeEntry[];
  }

  async search(query: TapeQuery<AsyncTapeStore>): Promise<TapeEntry[]> {
    return await this._store.fetchAll(query);
  }

  async appendEvent(
    tapeName: string,
    name: string,
    payload: Record<string, any>,
    ...meta: any[]
  ): Promise<void> {
    const tape = this._llm.tape(tapeName);
    const entry = TapeEntry.event(name, payload, ...meta);
    await tape.appendAsync(entry);
  }

  sessionTape(sessionId: string, workspace: string): Tape {
    const workspaceHash = createHash("md5").update(workspace).digest("hex");
    const sessionHash = createHash("md5").update(sessionId).digest("hex");
    const tapeName =
      workspaceHash.slice(0, 16) + "__" + sessionHash.slice(0, 16);
    return this._llm.tape(tapeName);
  }

  async forkTape(tapeName: string, mergeBack: boolean = true): Promise<void> {
    await this._store.fork(tapeName, mergeBack);
  }
}

async function listAsync<T>(promise: Promise<T[]> | Iterable<T>): Promise<T[]> {
  if (promise && typeof (promise as any).then === "function") {
    return await (promise as Promise<T[]>);
  }
  return Array.from(promise as Iterable<T>);
}
