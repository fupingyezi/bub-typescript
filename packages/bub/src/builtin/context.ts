import { TapeContext, TapeEntry } from "republic";
import { LAST_ANCHOR } from "republic/src/tape";

export function defaultTapeContext(
  state: Record<string, any> | null = null,
): TapeContext {
  return {
    anchor: LAST_ANCHOR,
    select: _selectMessages,
    state: state || {},
    buildQuery: <T>(query: any): any => query,
  };
}

export function _selectMessages(
  entries: TapeEntry[],
  context: TapeContext,
): Record<string, any>[] {
  const messages: Record<string, any>[] = [];
  let pendingCalls: Record<string, any>[] = [];

  for (const entry of entries) {
    if (entry.kind === "message") {
      pendingCalls = _appendMessageEntry(messages, entry);
      continue;
    }

    if (entry.kind === "tool_call") {
      pendingCalls = _appendToolCallEntry(messages, entry);
      continue;
    }

    if (entry.kind === "tool_result") {
      _appendToolResultEntry(messages, pendingCalls, entry);
      pendingCalls = [];
    }
  }

  return messages;
}

function _appendMessageEntry(
  messages: Record<string, any>[],
  entry: TapeEntry,
): Record<string, any>[] {
  const payload = entry.payload as Record<string, any>;
  if (typeof payload === "object" && payload !== null) {
    messages.push({ ...payload });
  }
  return [];
}

function _appendToolCallEntry(
  messages: Record<string, any>[],
  entry: TapeEntry,
): Record<string, any>[] {
  const payload = entry.payload as Record<string, any>;
  const calls = _normalizeToolCalls(payload["calls"]);
  if (calls.length > 0) {
    messages.push({ role: "assistant", content: "", tool_calls: calls });
  }
  return calls;
}

function _appendToolResultEntry(
  messages: Record<string, any>[],
  pendingCalls: Record<string, any>[],
  entry: TapeEntry,
): void {
  const payload = entry.payload as Record<string, any>;
  const results = payload["results"];
  if (!Array.isArray(results)) {
    return;
  }
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    messages.push(_buildToolResultMessage(result, pendingCalls, index));
  }
}

function _buildToolResultMessage(
  result: any,
  pendingCalls: Record<string, any>[],
  index: number,
): Record<string, any> {
  const message: Record<string, any> = {
    role: "tool",
    content: _renderToolResult(result),
  };

  if (index >= pendingCalls.length) {
    return message;
  }

  const call = pendingCalls[index];
  const callId = call["id"];
  if (typeof callId === "string" && callId) {
    message["tool_call_id"] = callId;
  }

  const fn = call["function"];
  if (typeof fn === "object" && fn !== null) {
    const name = fn["name"];
    if (typeof name === "string" && name) {
      message["name"] = name;
    }
  }

  return message;
}

function _normalizeToolCalls(value: any): Record<string, any>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const calls: Record<string, any>[] = [];
  for (const item of value) {
    if (typeof item === "object" && item !== null) {
      calls.push({ ...item });
    }
  }
  return calls;
}

function _renderToolResult(result: any): string {
  if (typeof result === "string") {
    return result;
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}
