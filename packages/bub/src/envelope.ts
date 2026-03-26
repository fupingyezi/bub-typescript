import { Envelope } from "./types";

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

export function contentOf(message: Envelope) {
  return String(fieldOf(message, "content", ""));
}

export function normalizeEnvelope(message: Envelope): Record<string, any> {
  if (!message || typeof message !== "object") {
    return { content: String(message) };
  }

  return { ...message };
}

export function unpackBatch(batch: any): Envelope[] {
  if (!batch) return [];
  return Array.isArray(batch) ? batch : [batch];
}
