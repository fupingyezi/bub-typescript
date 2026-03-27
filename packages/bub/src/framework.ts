import { EventEmitter } from "node:events";
import * as path from "node:path";
import {
  Envelope,
  MessageHandler,
  OutboundChannelRouter,
  TurnResult,
  BubHooks,
} from "./types";
import { contentOf, fieldOf, unpackBatch } from "./envelope";
import { HookRuntime } from "./hook-runtime";
import { BubPluginManager } from "./plugin-manager";
import { BuiltinImpl } from "./builtin";
import { BubFirstResultHooks, BubBroadcastHooks } from "./hookspecs";
import { Channel } from "./channels/base";

export interface PluginStatus {
  isSuccess: boolean;
  detail?: string;
}

/**
 * bub 核心框架类，负责插件管理、消息处理、频道管理和钉子调用。
 */
export class BubFramework {
  workspace: string;
  private _pluginManager: BubPluginManager;
  private _hookRuntime: HookRuntime;
  private _pluginStatus: Record<string, PluginStatus> = {};
  private _outboundRouter: OutboundChannelRouter | null = null;

  /**
   * 获取 HookRuntime 实例。
   */
  get hookRuntime(): HookRuntime {
    return this._hookRuntime;
  }

  constructor() {
    this.workspace = path.resolve(process.cwd());
    this._pluginManager = new BubPluginManager();
    this._hookRuntime = new HookRuntime(this._pluginManager);
  }

  /**
   * 加载内置钩子实现（`BuiltinImpl`）并注册到插件管理器。
   * 注册失败时记录错误状态但不抛出异常。
   */
  loadBuiltinHooks(): void {
    const impl = new BuiltinImpl(this);

    try {
      this._pluginManager.register("builtin", impl as BubHooks, 0);
      this._pluginStatus["builtin"] = { isSuccess: true };
    } catch (exc: any) {
      this._pluginStatus["builtin"] = { isSuccess: false, detail: String(exc) };
    }
  }

  /**
   * 加载所有钩子实现：先加载内置钩子，再通过入口点加载外部插件。
   * 外部插件加载失败时仅记录警告，不中断流程。
   */
  async loadHooks(): Promise<void> {
    this.loadBuiltinHooks();

    try {
      let entryPoints: any[] = [];
      try {
        entryPoints = [];
      } catch {
        entryPoints = [];
      }
      for (const entryPoint of entryPoints) {
        try {
          const plugin = entryPoint.load();
          const instance = typeof plugin === "function" ? plugin(this) : plugin;
          this._pluginManager.register(
            entryPoint.name || entryPoint.name,
            instance as BubHooks,
            0,
          );
          this._pluginStatus[entryPoint.name] = { isSuccess: true };
        } catch (exc: any) {
          this._pluginStatus[entryPoint.name] = {
            isSuccess: false,
            detail: String(exc),
          };
        }
      }
    } catch (exc) {
      console.warn("[BubFramework] Failed to load external plugins:", exc);
    }
  }

  /**
   * 创建 CLI 应用实例，并触发所有插件的 `registerCliCommands` 钩子。
   * @returns CLI 应用对象（EventEmitter）
   */
  createCliApp(): any {
    const app: any = new EventEmitter();
    app.name = "bub";
    app.help = "Batteries-included, hook-first AI framework";

    this._hookRuntime.callMany("registerCliCommands", [app]);

    return app;
  }

  /**
   * 处理一条入站消息，执行完整的请求-响应生命周期：
   * 1. 解析 session ID
   * 2. 加载运行时状态
   * 3. 构建 prompt
   * 4. 调用模型
   * 5. 保存状态
   * 6. 收集并分发出站消息
   *
   * @param inbound - 入站消息信封
   * @returns 包含 sessionId、prompt、modelOutput、outbounds 的 TurnResult
   * @throws 若处理过程中发生错误，触发 `onError` 钩子后重新抛出
   */
  async processInbound(inbound: Envelope): Promise<TurnResult> {
    try {
      let sessionId = (await this._hookRuntime.callFirst(
        "resolveSession" as keyof BubFirstResultHooks,
        [inbound],
      )) as string | undefined;
      if (!sessionId) {
        sessionId = this._defaultSessionId(inbound);
      }
      if (inbound && typeof inbound === "object" && !inbound.session_id) {
        inbound.session_id = sessionId;
      }

      const state: Record<string, any> = { _runtime_workspace: this.workspace };
      const stateResults = await this._hookRuntime.callMany(
        "loadState" as keyof BubBroadcastHooks,
        [inbound, sessionId],
      );
      for (const hookState of stateResults.reverse()) {
        if (hookState && typeof hookState === "object") {
          Object.assign(state, hookState);
        }
      }

      let prompt = await this._hookRuntime.callFirst(
        "buildPrompt" as keyof BubFirstResultHooks,
        [inbound, sessionId, state],
      );
      if (!prompt) {
        prompt = contentOf(inbound);
      }

      let modelOutput = "";
      try {
        const result = await this._hookRuntime.callFirst(
          "runModel" as keyof BubFirstResultHooks,
          [prompt, sessionId, state],
        );
        if (result === null || result === undefined) {
          await this._hookRuntime.notifyError(
            "run_model:fallback",
            new Error("no model skill returned output"),
            inbound,
          );
          modelOutput =
            typeof prompt === "string" ? prompt : contentOf(inbound);
        } else {
          modelOutput = String(result);
        }
      } finally {
        await this._hookRuntime.callMany(
          "saveState" as keyof BubBroadcastHooks,
          [sessionId, state, inbound, modelOutput],
        );
      }

      const outbounds = await this._collectOutbounds(
        inbound,
        sessionId,
        state,
        modelOutput,
      );

      for (const outbound of outbounds) {
        await this._hookRuntime.callMany(
          "dispatchOutbound" as keyof BubBroadcastHooks,
          [outbound],
        );
      }

      return {
        sessionId: String(sessionId),
        prompt: typeof prompt === "string" ? prompt : contentOf(inbound),
        modelOutput,
        outbounds,
      };
    } catch (exc: any) {
      await this._hookRuntime.notifyError("turn", exc, inbound);
      throw exc;
    }
  }

