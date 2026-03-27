export type MessageKind = "error" | "normal" | "command";
export type MediaType = "image" | "audio" | "video" | "document";
export type DataFetcher = () => Promise<Uint8Array>;

/**
 * 表示媒体附件的类，封装了媒体类型、MIME 类型和获取数据的方式。
 */
export class MediaItem {
  readonly type: MediaType;
  readonly mimeType: string;
  readonly filename?: string;
  readonly url?: string;
  readonly dataFetcher?: DataFetcher;

  constructor(
    type: MediaType,
    mimeType: string,
    options: {
      filename?: string;
      url?: string;
      dataFetcher?: DataFetcher;
    } = {},
  ) {
    this.type = type;
    this.mimeType = mimeType;
    this.filename = options.filename;
    this.url = options.url;
    this.dataFetcher = options.dataFetcher;
  }

  /**
   * 获取媒体的 URL。
   * 若存在直接 URL 则返回，否则通过 dataFetcher 获取数据并转换为 base64 data URL。
   * @returns URL 字符串，无法获取时返回 `null`
   */
  async getUrl(): Promise<string | null> {
    if (this.url) {
      return this.url;
    }

    if (this.dataFetcher) {
      const data = await this.dataFetcher();
      const base64Data = this.encodeToBase64(data);

      return `data:${this.mimeType};base64,${base64Data}`;
    }

    return null;
  }

  /**
   * 辅助函数：处理不同环境下的 Base64 编码
   */
  /**
   * 辅助函数：处理不同环境下的 Base64 编码。
   * 在浏览器环境中使用 `btoa`，在 Node.js 环境中使用 `Buffer`。
   * @param data - 待编码的二进制数据
   * @returns Base64 编码字符串
   * @throws 当前环境不支持 Base64 编码时抛出错误
   */
  private encodeToBase64(data: Uint8Array): string {
    // 检查是否在浏览器环境
    if (typeof window !== "undefined" && window.btoa) {
      // 浏览器：将binary转为string后使用btoa
      let binary = "";
      const len = data.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(data[i]);
      }
      return window.btoa(binary);
    } else if (typeof Buffer !== "undefined") {
      return Buffer.from(data).toString("base64");
    } else {
      throw new Error(
        "No base64 encoding method available for this environment",
      );
    }
  }
}

/**
 * 异步上下文管理器接口，用于管理消息处理期间的生命周期（如 Telegram 的 typing 状态）。
 */
export interface AsyncContextManager<T = void> extends AsyncDisposable {
  enter(): Promise<T>;
  exit(error?: Error): Promise<void>;
}

/**
 * 表示一条频道消息的类，封装了消息内容、媒体、生命周期等信息。
 */
export class ChannelMessage {
  sessionId: string;
  channel: string;
  chatId: string;
  kind: MessageKind;
  isActive: boolean;
  context: Record<string, any>;
  media: MediaItem[];
  lifespan: AsyncContextManager | null;
  outputChannel: string;
  content: string;

  constructor(
    sessionId: string,
    channel: string,
    content: string,
    chatId: string = "default",
    isActive: boolean = true,
    kind: MessageKind = "normal",
    context: Record<string, any> = {},
    media: MediaItem[] = [],
    lifespan: AsyncContextManager | null = null,
    outputChannel: string = "",
  ) {
    this.sessionId = sessionId;
    this.channel = channel;
    this.content = content;
    this.chatId = chatId;
    this.isActive = isActive;
    this.kind = kind;
    this.context = context;
    this.media = media;
    this.lifespan = lifespan;
    this.outputChannel = outputChannel;

    this.context["channel"] = "$" + this.channel;
    this.context["chat_id"] = this.chatId;

    if (!this.outputChannel) {
      this.outputChannel = this.channel;
    }
  }

  /**
   * 获取消息上下文的字符串表示，格式为 `key = value|key = value`。
   */
  get contextStr(): string {
    return Object.entries(this.context)
      .map(([key, value]) => `${key} = ${value}`)
      .join("|");
  }

  /**
   * 将一批消息合并为一条消息。
   * 以最后一条消息为模板，内容和媒体分别拼接。
   * @param batch - 非空的 ChannelMessage 数组
   * @returns 合并后的 ChannelMessage
   * @throws 若 batch 为空数组则抛出错误
   */
  static formBatch(batch: ChannelMessage[]): ChannelMessage {
    if (!batch.length) {
      throw new Error("Batch cannot be empty");
    }

    const template = batch[batch.length - 1];

    const content = batch.map((message) => message.content).join("\n");
    const media = batch.flatMap((msg) => msg.media);

    return new ChannelMessage(
      template.sessionId,
      template.channel,
      content,
      template.chatId,
      template.isActive,
      template.kind,
      { ...template.context },
      media,
      template.lifespan,
      template.outputChannel,
    );
  }
}
