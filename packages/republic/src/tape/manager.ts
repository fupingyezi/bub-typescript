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
 * @param obj 要搜索的对象
 * @param key 目标属性名
 * @returns 找到的值，如果没找到返回undefined
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
 * Tape管理器，负责管理所有tape的上下文和数据，包括读取、写入、查询、重置、设置锚点等操作
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

  /**
   * 获取默认上下文
   * @returns Tape上下文
   */
  getDefaultContext(): TapeContext {
    return this.defaultContext;
  }

  /**
   * 设置默认上下文
   * @param context Tape上下文
   */
  setDefaultContext(context: TapeContext): void {
    this.defaultContext = context;
  }

  /**
   * 获取Tape列表
   * @returns Tape名称列表
   */
  getTapeList(): string[] {
    return this.tapeStore.listTapes();
  }

  /**
   * 读取Tape中的消息
   * @param tape Tape名称
   * @param context Tape上下文
   * @returns 消息列表
   */
  readMessages(tape: string, context?: TapeContext): any[] {
    const activeContext = context || this.globalContext;
    let query = this.queryTape(tape);
    query = activeContext.buildQuery(query);
    return buildMessage(this.tapeStore.fetchAll(query), activeContext);
  }

  /**
   * 添加条目到Tape
   * @param tape Tape名称
   * @param entry Tape条目
   */
  appendEntry(tape: string, entry: TapeEntry): void {
    this.tapeStore.append(tape, entry);
  }

  /**
   * 查询Tape
   * @param tape Tape名称
   * @returns Tape查询对象
   */
  queryTape(tape: string): TapeQuery<TapeStore> {
    return new TapeQueryImpl(tape, this.tapeStore);
  }

  /**
   * 重置Tape
   * @param tape Tape名称
   */
  resetTape(tape: string): void {
    this.tapeStore.reset(tape);
  }

  /**
   * 给tape锚定锚点，并记录交接事件
   * @param tape Tape名称
   * @param name 锚点名称
   * @param state 状态
   * @param meta 元数据
   * @returns Tape条目列表
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
   * 记录一次完整的chat事件，把所有相关信息都记录到tape中
   * @param tape Tape名称
   * @param runId 运行ID
   * @param systemPrompt 系统提示词
   * @param contextError 上下文错误
   * @param newMessages 新消息
   * @param responseText 回复文本
   * @param toolCalls 工具调用
   * @param toolResults 工具结果
   * @param error 错误
   * @param response 响应
   * @param provider 提供商
   * @param model 模型
   * @param usage 使用量
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

  /**
   * 从响应中提取使用量信息
   * @param response 响应对象
   * @returns 使用量信息或null
   */
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

  /**
   * 设置默认上下文
   * @param context Tape上下文
   */
  setDefaultContext(context: TapeContext): void {
    this.defaultContext = context;
  }

  /**
   * 获取默认上下文
   * @returns Tape上下文
   */
  getDefaultContext(): TapeContext {
    return this.defaultContext;
  }

  /**
   * 获取Tape列表
   * @returns 包含Tape名称的Promise
   */
  async getTapeList(): Promise<string[]> {
    return this.tapeStore.listTapes();
  }

  /**
   * 异步读取Tape中的消息
   * @param tape Tape名称
   * @param context Tape上下文
   * @returns 包含消息列表的Promise
   */
  async readMessages(tape: string, context?: TapeContext): Promise<any[]> {
    const activeContext = context || this.globalContext;
    let query = this.queryTape(tape);
    query = activeContext.buildQuery(query);
    const entries = await this.tapeStore.fetchAll(query);
    return buildMessage(entries, activeContext);
  }

  /**
   * 异步添加条目到Tape
   * @param tape Tape名称
   * @param entry Tape条目
   * @returns Promise
   */
  async appendEntry(tape: string, entry: TapeEntry): Promise<void> {
    await this.tapeStore.append(tape, entry);
  }

  /**
   * 查询Tape
   * @param tape Tape名称
   * @returns Tape查询对象
   */
  queryTape(tape: string): TapeQuery<AsyncTapeStore> {
    return new TapeQueryImpl(tape, this.tapeStore);
  }

  /**
   * 异步重置Tape
   * @param tape Tape名称
   * @returns Promise
   */
  async resetTape(tape: string): Promise<void> {
    await this.tapeStore.reset(tape);
  }

  /**
   * 异步交接Tape
   * @param tape Tape名称
   * @param name 锚点名称
   * @param state 状态
   * @param meta 元数据
   * @returns 包含Tape条目的Promise
   */
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

  /**
   * 异步记录chat事件
   * @param tape Tape名称
   * @param runId 运行ID
   * @param systemPrompt 系统提示词
   * @param contextError 上下文错误
   * @param newMessages 新消息
   * @param responseText 回复文本
   * @param toolCalls 工具调用
   * @param toolResults 工具结果
   * @param error 错误
   * @param response 响应
   * @param provider 提供商
   * @param model 模型
   * @param usage 使用量
   * @returns Promise
   */
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
