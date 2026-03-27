import { Channel } from "./base";
import { ChannelMessage, MediaItem, MediaType, AsyncContextManager } from "./message";
import { MessageHandler } from "../types";

interface TelegramConfig {
  token?: string;
  allowUsers?: string;
  allowChats?: string;
  proxy?: string;
}

interface TelegramUser {
  id: number;
  is_bot: boolean;
  username?: string;
  first_name: string;
  last_name?: string;
  full_name: string;
}

interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhoto[];
  audio?: TelegramAudio;
  document?: TelegramDocument;
  sticker?: TelegramSticker;
  video?: TelegramVideo;
  voice?: TelegramVoice;
  video_note?: TelegramVideoNote;
  reply_to_message?: TelegramMessage;
  entities?: TelegramMessageEntity[];
  caption_entities?: TelegramMessageEntity[];
}

interface TelegramPhoto {
  file_id: string;
  file_size?: number;
  width: number;
  height: number;
}

interface TelegramAudio {
  file_id: string;
  file_size?: number;
  duration: number;
  title?: string;
  performer?: string;
  mime_type?: string;
}

interface TelegramDocument {
  file_id: string;
  file_size?: number;
  file_name?: string;
  mime_type?: string;
}

interface TelegramSticker {
  file_id: string;
  file_size?: number;
  width: number;
  height: number;
  emoji?: string;
  set_name?: string;
  is_animated: boolean;
}

interface TelegramVideo {
  file_id: string;
  file_size?: number;
  width: number;
  height: number;
  duration: number;
  mime_type?: string;
}

interface TelegramVoice {
  file_id: string;
  file_size?: number;
  duration: number;
  mime_type?: string;
}

interface TelegramVideoNote {
  file_id: string;
  file_size?: number;
  length: number;
  duration: number;
  mime_type?: string;
}

interface TelegramMessageEntity {
  type: string;
  offset: number;
  length: number;
  user?: TelegramUser;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

const NO_ACCESS_MESSAGE =
  "You are not allowed to chat with me. Please deploy your own instance of Bub.";

/**
 * 过滤对象中的 null/undefined 字段，返回只包含有效字段的新对象。
 * @param obj - 待过滤的对象
 * @returns 去除 null/undefined 字段后的新对象
 */
function excludeNone<T extends Record<string, any>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) {
      (result as any)[key] = value;
    }
  }
  return result;
}

/**
 * 从环境变量中读取字符串值。
 * @param key - 环境变量名
 * @param defaultValue - 默认值，默认为空字符串
 * @returns 环境变量的字符串值
 */
function getEnv(key: string, defaultValue: string = ""): string {
  return process.env[key] ?? defaultValue;
}

/**
 * 获取 Telegram 消息的类型字符串。
 * @param message - Telegram 消息对象
 * @returns 消息类型，如 `"text"`、`"photo"`、`"audio"` 等
 */
function getMessageType(message: TelegramMessage): string {
  if (message.text !== undefined) return "text";
  if (message.photo !== undefined && message.photo.length > 0) return "photo";
  if (message.audio !== undefined) return "audio";
  if (message.sticker !== undefined) return "sticker";
  if (message.video !== undefined) return "video";
  if (message.voice !== undefined) return "voice";
  if (message.document !== undefined) return "document";
  if (message.video_note !== undefined) return "video_note";
  return "unknown";
}

const MSG_TYPE_TO_MEDIA_TYPE: Record<string, MediaType> = {
  photo: "image",
  sticker: "image",
  audio: "audio",
  voice: "audio",
  video: "video",
  video_note: "video",
  document: "document",
};

/**
 * Telegram 频道实现，通过 Telegram Bot API 接收和发送消息。
 * 支持文本、图片、音频、视频、文档等多种消息类型。
 */
export class TelegramChannel extends Channel {
  static name = "telegram";
  name = "telegram";

  private onReceive: MessageHandler;
  private token: string;
  private allowUsers: Set<string>;
  private allowChats: Set<string>;
  private proxy?: string;
  private offset: number = 0;
  private stopped: boolean = false;
  private typingIntervals: Map<string, ReturnType<typeof setInterval>> =
    new Map();

