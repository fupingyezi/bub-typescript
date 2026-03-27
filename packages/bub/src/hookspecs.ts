import { AsyncTapeStore, TapeContext, TapeStore } from "republic";
import { Envelope, MessageHandler, State, PromptContent } from "./types";
import { Channel } from "./channels/base";

type TyperApp = any;

/**
 * "首个有效结果"钩子接口。
 * 框架按插件优先级顺序调用，返回第一个非 null/undefined 的结果。
 */
export interface BubFirstResultHooks {
  /** 解析入站消息的 session ID。 */
  resolveSession?(message: Envelope): Promise<string> | string;
  /** 加载指定 session 的运行时状态。 */
  loadState?(message: Envelope, sessionId: string): Promise<State> | State;
  /** 根据消息和状态构建模型输入 prompt。 */
  buildPrompt?(
    message: Envelope,
    sessionId: string,
    state: State,
  ): Promise<PromptContent> | PromptContent;
  /** 调用模型并返回输出文本。 */
  runModel?(
    prompt: PromptContent,
    sessionId: string,
    state: State,
  ): Promise<string> | string;
  /** 提供 TapeStore 实例。 */
  provideTapeStore?():
    | Promise<TapeStore | AsyncTapeStore>
    | (TapeStore | AsyncTapeStore);
  /** 构建 TapeContext 实例。 */
  buildTapeContext?(): Promise<TapeContext> | TapeContext;
  /** 分发出站消息到对应 channel。 */
  dispatchOutbound?(message: Envelope): Promise<boolean> | boolean;
}

/**
 * "广播"钩子接口。
 * 框架会调用所有实现了对应钩子的插件，收集所有返回值。
 */
export interface BubBroadcastHooks {
  /** 保存 session 运行时状态。 */
  saveState?(
    sessionId: string,
    state: State,
    message: Envelope,
    modelOutput: string,
  ): Promise<void> | void;
  /** 将模型输出渲染为出站消息列表。 */
  renderOutbound?(
    message: Envelope,
    sessionId: string,
    state: State,
    modelOutput: string,
  ): Promise<Envelope[]> | Envelope[];
  /** 分发出站消息到对应 channel。 */
  dispatchOutbound?(message: Envelope): Promise<boolean> | boolean;
  /** 向 CLI 应用注册命令。 */
  registerCliCommands?(app: TyperApp): void | Promise<void>;
  /** 处理处理流程中发生的错误。 */
  onError?(
    stage: string,
    error: Error,
    message: Envelope | null,
  ): void | Promise<void>;
  /** 提供系统提示词片段。 */
  systemPrompt?(
    prompt: PromptContent,
    state: State,
  ): Promise<PromptContent> | PromptContent;
  /** 提供可用的 Channel 列表。 */
  provideChannels?(
    messageHandler: MessageHandler,
  ): Promise<Channel[]> | Channel[];
}

export type BubHooks = BubFirstResultHooks & BubBroadcastHooks;
