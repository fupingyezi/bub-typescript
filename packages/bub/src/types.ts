import { BubFirstResultHooks, BubBroadcastHooks } from "./hookspecs";

/** 任意消息信封类型。 */
export type Envelope = any;
/** 运行时状态对象类型。 */
export type State = Record<string, any>;
/** 消息处理回调函数类型。 */
export type MessageHandler = (envelope: Envelope) => Promise<any>;
/** 出站消息分发器函数类型。 */
export type OutboundDispatcher = (envelope: Envelope) => Promise<boolean>;
/** CLI 应用对象类型。 */
export type CliApp = any;
/** prompt 内容类型，支持字符串或多模态消息数组。 */
export type PromptContent = string | Array<Record<string, any>>;

export interface OutboundChannelRouter {
  dispatch: (message: Envelope) => Promise<boolean>;
  quit: (sessionId: string) => Promise<void>;
}

export interface TurnResult {
  readonly sessionId: string;
  readonly prompt: string;
  readonly modelOutput: string;
  readonly outbounds: Envelope[];
}

export { BubFirstResultHooks, BubBroadcastHooks };

export type BubHooks = BubFirstResultHooks & BubBroadcastHooks;

export interface PluginMeta {
  name: string;
  instance: BubHooks;
  priority: number;
}

export const BUB_HOOK_NAMES: (keyof BubHooks)[] = [
  // First result hooks
  "resolveSession",
  "loadState",
  "buildPrompt",
  "runModel",
  "provideTapeStore",
  "buildTapeContext",
  // Broadcast hooks
  "saveState",
  "renderOutbound",
  "dispatchOutbound",
  "registerCliCommands",
  "onError",
  "systemPrompt",
  "provideChannels",
];
