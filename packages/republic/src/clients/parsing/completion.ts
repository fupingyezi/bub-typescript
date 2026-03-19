import { BaseTransportParser } from "./types";
import { expandToolCalls, field } from "./common";

export class CompletionTransportParser extends BaseTransportParser {
  isNonStreamResponse(response: any): boolean {
    return typeof response === "string" || field(response, "choices") !== null;
  }

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

  extractText(response: any): string {
    if (typeof response === "string") {
      return response;
    }

    const choices = field(response, "choices");
    if (!choices || !Array.isArray(choices) || choices.length === 0) {
      return "";
    }
    const message = field(choices[0], "message");
    if (message === null) {
      return "";
    }
    return field(message, "content", "") || "";
  }

  extractToolCalls(response: any): Record<string, any>[] {
    const choices = field(response, "choices");
    if (!choices || !Array.isArray(choices) || choices.length === 0) {
      return [];
    }
    const message = field(choices[0], "message");
    if (message === null) {
      return [];
    }
    const toolCalls = field(message, "tool_calls") || [];
    const calls: Record<string, any>[] = [];
    for (const toolCall of toolCalls) {
      const func = field(toolCall, "function");
      if (func === null) {
        continue;
      }
      const entry: Record<string, any> = {
        function: {
          name: field(func, "name"),
          arguments: field(func, "arguments"),
        },
      };
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
