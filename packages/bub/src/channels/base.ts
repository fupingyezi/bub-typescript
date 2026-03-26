import { ChannelMessage } from "./message";

export abstract class Channel {
  static name: string = "base";
  abstract name: string;

  abstract start(stopEvent: { isSet: () => boolean }): Promise<void>;
  abstract stop(): Promise<void>;

  get needs_debounce() {
    return false;
  }

  async send(message: ChannelMessage) {
    return;
  }
}
