/**
 * Context payload for tool execution.
 */

export interface ToolContext {
  tape: string | null;
  runId: string;
  meta: Record<string, any>;
  state: Record<string, any>;
}

export function createToolContext(
  runId: string,
  tape: string | null = null,
  meta: Record<string, any> = {},
  state: Record<string, any> = {},
): ToolContext {
  return {
    tape,
    runId,
    meta,
    state,
  };
}
