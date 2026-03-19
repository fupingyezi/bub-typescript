import { BaseTransportParser } from "./types";
import { expandToolCalls, field } from "./common";

export class ResponseTransportParser extends BaseTransportParser {
  isNonStreamResponse(response: any): boolean {
    return (
      typeof response === "string" ||
      field(response, "choices") !== null ||
      field(response, "output") !== null ||
      field(response, "output_text") !== null
    );
  }

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

  extractText(response: any): string {
    const outputText = field(response, "output_text");
    if (typeof outputText === "string") {
      return outputText;
    }
    return this._extractTextFromOutput(field(response, "output"));
  }

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
