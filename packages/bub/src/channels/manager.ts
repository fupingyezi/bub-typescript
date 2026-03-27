import { EventEmitter } from "node:events";
import { Channel } from "./base";
import { ChannelMessage } from "./message";
import { BubFramework } from "../framework";
import { Envelope, MessageHandler } from "../types";
import { fieldOf, contentOf } from "../envelope";
import { waitUntilStopped } from "../utils";

export interface ChannelSettings {
  enabledChannels: string;
  debounceSeconds: number;
  maxWaitSeconds: number;
  activeTimeWindow: number;
}

export const DEFAULT_CHANNEL_SETTINGS: ChannelSettings = {
  enabledChannels: "all",
  debounceSeconds: 1.0,
  maxWaitSeconds: 10.0,
  activeTimeWindow: 60.0,
};

/**
 * 带防抖的消息处理器，将短时间内的多条消息合并为一条。
 * 支持活跃消息防抖和非活跃消息的最大等待时间。
 */
class BufferedMessageHandler {
  private handler: (message: ChannelMessage) => Promise<void>;
  private pendingMessages: ChannelMessage[] = [];
  private lastActiveTime: number | null = null;
  private event: EventEmitter;
  private timer: NodeJS.Timeout | null = null;
  private inProcessing: boolean = false;
  private activeTimeWindow: number;
  private maxWaitSeconds: number;
  private debounceSeconds: number;

  constructor(
    handler: (message: ChannelMessage) => Promise<void>,
    options: {
      activeTimeWindow: number;
      maxWaitSeconds: number;
      debounceSeconds: number;
    },
  ) {
    this.handler = handler;
    this.event = new EventEmitter();
    this.activeTimeWindow = options.activeTimeWindow;
    this.maxWaitSeconds = options.maxWaitSeconds;
    this.debounceSeconds = options.debounceSeconds;
  }

  /**
   * 重置防抖定时器。
   * @param timeout - 延迟秒数
   */
  private resetTimer(timeout: number): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.event.emit("ready");
    }, timeout * 1000);
  }

  /**
   * 等待防抖定时器触发后处理待处理消息队列。
   * 将队列中的消息合并为一条并调用处理器。
   */
  private async process(): Promise<void> {
    return new Promise((resolve) => {
      this.event.once("ready", async () => {
        if (this.pendingMessages.length === 0) {
          resolve();
          return;
        }
        const message = ChannelMessage.formBatch(this.pendingMessages);
        this.pendingMessages = [];
        this.inProcessing = false;
        await this.handler(message);
        resolve();
      });
    });
  }

  /**
   * 接收一条消息并根据消息类型决定处理方式。
   * - 命令消息：直接处理
   * - 活跃消息：进入防抖队列
   * - 非活跃消息：在活跃时间窗口内进入队列，否则忽略
   * @param message - 待处理的 ChannelMessage
   */
  async call(message: ChannelMessage): Promise<void> {
    const now = Date.now() / 1000;
    if (message.content.startsWith(",")) {
      console.log(
        `session.message received command session_id=${message.sessionId}, content=${message.content}`,
      );
      await this.handler(message);
      return;
    }
    if (
      !message.isActive &&
      (this.lastActiveTime === null ||
        now - this.lastActiveTime > this.activeTimeWindow)
    ) {
      this.lastActiveTime = null;
      console.log(
        `session.message received ignored session_id=${message.sessionId}, content=${message.content}`,
      );
      return;
    }
    this.pendingMessages.push(message);
    if (message.isActive) {
      this.lastActiveTime = now;
      console.log(
        `session.message received active session_id=${message.sessionId}, content=${message.content}`,
      );
      this.resetTimer(this.debounceSeconds);
      if (!this.inProcessing) {
        this.inProcessing = true;
        this.process();
      }
    } else if (
      this.lastActiveTime !== null &&
      !this.inProcessing
    ) {
      console.log(
        `session.receive followup session_id=${message.sessionId} message=${message.content}`,
      );
      this.resetTimer(this.maxWaitSeconds);
      this.inProcessing = true;
      this.process();
    }
  }
}

interface Task {
  cancel?: () => void;
}

/**
 * Channel 管理器，负责启动所有 Channel、接收消息并分发到 framework 处理。
 * 支持消息防抖、出站消息路由和优雅关闭。
 */
export class ChannelManager {
  private framework: BubFramework;
  private channels: Record<string, Channel>;
  private settings: ChannelSettings;
  private enabledChannelsList: string[];
  private messages: ChannelMessage[] = [];
  private ongoingTasks: Task[] = [];
  private sessionHandlers: Map<string, (message: ChannelMessage) => Promise<void>> = new Map();
  private isStopped: boolean = false;
  private messageEvent: EventEmitter;
  private _initPromise: Promise<void> | null = null;

  constructor(framework: BubFramework, enabledChannels?: string[]) {
    this.framework = framework;
    this.messageEvent = new EventEmitter();
    this.messageEvent.setMaxListeners(0);
    this.channels = {};
    this.settings = { ...DEFAULT_CHANNEL_SETTINGS };
    if (enabledChannels !== undefined) {
      this.enabledChannelsList = enabledChannels;
    } else {
      this.enabledChannelsList = this.settings.enabledChannels.split(",");
    }
  }

  /**
   * 异步初始化：获取所有 channels。
   * listenAndRun() 会自动调用，也可手动提前调用。
   */
  async init(): Promise<void> {
    if (this._initPromise) {
      return this._initPromise;
    }
    this._initPromise = this.framework
      .getChannels(this.onReceive.bind(this))
      .then((channels) => {
        this.channels = channels;
      });
    return this._initPromise;
  }

