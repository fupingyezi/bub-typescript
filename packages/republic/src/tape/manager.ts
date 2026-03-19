import {
  TapeManager as TapeManagerInterface,
  AsyncTapeManager as AsyncTapeManagerInterface,
  TapeStore,
  AsyncTapeStore,
  TapeContext,
  TapeQuery,
} from "@/types";
import { TapeQuery as TapeQueryImpl } from "./query";
import { TapeEntry } from "./entries";
import { buildMessage } from "./context";

/**
 * 在深层嵌套对象中查找唯一的属性值。
 * 前提：保证该属性名在对象树中只出现一次。
 *
 * @param obj 要搜索的对象
 * @param key 目标属性名 (字符串)
 * @returns 找到的值 (类型 T)，如果没找到返回 undefined
 */
function findUniqueAttribute<T>(obj: any, key: string): T | undefined {
  if (obj === null || typeof obj !== "object") {
    return undefined;
  }

  if (Object.hasOwn(obj, key)) {
    return obj[key] as T;
  }

  for (const value of Object.values(obj)) {
    const result = findUniqueAttribute<T>(value, key);

    if (result !== undefined) {
      return result;
    }
  }

  return undefined;
}

/**
 * tape管理器，负责管理所有tape的上下文和数据，包括读取、写入、查询、重置、设置锚点等操作
 */
export class TapeManager implements TapeManagerInterface {
  tapeStore: TapeStore;
  globalContext: TapeContext;
  defaultContext: TapeContext;

  constructor(tapeStore: TapeStore, tapeContext: TapeContext) {
    this.tapeStore = tapeStore;
    this.globalContext = tapeContext;
    this.defaultContext = tapeContext;
  }

  getDefaultContext(): TapeContext {
    return this.defaultContext;
  }

  setDefaultContext(context: TapeContext): void {
    this.defaultContext = context;
  }

  getTapeList(): string[] {
    return this.tapeStore.listTapes();
  }

  readMessages(tape: string, context?: TapeContext): any[] {
    const activeContext = context || this.globalContext;
    let query = this.queryTape(tape);
    query = activeContext.buildQuery(query);
    return buildMessage(this.tapeStore.fetchAll(query), activeContext);
  }

  appendEntry(tape: string, entry: TapeEntry): void {
    this.tapeStore.append(tape, entry);
  }

  queryTape(tape: string): TapeQuery<TapeStore> {
    return new TapeQueryImpl(tape, this.tapeStore);
  }

  resetTape(tape: string): void {
    this.tapeStore.reset(tape);
  }

  /**
   * 给tape锚定锚点，并记录交接事件
   */
  handoff(
    tape: string,
    name: string,
    state?: Record<string, any>,
    meta?: Record<string, any>,
  ): TapeEntry[] {
    const entry = TapeEntry.anchor(name, state, meta);
    const event = TapeEntry.event("handoff", { name, state });
    this.tapeStore.append(tape, entry);
    this.tapeStore.append(tape, event);
    return [entry, event];
  }

  /**
   * 记录一次完整的chat事件, 把所有相关信息都记录到tape中
   */
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
  ): void {
    const meta = { runId: runId };
    if (systemPrompt) {
      this.tapeStore.append(tape, TapeEntry.system(systemPrompt, meta));
    }
    if (contextError) {
      this.tapeStore.append(tape, TapeEntry.error(contextError, meta));
    }

    for (const message of newMessages || []) {
      this.tapeStore.append(tape, TapeEntry.message(message, meta));
    }

    if (toolCalls) {
      this.tapeStore.append(tape, TapeEntry.toolCall(toolCalls, meta));
    }
    if (toolResults) {
      this.tapeStore.append(tape, TapeEntry.toolResult(toolResults, meta));
    }

    if (error && !contextError.includes(error)) {
      this.tapeStore.append(tape, TapeEntry.error(error, meta));
    }

    if (responseText) {
      this.tapeStore.append(
        tape,
        TapeEntry.message({ role: "assistant", content: responseText }, meta),
      );
    }

    const data: Record<string, any> = { status: error ? "error" : "ok" };
    const resolveUsage = usage ?? TapeManager.extractUsage(response);
    if (resolveUsage) {
      data.usage = resolveUsage;
    }
    if (provider) {
      data.provider = provider;
    }
    if (model) {
      data.model = model;
    }
    this.tapeStore.append(tape, TapeEntry.event("run", data, meta));
  }

  static extractUsage(response: any): Record<string, number> | null {
    const usage = findUniqueAttribute<Record<string, number>>(
      response,
      "usage",
    );
    if (!usage) {
      return null;
    }
    if (usage instanceof Object) {
      return usage;
    }
    return null;
  }
}

