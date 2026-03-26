export type MessageKind = "error" | "normal" | "command";
export type MediaType = "image" | "audio" | "video" | "document";
export type DataFetcher = () => Promise<Uint8Array>;

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

export interface AsyncContextManager<T = void> extends AsyncDisposable {
  enter(): Promise<T>;
  exit(error?: Error): Promise<void>;
}

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
    chatId: string = "defualt",
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

  get contextStr(): string {
    return Object.entries(this.context)
      .map(([key, value]) => `${key} = ${value}`)
      .join("|");
  }

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