  /**
   * 接收一条入站消息，根据 channel 类型决定是否需要防抖处理。
   * @param message - 入站的 ChannelMessage
   */
  async onReceive(message: ChannelMessage): Promise<void> {
    const channel = message.channel;
    const sessionId = message.sessionId;
    if (!(channel in this.channels)) {
      console.warn(
        `Received message from unknown channel '${channel}', ignoring.`,
      );
      return;
    }
    if (!this.sessionHandlers.has(sessionId)) {
      let handler: (message: ChannelMessage) => Promise<void>;
      const channelObj = this.channels[channel];
      if (channelObj.needs_debounce) {
        const bufferedHandler = new BufferedMessageHandler(
          (msg: ChannelMessage) => this.pushMessage(msg),
          {
            activeTimeWindow: this.settings.activeTimeWindow,
            maxWaitSeconds: this.settings.maxWaitSeconds,
            debounceSeconds: this.settings.debounceSeconds,
          },
        );
        handler = (msg: ChannelMessage) => bufferedHandler.call(msg);
      } else {
        handler = (msg: ChannelMessage) => this.pushMessage(msg);
      }
      this.sessionHandlers.set(sessionId, handler);
    }
    await this.sessionHandlers.get(sessionId)!(message);
  }

  /**
   * 将消息入队并触发消息事件。
   * @param message - 待入队的 ChannelMessage
   */
  private pushMessage(message: ChannelMessage): Promise<void> {
    return new Promise((resolve) => {
      this.messages.push(message);
      this.messageEvent.emit("message");
      resolve();
    });
  }

  /**
   * 根据名称获取 Channel 实例。
   * @param name - channel 名称
   * @returns Channel 实例，不存在时返回 `undefined`
   */
  getChannel(name: string): Channel | undefined {
    return this.channels[name];
  }

  /**
   * 将出站消息分发到对应的 Channel。
   * 优先使用 `output_channel`，其次使用 `channel` 字段。
   * @param message - 出站消息信封
   * @returns 分发成功返回 `true`，未找到 channel 返回 `false`
   */
  async dispatch(message: Envelope): Promise<boolean> {
    const channelName =
      fieldOf(message, "output_channel") ||
      fieldOf(message, "channel");
    if (channelName === undefined) {
      return false;
    }

    const channelKey = String(channelName);
    const channel = this.getChannel(channelKey);
    if (channel === undefined) {
      return false;
    }

    const outbound = new ChannelMessage(
      String(
        fieldOf(message, "session_id", `${channelKey}:default`),
      ),
      channelKey,
      contentOf(message),
      String(fieldOf(message, "chat_id", "default")),
      true,
      fieldOf(message, "kind", "normal"),
      fieldOf(message, "context", {}),
      [],
      null,
      channelKey,
    );
    await channel.send(outbound);
    return true;
  }

  /**
   * 移除指定 session 的消息处理器。
   * @param sessionId - 要移除的 session ID
   */
  async quit(sessionId: string): Promise<void> {
    this.sessionHandlers.delete(sessionId);
  }

  /**
   * 返回当前已启用的 Channel 列表。
   * 若 `enabledChannelsList` 为 `["all"]`，则返回除 CLI 外的所有 channel。
   * @returns 已启用的 Channel 数组
   */
  enabledChannels(): Channel[] {
    if (this.enabledChannelsList.includes("all")) {
      return Object.values(this.channels).filter(
        (channel) => channel.constructor.name !== "cli",
      );
    }
    return Object.values(this.channels).filter((channel) =>
      this.enabledChannelsList.includes(channel.constructor.name),
    );
  }

  /**
   * 创建一个封装了 `isStopped` 状态的停止事件对象。
   * @returns 包含 `isSet()` 方法的停止事件对象
   */
  private stopEvent(): { isSet: () => boolean } {
    return {
      isSet: () => this.isStopped,
    };
  }

  /**
   * 启动所有已启用的 Channel，绑定出站路由器，并进入消息处理主循环。
   * 收到停止信号时优雅关闭所有 Channel。
   */
  async listenAndRun(): Promise<void> {
    await this.init();
    this.framework.bindOutboundRouter(this);
    for (const channel of this.enabledChannels()) {
      await channel.start(this.stopEvent() as any);
    }
    console.info("channel.manager started listening");
    try {
      while (true) {
        const message = await waitUntilStopped(
          new Promise<ChannelMessage>((resolve) => {
            const check = () => {
              if (this.messages.length > 0) {
                resolve(this.messages.shift()!);
              } else if (this.isStopped) {
                resolve(this.messages.shift()!);
              } else {
                this.messageEvent.once("message", () => {
                  if (this.messages.length > 0) {
                    resolve(this.messages.shift()!);
                  }
                });
                setTimeout(check, 100);
              }
            };
            check();
          }),
          this.stopEvent(),
        );
        const task = this.framework.processInbound(message);
        this.ongoingTasks.push({ cancel: undefined });
        task.then(() => {
          const idx = this.ongoingTasks.findIndex((t) => t.cancel === undefined);
          if (idx !== -1) {
            this.ongoingTasks.splice(idx, 1);
          }
        });
      }
    } catch (e) {
      if (this.isStopped) {
        console.info("channel.manager received shutdown signal");
      } else {
        console.error("channel.manager error:", e);
        throw e;
      }
    } finally {
      this.framework.bindOutboundRouter(null);
      await this.shutdown();
      console.info("channel.manager stopped");
    }
  }

  /**
   * 关闭所有已启用的 Channel 并取消所有进行中的任务。
   */
  async shutdown(): Promise<void> {
    const count = this.ongoingTasks.length;
    this.ongoingTasks = [];
    console.info(`channel.manager cancelled ${count} in-flight tasks`);
    for (const channel of this.enabledChannels()) {
      await channel.stop();
    }
  }
}