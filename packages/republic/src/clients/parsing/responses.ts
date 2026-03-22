import { BaseTransportParser } from "./types";
import { expandToolCalls, field } from "./common";

/**
 * Responses格式传输解析器
 */
export class ResponseTransportParser extends BaseTransportParser {
  /**
   * 判断是否为非流式响应
   * @param response 响应对象
   * @returns 是否为非流式响应
   */
  isNonStreamResponse(response: any): boolean {
    return (
      typeof response === "string" ||
      field(response, "choices") !== null ||
      field(response, "output") !== null ||
      field(response, "output_text") !== null
    );
  }

  /**
   * 从参数事件中提取工具增量
   * @param chunk 数据块
   * @param eventType 事件类型
   * @returns 工具调用增量数组
   */
  private _toolDeltaFromArgsEvent(chunk: any, eventType: string): any[] {
    const itemId = field(chunk, "item_id");
    if (!itemId) {
      return [];
    }
    let arguments_ = field(chunk, "delta");
    if (eventType === "response.function_call_arguments.done") {
      arguments_ = field(chunk, "arguments");
    }
    if (typeof arguments_ !== "string") {
      return [];
    }

    const callId = field(chunk, "call_id");
    const payload: Record<string, any> = {
      index: itemId,
      type: "function",
      function: {
        name: field(chunk, "name") || "",
        arguments: arguments_,
      },
      arguments_complete: eventType === "response.function_call_arguments.done",
    };
    if (callId) {
      payload["id"] = callId;
    }
    return [payload];
  }

  /**
   * 从输出项事件中提取工具增量
   * @param chunk 数据块
   * @param eventType 事件类型
   * @returns 工具调用增量数组
   */
  private _toolDeltaFromOutputItemEvent(chunk: any, eventType: string): any[] {
    const item = field(chunk, "item");
    if (field(item, "type") !== "function_call") {
      return [];
    }

    const itemId = field(item, "id");
    const callId = field(item, "call_id") || itemId;
    if (!callId) {
      return [];
    }
    const arguments_ = field(item, "arguments");
    if (typeof arguments_ !== "string") {
      return [];
    }
    return [
      {
        id: callId,
        index: itemId || callId,
        type: "function",
        function: {
          name: field(item, "name") || "",
          arguments: arguments_,
        },
        arguments_complete: eventType === "response.output_item.done",
      },
    ];
  }

  /**
   * 从数据块中提取工具调用增量
   * @param chunk 数据块
   * @returns 工具调用增量数组
   */
  extractChunkToolCallDeltas(chunk: any): any[] {
    const eventType = field(chunk, "type");
    if (
      eventType === "response.function_call_arguments.delta" ||
      eventType === "response.function_call_arguments.done"
    ) {
      return this._toolDeltaFromArgsEvent(chunk, eventType);
    }
    if (
      eventType === "response.output_item.added" ||
      eventType === "response.output_item.done"
    ) {
      return this._toolDeltaFromOutputItemEvent(chunk, eventType);
    }
    return [];
  }

  /**
   * 从数据块中提取文本增量
   * @param chunk 数据块
   * @returns 文本增量
   */
  extractChunkText(chunk: any): string {
    if (field(chunk, "type") !== "response.output_text.delta") {
      return "";
    }
    const delta = field(chunk, "delta");
    if (typeof delta === "string") {
      return delta;
    }
    return "";
  }

  /**
   * 从输出中提取文本
   * @param output 输出对象
   * @returns 文本
   */
  private _extractTextFromOutput(output: any): string {
    if (!Array.isArray(output)) {
      return "";
    }
    const parts: string[] = [];
    for (const item of output) {
      if (field(item, "type") !== "message") {
        continue;
      }
      const content = field(item, "content") || [];
      for (const entry of content) {
        if (field(entry, "type") === "output_text") {
          const text = field(entry, "text");
          if (text) {
            parts.push(text);
          }
        }
      }
    }
    return parts.join("");
  }

  /**
   * 从响应中提取文本
   * @param response 响应对象
   * @returns 文本
   */
  extractText(response: any): string {
    const outputText = field(response, "output_text");
    if (typeof outputText === "string") {
      return outputText;
    }
    return this._extractTextFromOutput(field(response, "output"));
  }

  /**
   * 从响应中提取工具调用
   * @param response 响应对象
   * @returns 工具调用数组
   */
  extractToolCalls(response: any): Record<string, any>[] {
    const output = Array.isArray(response)
      ? response
      : field(response, "output");
    if (!Array.isArray(output)) {
      return [];
    }
    const calls: Record<string, any>[] = [];
    for (const item of output) {
      if (field(item, "type") !== "function_call") {
        continue;
      }
      const name = field(item, "name");
      const arguments_ = field(item, "arguments");
      if (!name) {
        continue;
      }
      const entry: Record<string, any> = {
        function: {
          name,
          arguments: arguments_ || "",
        },
      };
      const callId = field(item, "call_id") || field(item, "id");
      if (callId) {
        entry["id"] = callId;
      }
      entry["type"] = "function";
      calls.push(entry);
    }
    return expandToolCalls(calls);
  }

  /**
   * 从响应中提取使用量信息
   * @param response 响应对象
   * @returns 使用量信息或null
   */
  extractUsage(response: any): Record<string, any> | null {
    const eventType = field(response, "type");
    let usage: any;
    if (
      eventType === "response.completed" ||
      eventType === "response.in_progress" ||
      eventType === "response.failed" ||
      eventType === "response.incomplete"
    ) {
      usage = field(field(response, "response"), "usage");
    } else {
      usage = field(response, "usage");
    }

    if (usage === null) {
      return null;
    }
    if (typeof usage === "object" && usage !== null && "model_dump" in usage) {
      return (usage as any).model_dump();
    }
    if (typeof usage === "object" && usage !== null && !Array.isArray(usage)) {
      return { ...usage };
    }

    const data: Record<string, any> = {};
    for (const usageField of [
      "input_tokens",
      "output_tokens",
      "total_tokens",
      "requests",
    ]) {
      const value = field(usage, usageField);
      if (value !== null) {
        data[usageField] = value;
      }
    }
    return Object.keys(data).length > 0 ? data : null;
  }
}
