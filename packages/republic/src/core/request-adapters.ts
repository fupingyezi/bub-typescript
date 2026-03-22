/**
 * 工具选择函数接口
 */
export interface ToolChoiceFunction {
  /**
   * 函数名称
   */
  name: string;
}

/**
 * 工具选择对象接口
 */
export interface ToolChoiceObject {
  /**
   * 类型
   */
  type?: string;
  /**
   * 函数
   */
  function?: ToolChoiceFunction | Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * 规范化工具选择接口
 */
export interface NormalizedToolChoice extends Omit<
  ToolChoiceObject,
  "function"
> {
  /**
   * 类型
   */
  type: string;
  /**
   * 函数名称
   */
  name: string;
}

/**
 * Normalize completion-style kwargs into responses-compatible shapes.
 *
 * Converts:
 *   { tool_choice: { function: { name: "my_func" } } }
 * Into:
 *   { tool_choice: { type: "function", name: "my_func" } }
 * @param kwargs kwargs参数
 * @returns 规范化后的参数
 */
export function normalizeResponses_kwargs(
  kwargs: Record<string, any>,
): Record<string, any> {
  const { tool_choice } = kwargs;

  if (
    !tool_choice ||
    typeof tool_choice !== "object" ||
    Array.isArray(tool_choice)
  ) {
    return kwargs;
  }

  const tc = tool_choice as ToolChoiceObject;
  const { function: funcObj } = tc;

  if (!funcObj || typeof funcObj !== "object" || Array.isArray(funcObj)) {
    return kwargs;
  }

  const func = funcObj as ToolChoiceFunction;
  const { name: functionName } = func;

  if (typeof functionName !== "string" || !functionName) {
    return kwargs;
  }

  const { function: _, ...rest } = tc;

  const normalizedToolChoice: NormalizedToolChoice = {
    type: tc.type ?? "function",
    name: functionName,
    ...rest,
  };

  return {
    ...kwargs,
    tool_choice: normalizedToolChoice,
  };
}
