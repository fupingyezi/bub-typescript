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

  private resetTimer(timeout: number): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.event.emit("ready");
    }, timeout * 1000);
  }

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

  constructor(framework: BubFramework, enabledChannels?: string[]) {
    this.framework = framework;
    this.messageEvent = new EventEmitter();
    this.messageEvent.setMaxListeners(0);
    this.channels = this.framework.getChannels(this.onReceive.bind(this));
    this.settings = { ...DEFAULT_CHANNEL_SETTINGS };
    if (enabledChannels !== undefined) {
      this.enabledChannelsList = enabledChannels;
    } else {
      this.enabledChannelsList = this.settings.enabledChannels.split(",");
    }
  }

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

  private pushMessage(message: ChannelMessage): Promise<void> {
    return new Promise((resolve) => {
      this.messages.push(message);
      this.messageEvent.emit("message");
      resolve();
    });
  }

  getChannel(name: string): Channel | undefined {
    return this.channels[name];
  }

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

  async quit(sessionId: string): Promise<void> {
    this.sessionHandlers.delete(sessionId);
  }

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

  private stopEvent(): { isSet: () => boolean } {
    return {
      isSet: () => this.isStopped,
    };
  }

  async listenAndRun(): Promise<void> {
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

  async shutdown(): Promise<void> {
    const count = this.ongoingTasks.length;
    this.ongoingTasks = [];
    console.info(`channel.manager cancelled ${count} in-flight tasks`);
    for (const channel of this.enabledChannels()) {
      await channel.stop();
    }
  }
}