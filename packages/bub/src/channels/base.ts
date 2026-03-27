import { ChannelMessage } from "./message";

/**
 * 所有 Channel 实现的抽象基类。
 * 子类需实现 `start`、`stop` 和 `send` 方法。
 */
export abstract class Channel {
  static name: string = "base";
  abstract name: string;

  /** 启动 Channel，进入消息监听循环。 */
  abstract start(stopEvent: { isSet: () => boolean }): Promise<void>;
  /** 停止 Channel，释放相关资源。 */
  abstract stop(): Promise<void>;

  /**
   * 是否需要对入站消息进行防抖处理。
   * 默认为 `false`，子类可覆盖。
   */
  get needs_debounce() {
    return false;
  }

  /**
   * 向 Channel 发送出站消息。
   * 默认为空实现，子类可覆盖。
   * @param message - 待发送的 ChannelMessage
   */
  async send(message: ChannelMessage) {
    return;
  }
}