  /**
   * 返回所有已注册插件的钩子实现报告。
   * @returns 以钩子名为 key、实现该钩子的插件名数组为 value 的对象
   */
  hookReport(): Record<string, string[]> {
    return this._pluginManager.hooksReport;
  }

  /**
   * 同步获取 TapeStore 实例（通过 `provideTapeStore` 钩子）。
   * @returns TapeStore 实例，若无插件实现则返回 `null`
   */
  getTapeStore() {
    return this._hookRuntime.callFirstSync(
      "provideTapeStore" as keyof BubFirstResultHooks,
      [],
    );
  }

  /**
   * 收集所有插件的系统提示词片段并拼接为完整系统提示词。
   * 各片段按插件注册顺序逆序排列，以双换行分隔。
   * @param prompt - 当前用户 prompt
   * @param state - 运行时状态
   * @returns 拼接后的系统提示词字符串
   */
  async getSystemPrompt(
    prompt: string | Record<string, any>[],
    state: Record<string, any>,
  ): Promise<string> {
    const results = await this._hookRuntime.emitBroadcast<string>(
      "systemPrompt" as keyof BubBroadcastHooks,
      [prompt, state],
    );
    return results
      .filter((r: string) => r)
      .reverse()
      .join("\n\n");
  }

  /**
   * 通过 `provideChannels` 钩子收集所有可用 Channel，以 channel 名为 key 去重后返回。
   * @param messageHandler - 消息处理回调函数
   * @returns 以 channel 名为 key 的 Channel 字典
   */
  async getChannels(
    messageHandler: MessageHandler,
  ): Promise<Record<string, Channel>> {
    const channels: Record<string, Channel> = {};
    const results = await this._hookRuntime.emitBroadcast<Channel[]>(
      "provideChannels" as keyof BubBroadcastHooks,
      [messageHandler],
    );
    for (const result of results) {
      if (result) {
        for (const channel of result) {
          if (channel.name && !channels[channel.name]) {
            channels[channel.name] = channel;
          }
        }
      }
    }
    return channels;
  }

  /**
   * 绑定出站消息路由器。传入 `null` 时解绑。
   * @param router - 出站路由器实例，或 `null`
   */
  bindOutboundRouter(router: OutboundChannelRouter | null): void {
    this._outboundRouter = router;
  }

  /**
   * 通过已绑定的出站路由器分发消息。
   * 若未绑定路由器则返回 `false`。
   * @param message - 待分发的消息信封
   * @returns 分发成功返回 `true`，否则返回 `false`
   */
  async dispatchViaRouter(message: Envelope): Promise<boolean> {
    if (!this._outboundRouter) {
      return false;
    }
    return this._outboundRouter.dispatch(message);
  }

  /**
   * 生成默认 session ID。
   * 优先使用消息中的 `session_id` 字段，否则拼接 `channel:chat_id`。
   * @param message - 消息信封
   * @returns 默认 session ID 字符串
   */
  private _defaultSessionId(message: Envelope): string {
    const sessionId = fieldOf(message, "session_id");
    if (sessionId !== undefined) {
      return String(sessionId);
    }
    const channel = String(fieldOf(message, "channel", "default"));
    const chatId = String(fieldOf(message, "chat_id", "default"));
    return `${channel}:${chatId}`;
  }

  /**
   * 收集所有插件渲染的出站消息。
   * 若所有插件均未返回出站消息，则生成一条包含 `modelOutput` 的默认回复。
   * @param message - 原始入站消息
   * @param sessionId - 当前 session ID
   * @param state - 运行时状态
   * @param modelOutput - 模型输出文本
   * @returns 出站消息信封数组
   */
  private async _collectOutbounds(
    message: Envelope,
    sessionId: string,
    state: Record<string, any>,
    modelOutput: string,
  ): Promise<Envelope[]> {
    const batches = await this._hookRuntime.callMany(
      "renderOutbound" as keyof BubBroadcastHooks,
      [message, sessionId, state, modelOutput],
    );

    const outbounds: Envelope[] = [];
    for (const batch of batches) {
      outbounds.push(...unpackBatch(batch));
    }

    if (outbounds.length > 0) {
      return outbounds;
    }

    const fallback: Record<string, any> = {
      content: modelOutput,
      session_id: sessionId,
    };
    const channel = fieldOf(message, "channel");
    const chatId = fieldOf(message, "chat_id");
    if (channel !== undefined) {
      fallback.channel = channel;
    }
    if (chatId !== undefined) {
      fallback.chat_id = chatId;
    }
    return [fallback];
  }
}
