import { Envelope } from "./types";

/**
 * 从消息对象中安全地读取指定字段的值。
 * 若消息不是对象或字段不存在，则返回 `defaultValue`。
 * @param message - 任意消息对象
 * @param key - 要读取的字段名
 * @param defaultValue - 字段不存在时的默认值，默认为 `undefined`
 * @returns 字段值或默认值
 */
export function fieldOf<T = any>(
  message: any,
  key: string,
  defaultValue: any = undefined,
): T {
  if (!message || typeof message !== "object") {
    return defaultValue;
  }

  if (key in message) {
    return (message as Record<string, T>)[key];
  }

  return defaultValue;
}

/**
 * 从消息对象中提取 `content` 字段，并强制转换为字符串。
 * 若 `content` 不存在则返回空字符串。
 * @param message - 消息信封对象
 * @returns 消息内容字符串
 */
export function contentOf(message: Envelope) {
  return String(fieldOf(message, "content", ""));
}

/**
 * 将任意消息规范化为键值对对象。
 * 若消息本身不是对象，则将其包装为 `{ content: String(message) }`。
 * @param message - 待规范化的消息
 * @returns 规范化后的消息对象
 */
export function normalizeEnvelope(message: Envelope): Record<string, any> {
  if (!message || typeof message !== "object") {
    return { content: String(message) };
  }

  return { ...message };
}

/**
 * 将批量消息解包为消息数组。
 * 若 `batch` 已是数组则直接返回，否则包装为单元素数组；
 * 若 `batch` 为 falsy 则返回空数组。
 * @param batch - 单条消息或消息数组
 * @returns 消息数组
 */
export function unpackBatch(batch: any): Envelope[] {
  if (!batch) return [];
  return Array.isArray(batch) ? batch : [batch];
}
