import { BubFirstResultHooks, BubBroadcastHooks } from "./hookspecs";

export type Envelope = any;
export type State = Record<string, any>;
export type MessageHandler = (envelope: Envelope) => Promise<any>;
export type OutboundDispatcher = (envelope: Envelope) => Promise<boolean>;
export type CliApp = any;
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
  "dispatchOutbound",
  // Broadcast hooks
  "saveState",
  "renderOutbound",
  "dispatchOutbound",
  "registerCliCommands",
  "onError",
  "systemPrompt",
  "provideChannels",
];
