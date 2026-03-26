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

export class BubFramework {
  workspace: string;
  private _pluginManager: BubPluginManager;
  private _hookRuntime: HookRuntime;
  private _pluginStatus: Record<string, PluginStatus> = {};
  private _outboundRouter: OutboundChannelRouter | null = null;

  get hookRuntime(): HookRuntime {
    return this._hookRuntime;
  }

  constructor() {
    this.workspace = path.resolve(process.cwd());
    this._pluginManager = new BubPluginManager();
    this._hookRuntime = new HookRuntime(this._pluginManager);
  }

  loadBuiltinHooks(): void {
    const impl = new BuiltinImpl(this);

    try {
      this._pluginManager.register("builtin", impl as BubHooks, 0);
      this._pluginStatus["builtin"] = { isSuccess: true };
    } catch (exc: any) {
      this._pluginStatus["builtin"] = { isSuccess: false, detail: String(exc) };
    }
  }

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

  createCliApp(): any {
    const app: any = new EventEmitter();
    app.name = "bub";
    app.help = "Batteries-included, hook-first AI framework";

    this._hookRuntime.callMany("registerCliCommands", [app]);

    return app;
  }

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

  hookReport(): Record<string, string[]> {
    return this._pluginManager.hooksReport;
  }

  getTapeStore() {
    return this._hookRuntime.callFirstSync(
      "provideTapeStore" as keyof BubFirstResultHooks,
      [],
    );
  }

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

  bindOutboundRouter(router: OutboundChannelRouter | null): void {
    this._outboundRouter = router;
  }

  async dispatchViaRouter(message: Envelope): Promise<boolean> {
    if (!this._outboundRouter) {
      return false;
    }
    return this._outboundRouter.dispatch(message);
  }

  private _defaultSessionId(message: Envelope): string {
    const sessionId = fieldOf(message, "session_id");
    if (sessionId !== undefined) {
      return String(sessionId);
    }
    const channel = String(fieldOf(message, "channel", "default"));
    const chatId = String(fieldOf(message, "chat_id", "default"));
    return `${channel}:${chatId}`;
  }

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
