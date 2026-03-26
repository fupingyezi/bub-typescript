import { AsyncTapeStore, TapeContext, TapeStore } from "republic";
import { Envelope, MessageHandler, State, PromptContent } from "./types";
import { Channel } from "./channels/base";

type TyperApp = any;

export interface BubFirstResultHooks {
  resolveSession?(message: Envelope): Promise<string> | string;
  loadState?(message: Envelope, sessionId: string): Promise<State> | State;
  buildPrompt?(
    message: Envelope,
    sessionId: string,
    state: State,
  ): Promise<PromptContent> | PromptContent;
  runModel?(
    prompt: PromptContent,
    sessionId: string,
    state: State,
  ): Promise<string> | string;
  provideTapeStore?():
    | Promise<TapeStore | AsyncTapeStore>
    | (TapeStore | AsyncTapeStore);
  buildTapeContext?(): Promise<TapeContext> | TapeContext;
  dispatchOutbound?(message: Envelope): Promise<boolean> | boolean;
}

export interface BubBroadcastHooks {
  saveState?(
    sessionId: string,
    state: State,
    message: Envelope,
    modelOutput: string,
  ): Promise<void> | void;
  renderOutbound?(
    message: Envelope,
    sessionId: string,
    state: State,
    modelOutput: string,
  ): Promise<Envelope[]> | Envelope[];
  dispatchOutbound?(message: Envelope): Promise<boolean> | boolean;
  registerCliCommands?(app: TyperApp): void | Promise<void>;
  onError?(
    stage: string,
    error: Error,
    message: Envelope | null,
  ): void | Promise<void>;
  systemPrompt?(
    prompt: PromptContent,
    state: State,
  ): Promise<PromptContent> | PromptContent;
  provideChannels?(
    messageHandler: MessageHandler,
  ): Promise<Channel[]> | Channel[];
}

export type BubHooks = BubFirstResultHooks & BubBroadcastHooks;
