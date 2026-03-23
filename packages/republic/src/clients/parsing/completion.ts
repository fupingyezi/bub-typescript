import { BaseTransportParser } from "./types";
import { expandToolCalls, field } from "./common";

/**
 * Completion格式传输解析器
 */
export class CompletionTransportParser extends BaseTransportParser {
  /**
   * 判断是否为非流式响应
   * @param response 响应对象
   * @returns 是否为非流式响应
   */
  isNonStreamResponse(response: any): boolean {
    return typeof response === "string" || field(response, "choices") !== null;
  }

  /**
   * 从数据块中提取工具调用增量
   * @param chunk 数据块
   * @returns 工具调用增量数组
   */
  extractChunkToolCallDeltas(chunk: any): any[] {
    const choices = field(chunk, "choices");
    if (!choices || !Array.isArray(choices) || choices.length === 0) {
      return [];
    }
    const delta = field(choices[0], "delta");
    if (delta === null) {
      return [];
    }
    return field(delta, "tool_calls") || [];
  }

  /**
   * 从数据块中提取文本增量
   * @param chunk 数据块
   * @returns 文本增量
   */
  extractChunkText(chunk: any): string {
    const choices = field(chunk, "choices");
    if (!choices || !Array.isArray(choices) || choices.length === 0) {
      return "";
    }
    const delta = field(choices[0], "delta");
    if (delta === null) {
      return "";
    }
    return field(delta, "content", "") || "";
  }

  /**
   * 从响应中提取文本
   * @param response 响应对象
   * @returns 文本
   */
  extractText(response: any): string {
    if (typeof response === "string") {
      return response;
    }

    const choices = field(response, "choices");
    if (choices && Array.isArray(choices) && choices.length > 0) {
      const message = field(choices[0], "message");
      if (message !== null) {
        return field(message, "content", "") || "";
      }
    }

    const lcContent = response.content;
    if (typeof lcContent === "string") {
      return lcContent;
    }
    if (typeof lcContent === "object" && lcContent !== null) {
      return field(lcContent, "content", "") || "";
    }

    return "";
  }

  /**
   * 从响应中提取工具调用
   * @param response 响应对象
   * @returns 工具调用数组
   */
  extractToolCalls(response: any): Record<string, any>[] {
    let toolCalls: any[] = [];

    const choices = field(response, "choices");
    if (choices && Array.isArray(choices) && choices.length > 0) {
      const message = field(choices[0], "message");
      if (message !== null) {
        toolCalls = field(message, "tool_calls") || [];
      }
    }

    if (toolCalls.length === 0) {
      toolCalls = field(response, "tool_calls") || [];
    }

    if (toolCalls.length === 0) {
      const lcContent = response.content;
      if (typeof lcContent === "object" && lcContent !== null) {
        toolCalls = field(lcContent, "tool_calls") || [];
      }
    }

    const calls: Record<string, any>[] = [];
    for (const toolCall of toolCalls) {
      const func = field(toolCall, "function");
      let entry: Record<string, any>;

      if (func !== null) {
        entry = {
          function: {
            name: field(func, "name"),
            arguments: field(func, "arguments"),
          },
        };
      } else {
        const name = field(toolCall, "name");
        const args = field(toolCall, "args");
        if (!name) {
          continue;
        }
        entry = {
          function: {
            name: name,
            arguments: typeof args === "object" ? JSON.stringify(args) : args,
          },
        };
      }

      const callId = field(toolCall, "id");
      if (callId) {
        entry["id"] = callId;
      }
      const callType = field(toolCall, "type");
      if (callType) {
        entry["type"] = callType;
      }
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
    const usage = field(response, "usage");
    if (usage === null) {
      return null;
    }
    let payload: Record<string, any>;
    if (typeof usage === "object" && usage !== null && !Array.isArray(usage)) {
      payload = { ...usage };
    } else if (
      typeof usage === "object" &&
      usage !== null &&
      "model_dump" in usage
    ) {
      payload = (usage as any).model_dump();
    } else {
      return null;
    }
    const normalized: Record<string, any> = {};
    if ("input_tokens" in payload) {
      normalized["input_tokens"] = payload["input_tokens"];
    } else if ("prompt_tokens" in payload) {
      normalized["input_tokens"] = payload["prompt_tokens"];
    }
    if ("output_tokens" in payload) {
      normalized["output_tokens"] = payload["output_tokens"];
    } else if ("completion_tokens" in payload) {
      normalized["output_tokens"] = payload["completion_tokens"];
    }
    if ("total_tokens" in payload) {
      normalized["total_tokens"] = payload["total_tokens"];
    }
    if ("requests" in payload) {
      normalized["requests"] = payload["requests"];
    }
    return Object.keys(normalized).length > 0 ? normalized : null;
  }
}
