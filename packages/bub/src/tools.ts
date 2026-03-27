import { Tool, tool as republicTool } from "republic";

/** 全局工具注册表，key 为工具名称，value 为 republic Tool 实例。 */
export const REGISTRY: Record<string, Tool> = {};

/**
 * 记录工具调用开始日志。
 * @param name - 工具名称
 * @param args - 位置参数列表
 * @param kwargs - 关键字参数对象
 */
function logStart(
  name: string,
  args: unknown[],
  kwargs: Record<string, unknown>,
): void {
  const params: string[] = [];
  for (const value of args) {
    params.push(renderValue(value));
  }
  for (const [key, value] of Object.entries(kwargs)) {
    params.push(`${key}=${renderValue(value)}`);
  }
  const paramsStr = params.length > 0 ? ` { ${params.join(", ")} }` : "";
  console.info(`tool.call.start name=${name}${paramsStr}`);
}

/**
 * 记录工具调用成功日志。
 * @param name - 工具名称
 * @param elapsedTime - 执行耗时（毫秒）
 */
function logSuccess(name: string, elapsedTime: number): void {
  console.info(
    `tool.call.success name=${name} elapsed_time=${elapsedTime.toFixed(2)}ms`,
  );
}

/**
 * 记录工具调用失败日志。
 * @param name - 工具名称
 * @param elapsedTime - 执行耗时（毫秒）
 */
function logError(name: string, elapsedTime: number): void {
  console.error(
    `tool.call.error name=${name} elapsed_time=${elapsedTime.toFixed(2)}ms`,
  );
}

/**
 * 将任意值渲染为可读字符串，超过 100 字符时截断并追加 `...`。
 * @param value - 待渲染的值
 * @returns 渲染后的字符串
 */
function renderValue(value: unknown): string {
  let rendered: string;
  try {
    rendered = JSON.stringify(value);
  } catch {
    rendered = String(value);
  }
  if (rendered.length > 100) {
    rendered = rendered.slice(0, 97) + "...";
  }
  return rendered;
}

/**
 * 为 Tool 实例包装调用日志，返回带日志的新 Tool。
 * 若 Tool 没有 `handler`，则直接返回原实例。
 * @param tool - 待包装的 republic Tool 实例
 * @returns 带日志包装的 Tool 实例
 */
function addLogging(tool: Tool): Tool {
  if (tool.handler === undefined) {
    return tool;
  }

  const wrapped = async (...args: unknown[]) => {
    const callKwargs =
      args.length > 0 &&
      typeof args[args.length - 1] === "object" &&
      args[args.length - 1] !== null
        ? (args.pop() as Record<string, unknown>)
        : {};
    if (tool.context) {
      delete callKwargs.context;
    }
    logStart(tool.name, args, callKwargs);
    const start = performance.now();

    try {
      let result = tool.handler!(...args, callKwargs);
      if (result instanceof Promise) {
        result = await result;
      }
      logSuccess(tool.name, performance.now() - start);
      return result;
    } catch (error) {
      logError(tool.name, performance.now() - start);
      throw error;
    }
  };

  return {
    ...tool,
    handler: wrapped,
  } as Tool;
}

/**
 * 注册工具到全局 REGISTRY，并为其添加调用日志。
 * 支持两种调用方式：
 * - 直接调用：`tool(fn, options)` — 立即注册并返回 Tool
 * - 装饰器调用：`tool(undefined, options)` — 返回接受函数的高阶函数
 *
 * @param func - 工具实现函数，若为 `undefined` 则返回装饰器
 * @param options - 工具配置项
 * @param options.name - 工具名称，默认使用函数名
 * @param options.model - 关联的模型构造函数
 * @param options.description - 工具描述
 * @param options.context - 是否需要注入 ToolContext，默认 `false`
 * @returns Tool 实例或接受函数的装饰器
 */
export function tool(
  func?: Function,
  options?: {
    name?: string;
    model?: (new (...args: any[]) => any);
    description?: string;
    context?: boolean;
  },
): Tool | ((func: Function) => Tool) {
  const { name, model, description, context = false } = options || {};

  if (func !== undefined) {
    const toolInstance = republicTool(func as any, {
      name,
      model,
      description,
      context,
    });
    REGISTRY[toolInstance.name] = addLogging(toolInstance);
    return REGISTRY[toolInstance.name];
  }

  return (func: Function) => {
    const toolInstance = republicTool(func as any, {
      name,
      model,
      description,
      context,
    });
    REGISTRY[toolInstance.name] = addLogging(toolInstance);
    return REGISTRY[toolInstance.name];
  };
}

/**
 * 将工具名称中的 `.` 替换为 `_`，以符合模型函数名规范。
 * @param name - 原始工具名称
 * @returns 模型兼容的工具名称
 */
function toModelName(name: string): string {
  return name.replace(/\./g, "_");
}

/**
 * 将工具列表转换为模型可调用的格式（名称中 `.` 替换为 `_`）。
 * @param tools - republic Tool 列表
 * @returns 名称已规范化的 Tool 列表
 */
export function modelTools(tools: Tool[]): Tool[] {
  return tools.map((t) => ({ ...t, name: toModelName(t.name) })) as Tool[];
}

/**
 * 将工具列表渲染为系统提示词中的 `<available_tools>` XML 块。
 * 若工具列表为空则返回空字符串。
 * @param tools - republic Tool 列表
 * @returns 工具列表的提示词字符串
 */
export function renderToolsPrompt(tools: Tool[]): string {
  if (tools.length === 0) {
    return "";
  }
  const lines = tools.map((t) => {
    let line = `- ${toModelName(t.name)}`;
    if (t.description !== undefined) {
      line += `: ${t.description}`;
    }
    return line;
  });
  return `<available_tools>\n${lines.join("\n")}\n</available_tools>`;
}