/**
 * 异步版本的TapeManager
 */
export class AsyncTapeManager implements AsyncTapeManagerInterface {
  tapeStore: AsyncTapeStore;
  globalContext: TapeContext;
  defaultContext: TapeContext;

  constructor(tapeStore: AsyncTapeStore, tapeContext: TapeContext) {
    this.tapeStore = tapeStore;
    this.globalContext = tapeContext;
    this.defaultContext = tapeContext;
  }

  setDefaultContext(context: TapeContext): void {
    this.defaultContext = context;
  }

  getDefaultContext(): TapeContext {
    return this.defaultContext;
  }

  async getTapeList(): Promise<string[]> {
    return this.tapeStore.listTapes();
  }

  async readMessages(tape: string, context?: TapeContext): Promise<any[]> {
    const activeContext = context || this.globalContext;
    let query = this.queryTape(tape);
    query = activeContext.buildQuery(query);
    const entries = await this.tapeStore.fetchAll(query);
    return buildMessage(entries, activeContext);
  }

  async appendEntry(tape: string, entry: TapeEntry): Promise<void> {
    await this.tapeStore.append(tape, entry);
  }

  queryTape(tape: string): TapeQuery<AsyncTapeStore> {
    return new TapeQueryImpl(tape, this.tapeStore);
  }

  async resetTape(tape: string): Promise<void> {
    await this.tapeStore.reset(tape);
  }

  async handoff(
    tape: string,
    name: string,
    state?: Record<string, any>,
    meta?: Record<string, any>,
  ): Promise<TapeEntry[]> {
    const entry = TapeEntry.anchor(name, state, meta);
    const event = TapeEntry.event("handoff", { name, state });
    await this.tapeStore.append(tape, entry);
    await this.tapeStore.append(tape, event);
    return [entry, event];
  }

  async recordChat(
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
  ): Promise<void> {
    const meta = { runId: runId };
    if (systemPrompt) {
      await this.tapeStore.append(tape, TapeEntry.system(systemPrompt, meta));
    }
    if (contextError) {
      await this.tapeStore.append(tape, TapeEntry.error(contextError, meta));
    }

    for (const message of newMessages || []) {
      await this.tapeStore.append(tape, TapeEntry.message(message, meta));
    }

    if (toolCalls) {
      await this.tapeStore.append(tape, TapeEntry.toolCall(toolCalls, meta));
    }
    if (toolResults) {
      await this.tapeStore.append(
        tape,
        TapeEntry.toolResult(toolResults, meta),
      );
    }

    if (error && !contextError.includes(error)) {
      await this.tapeStore.append(tape, TapeEntry.error(error, meta));
    }

    if (responseText) {
      await this.tapeStore.append(
        tape,
        TapeEntry.message({ role: "assistant", content: responseText }, meta),
      );
    }

    const data: Record<string, any> = { status: error ? "error" : "ok" };
    const resolveUsage = usage ?? TapeManager.extractUsage(response);
    if (resolveUsage) {
      data.usage = resolveUsage;
    }
    if (provider) {
      data.provider = provider;
    }
    if (model) {
      data.model = model;
    }
    await this.tapeStore.append(tape, TapeEntry.event("run", data, meta));
  }
}
