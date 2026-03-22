export type ResponseFormat = "completion" | "responses" | "messages";

export abstract class BaseTransportParser {
  abstract isNonStreamResponse(response: any): boolean;
  abstract extractChunkToolCallDeltas(chunk: any): any[];
  abstract extractChunkText(chunk: any): string;
  abstract extractText(response: any): string;
  abstract extractToolCalls(response: any): Record<string, any>[];
  abstract extractUsage(response: any): Record<string, any> | null;
}