  constructor(onReceive: MessageHandler, token?: string) {
    super();
    this.onReceive = onReceive;
    this.token = token ?? getEnv("BUB_TELEGRAM_TOKEN", "");
    const allowUsersStr = getEnv("BUB_TELEGRAM_ALLOW_USERS", "");
    this.allowUsers = new Set(
      allowUsersStr
        .split(",")
        .map((u) => u.trim())
        .filter((u) => u),
    );
    const allowChatsStr = getEnv("BUB_TELEGRAM_ALLOW_CHATS", "");
    this.allowChats = new Set(
      allowChatsStr
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c),
    );
    this.proxy = getEnv("BUB_TELEGRAM_PROXY", "") || undefined;
  }

  /**
   * 是否需要防抖处理。Telegram 频道始终需要防抖。
   */
  get needs_debounce(): boolean {
    return true;
  }

  /**
   * 启动 Telegram 长轮询 polling 循环。
   * @param stopEvent - 停止信号对象
   */
  async start(stopEvent: { isSet: () => boolean }): Promise<void> {
    this.stopped = false;
    console.log(
      `[TelegramChannel] start: allowUsers=${this.allowUsers.size}, allowChats=${this.allowChats.size}, proxy=${!!this.proxy}`,
    );

    const poll = async () => {
      while (!this.stopped) {
        try {
          const updates = await this.getUpdates();
          for (const update of updates) {
            await this.handleUpdate(update);
            this.offset = update.update_id + 1;
          }
        } catch (error) {
          console.error("[TelegramChannel] Polling error:", error);
          await this.sleep(5000);
        }
      }
    };

    poll();
  }

  /**
   * 停止 polling 并清除所有 typing 定时器。
   */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const interval of this.typingIntervals.values()) {
      clearInterval(interval);
    }
    this.typingIntervals.clear();
    console.log("[TelegramChannel] stopped");
  }

  /**
   * 向指定聊天发送消息。
   * @param message - 出站的 ChannelMessage
   */
  async send(message: ChannelMessage): Promise<void> {
    const chatId = message.chatId;
    let text = message.content;

    try {
      const data = JSON.parse(message.content);
      text = data.message ?? message.content;
    } catch {
      text = message.content;
    }

    if (!text.trim()) return;

    await this.apiCall("sendMessage", {
      chat_id: chatId,
      text: text,
    });
  }

  /**
   * 获取新的 Telegram 更新列表。
   * @returns TelegramUpdate 数组
   */
  private async getUpdates(): Promise<TelegramUpdate[]> {
    const params: Record<string, any> = {
      offset: this.offset,
      timeout: 30,
    };

    const response = await this.apiCall<TelegramUpdate[]>("getUpdates", params);
    return response ?? [];
  }

  /**
   * 处理单个 Telegram 更新事件。
   * 进行用户/聊天权限验证，并将合法消息转发给 onReceive 处理器。
   * @param update - Telegram 更新对象
   */
  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message) return;

    const chatId = String(message.chat.id);

    if (message.text === "/start") {
      if (this.allowChats.size > 0 && !this.allowChats.has(chatId)) {
        await this.sendMessage(chatId, NO_ACCESS_MESSAGE);
        return;
      }
      await this.sendMessage(chatId, "Bub is online. Send text to start.");
      return;
    }

    if (this.allowChats.size > 0 && !this.allowChats.has(chatId)) {
      return;
    }

    const user = message.from;
    if (!user) return;

    const senderTokens = new Set<string>();
    senderTokens.add(String(user.id));
    if (user.username) {
      senderTokens.add(user.username);
    }

    if (
      this.allowUsers.size > 0 &&
      this.isDisjoint(senderTokens, this.allowUsers)
    ) {
      await this.sendMessage(chatId, "Access denied.");
      return;
    }

    const channelMessage = await this.buildMessage(message);
    await this.onReceive(channelMessage);
  }

  /**
   * 将 Telegram 消息转换为 ChannelMessage。
   * 根据消息类型解析内容，并构建包含元数据和生命周期的消息对象。
   * @param message - Telegram 消息对象
   * @returns 构建好的 ChannelMessage
   */
  private async buildMessage(
    message: TelegramMessage,
  ): Promise<ChannelMessage> {
    const chatId = String(message.chat.id);
    const sessionId = `${TelegramChannel.name}:${chatId}`;
    const msgType = getMessageType(message);

    let content: string;
    let media: MediaItem[] = [];

    if (msgType === "text") {
      content = message.text ?? "";
    } else if (msgType === "photo") {
      content = await this.parsePhoto(message);
    } else if (msgType === "audio") {
      content = await this.parseAudio(message);
    } else if (msgType === "sticker") {
      content = await this.parseSticker(message);
    } else if (msgType === "video") {
      content = await this.parseVideo(message);
    } else if (msgType === "voice") {
      content = await this.parseVoice(message);
    } else if (msgType === "document") {
      content = await this.parseDocument(message);
    } else if (msgType === "video_note") {
      content = await this.parseVideoNote(message);
    } else {
      content = `[Unsupported message type: ${msgType}]`;
    }

    if (content.startsWith("/bub ")) {
      content = content.slice(5);
    }

    if (content.trim().startsWith(",")) {
      return new ChannelMessage(
        sessionId,
        TelegramChannel.name,
        content.trim(),
        chatId,
        true,
        "command",
      );
    }

    const metadata = excludeNone({
      message_id: message.message_id,
      type: msgType,
      username: message.from?.username ?? "",
      full_name: message.from?.full_name ?? "",
      sender_id: message.from ? String(message.from.id) : "",
      sender_is_bot: message.from?.is_bot ?? null,
      date: message.date,
    });

    const isActive = this.checkFilter(message);

    let _stopTyping: (() => void) | null = null;
    const lifespan: AsyncContextManager = {
      enter: async () => {
        _stopTyping = await this.startTyping(chatId);
      },
      exit: async () => {
        if (_stopTyping) {
          _stopTyping();
          _stopTyping = null;
        }
      },
      [Symbol.asyncDispose]: async () => {
        if (_stopTyping) {
          _stopTyping();
          _stopTyping = null;
        }
      },
    };

    return new ChannelMessage(
      sessionId,
      TelegramChannel.name,
      JSON.stringify({ message: content, ...metadata }),
      chatId,
      isActive,
      "normal",
      {},
      media,
      lifespan,
      "null",
    );
  }

  /**
   * 检查消息是否应该被处理（是否为活跃消息）。
   * 私聊消息始终活跃；群组消息需要包含 "bub" 或 "@bot"。
   * @param message - Telegram 消息对象
   * @returns 是否为活跃消息
   */
  private checkFilter(message: TelegramMessage): boolean {
    const msgType = getMessageType(message);
    if (msgType === "unknown") return false;

    const chatType = message.chat.type;
    if (chatType === "private") return true;

    if (chatType === "group" || chatType === "supergroup") {
      const content = (message.text ?? message.caption ?? "").toLowerCase();
      return content.includes("bub") || content.includes("@bot");
    }

    return false;
  }

  /**
   * 开始向指定聊天发送 "typing" 状态，每 4 秒重复一次。
   * @param chatId - 目标聊天 ID
   * @returns 返回一个停止函数，调用后停止 typing 状态
   */
  private startTyping(chatId: string): Promise<() => void> {
    return new Promise<() => void>((resolve) => {
      const interval = setInterval(async () => {
        try {
          await this.apiCall("sendChatAction", {
            chat_id: chatId,
            action: "typing",
          });
        } catch (error) {
          console.error(`[TelegramChannel] Typing error for ${chatId}:`, error);
          clearInterval(interval);
        }
      }, 4000);
      this.typingIntervals.set(chatId, interval);

      resolve(() => {
        clearInterval(interval);
        this.typingIntervals.delete(chatId);
      });
    });
  }

  /**
   * 解析图片消息为文本描述。
   * @param message - 包含图片的 Telegram 消息
   * @returns 图片描述字符串
   */
  private async parsePhoto(message: TelegramMessage): Promise<string> {
    const caption = message.caption ?? "";
    const photos = message.photo ?? [];
    if (!photos.length) {
      return caption
        ? `[Photo message] Caption: ${caption}`
        : "[Photo message]";
    }
    return caption ? `[Photo message] Caption: ${caption}` : "[Photo message]";
  }

  /**
   * 解析音频消息为文本描述。
   * @param message - 包含音频的 Telegram 消息
   * @returns 音频描述字符串
   */
  private async parseAudio(message: TelegramMessage): Promise<string> {
    const audio = message.audio;
    if (!audio) return "[Audio]";
    const title = audio.title ?? "Unknown";
    const performer = audio.performer ?? "";
    const duration = audio.duration ?? 0;
    if (performer) {
      return `[Audio: ${performer} - ${title} (${duration}s)]`;
    }
    return `[Audio: ${title} (${duration}s)]`;
  }

  /**
   * 解析贴纸消息为文本描述。
   * @param message - 包含贴纸的 Telegram 消息
   * @returns 贴纸描述字符串
   */
  private async parseSticker(message: TelegramMessage): Promise<string> {
    const sticker = message.sticker;
    if (!sticker) return "[Sticker]";
    const emoji = sticker.emoji ?? "";
    const setName = sticker.set_name ?? "";
    if (emoji) {
      return `[Sticker: ${emoji} from ${setName}]`;
    }
    return `[Sticker from ${setName}]`;
  }

  /**
   * 解析视频消息为文本描述。
   * @param message - 包含视频的 Telegram 消息
   * @returns 视频描述字符串
   */
  private async parseVideo(message: TelegramMessage): Promise<string> {
    const video = message.video;
    const caption = message.caption ?? "";
    const duration = video?.duration ?? 0;
    let result = `[Video: ${duration}s]`;
    if (caption) result += ` Caption: ${caption}`;
    return result;
  }

  /**
   * 解析语音消息为文本描述。
   * @param message - 包含语音的 Telegram 消息
   * @returns 语音描述字符串
   */
  private async parseVoice(message: TelegramMessage): Promise<string> {
    const voice = message.voice;
    if (!voice) return "[Voice message]";
    const duration = voice.duration ?? 0;
    return `[Voice message: ${duration}s]`;
  }

  /**
   * 解析文件消息为文本描述。
   * @param message - 包含文件的 Telegram 消息
   * @returns 文件描述字符串
   */
  private async parseDocument(message: TelegramMessage): Promise<string> {
    const doc = message.document;
    if (!doc) return "[Document]";
    const fileName = doc.file_name ?? "unknown";
    const mimeType = doc.mime_type ?? "application/octet-stream";
    const caption = message.caption ?? "";
    let result = `[Document: ${fileName} (${mimeType})]`;
    if (caption) result += ` Caption: ${caption}`;
    return result;
  }

  /**
   * 解析视频笔记消息为文本描述。
   * @param message - 包含视频笔记的 Telegram 消息
   * @returns 视频笔记描述字符串
   */
  private async parseVideoNote(message: TelegramMessage): Promise<string> {
    const videoNote = message.video_note;
    if (!videoNote) return "[Video note]";
    const duration = videoNote.duration ?? 0;
    return `[Video note: ${duration}s]`;
  }

  /**
   * 调用 Telegram Bot API 接口。
   * @param method - API 方法名
   * @param params - 请求参数
   * @returns API 返回的结果对象
   * @throws API 返回错误时抛出异常
   */
  private async apiCall<T>(
    method: string,
    params: Record<string, any> = {},
  ): Promise<T> {
    const url = `https://api.telegram.org/bot${this.token}/${method}`;
    const options: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    };

    const response = await fetch(url, options);
    const data = (await response.json()) as TelegramResponse<T>;

    if (!data.ok) {
      throw new Error(`Telegram API error: ${data.description}`);
    }

    return data.result as T;
  }

  /**
   * 向指定聊天发送文本消息。
   * @param chatId - 目标聊天 ID
   * @param text - 消息文本
   */
  private async sendMessage(chatId: string, text: string): Promise<void> {
    await this.apiCall("sendMessage", { chat_id: chatId, text });
  }

  /**
   * 判断两个 Set 是否没有交集。
   * @param setA - 第一个 Set
   * @param setB - 第二个 Set
   * @returns 没有交集时返回 `true`
   */
  private isDisjoint(setA: Set<string>, setB: Set<string>): boolean {
    for (const item of setA) {
      if (setB.has(item)) return false;
    }
    return true;
  }

  /**
   * 延迟指定毫秒数。
   * @param ms - 延迟毫秒数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
