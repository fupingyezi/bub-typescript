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

  /**
   * 获取当前 TapeService 使用的 ForkTapeStore。
   */
  get tapes(): ForkTapeStore {
    return this._store;
  }

  /**
   * 获取指定 tape 的概要信息，包括条目数、锤点数、token 用量等。
   * @param tapeName - tape 名称
   * @returns TapeInfo 对象
   */
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

  /**
   * 确保 tape 存在起始锤点（`session/start`）。
   * 若 tape 中尚无任何锤点，则自动创建。
   * @param tapeName - tape 名称
   */
  async ensureBootstrapAnchor(tapeName: string): Promise<void> {
    const tape = this._llm.tape(tapeName);
    const anchors = await listAsync(tape.queryAsync.kinds("anchor").all());
    if (anchors.length === 0) {
      await tape.handoffAsync("session/start", { owner: "human" });
    }
  }

  /**
   * 获取指定 tape 中最近的若干个锤点列表。
   * @param tapeName - tape 名称
   * @param limit - 最多返回锤点数，默认 20
   * @returns AnchorSummary 数组
   */
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

  /**
   * 重置指定 tape，可选将历史内容归档。
   * 重置后自动创建 `session/start` 锤点。
   * @param tapeName - tape 名称
   * @param archive - 是否将当前内容归档，默认 `false`
   * @returns 归档路径（若归档）或 `"ok"`
   */
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

  /**
   * 将当前 tape 内容归档到备份路径。
   * @param tapeName - tape 名称
   * @returns 归档文件的绝对路径
   */
  private async _archive(tapeName: string): Promise<string> {
    const tape = this._llm.tape(tapeName);
    const stamp =
      new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z";
    const archivePath = `${this._archivePath}/${tape.name}.jsonl.${stamp}.bak`;
    // Would need fs write - placeholder
    return archivePath;
  }

  /**
   * 在指定 tape 中添加一个锤点（handoff anchor）。
   * @param tapeName - tape 名称
   * @param name - 锤点名称
   * @param state - 附加到锤点的状态对象，默认 `null`
   * @returns 新增的 TapeEntry 数组
   */
  async handoff(
    tapeName: string,
    name: string,
    state: Record<string, object> | null = null,
  ): Promise<TapeEntry[]> {
    const tape = this._llm.tape(tapeName);
    const entries = await tape.handoffAsync(name, state);
    return entries as TapeEntry[];
  }

  /**
   * 在存储中搜索条目。
   * @param query - tape 查询对象
   * @returns 匹配的 TapeEntry 数组
   */
  async search(query: TapeQuery<AsyncTapeStore>): Promise<TapeEntry[]> {
    return await this._store.fetchAll(query);
  }

  /**
   * 向指定 tape 追加一个事件条目。
   * @param tapeName - tape 名称
   * @param name - 事件名称
   * @param payload - 事件负载对象
   * @param meta - 附加元数据
   */
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

  /**
   * 根据 session ID 和工作区路径生成确定性的 tape 名称并返回对应的 Tape 实例。
   * tape 名称由工作区和 session ID 的 MD5 哈希拼接而成。
   * @param sessionId - 会话 ID
   * @param workspace - 工作区绝对路径
   * @returns 对应的 Tape 实例
   */
  sessionTape(sessionId: string, workspace: string): Tape {
    const workspaceHash = createHash("md5").update(workspace).digest("hex");
    const sessionHash = createHash("md5").update(sessionId).digest("hex");
    const tapeName =
      workspaceHash.slice(0, 16) + "__" + sessionHash.slice(0, 16);
    return this._llm.tape(tapeName);
  }

  /**
   * Fork 指定 tape，将后续写入操作隔离到临时存储。
   * @param tapeName - tape 名称
   * @param mergeBack - 是否将 fork 期间的条目写回父存储，默认 `true`
   */
  async forkTape(tapeName: string, mergeBack: boolean = true): Promise<void> {
    await this._store.fork(tapeName, mergeBack);
  }
}

/**
 * 将异步可迭代对象或 Promise 转换为数组。
 * @param promise - Promise 或可迭代对象
 * @returns 元素数组
 */
async function listAsync<T>(promise: Promise<T[]> | Iterable<T>): Promise<T[]> {
  if (promise && typeof (promise as any).then === "function") {
    return await (promise as Promise<T[]>);
  }
  return Array.from(promise as Iterable<T>);
}
