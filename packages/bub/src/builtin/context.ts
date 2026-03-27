import { TapeContext, TapeEntry } from "republic";
import { LAST_ANCHOR } from "republic/src/tape";

/**
 * 创建默认的 TapeContext 对象。
 * 使用 `LAST_ANCHOR` 作为锤点策略，`_selectMessages` 作为消息选择器。
 * @param state - 初始状态对象，默认为空对象
 * @returns 配置好的 TapeContext 实例
 */
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

/**
 * 将 tape 条目列表转换为模型可用的消息数组。
 * 处理 `message`、`tool_call`、`tool_result` 三种条目类型，构建符合 OpenAI 格式的对话历史。
 * @param entries - tape 条目数组
 * @param context - tape 上下文
 * @returns 模型可用的消息对象数组
 */
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

/**
 * 将 `message` 类型的 TapeEntry 转换为消息对象并追加到消息列表。
 * @param messages - 待追加的消息列表
 * @param entry - `message` 类型的 TapeEntry
 * @returns 空的待处理工具调用列表
 */
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

/**
 * 将 `tool_call` 类型的 TapeEntry 转换为工具调用消息并追加到消息列表。
 * @param messages - 待追加的消息列表
 * @param entry - `tool_call` 类型的 TapeEntry
 * @returns 解析后的工具调用对象数组，用于后续匹配工具结果
 */
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

/**
 * 将 `tool_result` 类型的 TapeEntry 转换为工具结果消息并追加到消息列表。
 * 会尝试将结果与对应的工具调用 ID 关联。
 * @param messages - 待追加的消息列表
 * @param pendingCalls - 待匹配的工具调用对象数组
 * @param entry - `tool_result` 类型的 TapeEntry
 */
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

/**
 * 构建单个工具结果消息对象。
 * 若存在匹配的工具调用，则关联 `tool_call_id` 和函数名。
 * @param result - 工具执行结果
 * @param pendingCalls - 待匹配的工具调用对象数组
 * @param index - 当前结果的索引
 * @returns 构建好的工具结果消息对象
 */
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

/**
 * 将任意工具调用列表规范化为对象数组。
 * 若输入不是数组，则返回空数组。
 * @param value - 待规范化的工具调用列表
 * @returns 规范化后的工具调用对象数组
 */
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

/**
 * 将工具执行结果渲染为字符串。
 * 若结果已是字符串则直接返回，否则尝试 JSON 序列化。
 * @param result - 工具执行结果
 * @returns 结果的字符串表示
 */
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
