/**
 * Context payload for tool execution.
 */

/**
 * 工具执行上下文接口
 */
export interface ToolContext {
  /**
   * Tape名称
   */
  tape: string | null;
  /**
   * 运行ID
   */
  runId: string;
  /**
   * 元数据
   */
  meta: Record<string, any>;
  /**
   * 状态
   */
  state: Record<string, any>;
}

/**
 * 创建工具上下文
 * @param runId 运行ID
 * @param tape Tape名称
 * @param meta 元数据
 * @param state 状态
 * @returns 工具上下文
 */
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
