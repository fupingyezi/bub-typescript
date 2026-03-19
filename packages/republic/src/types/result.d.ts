export const INVALID_INPUT = "invalid_input";
export const CONFIG = "config";
export const PROVIDER = "provider";
export const TOOL = "tool";
export const TEMPORARY = "temporary";
export const NOT_FOUND = "not_found";
export const UNKNOWN = "unknown";

export const ErrorKind = {
  INVALID_INPUT: "invalid_input",
  CONFIG: "config",
  PROVIDER: "provider",
  TOOL: "tool",
  TEMPORARY: "temporary",
  NOT_FOUND: "not_found",
  UNKNOWN: "unknown",
};

export type ErrorKindType = (typeof ErrorKind)[keyof typeof ErrorKind];

export type StreamEventKind =
  | "text"
  | "tool_call"
  | "tool_result"
  | "usage"
  | "error"
  | "final";

export interface ToolCall {
  id?: string;
  name?: string;
  arguments?: Record<string, any>;
  [key: string]: any;
}
