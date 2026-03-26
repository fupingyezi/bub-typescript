import { Tool, tool as republicTool } from "republic";

export const REGISTRY: Record<string, Tool> = {};

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

function logSuccess(name: string, elapsedTime: number): void {
  console.info(
    `tool.call.success name=${name} elapsed_time=${elapsedTime.toFixed(2)}ms`,
  );
}

function logError(name: string, elapsedTime: number): void {
  console.error(
    `tool.call.error name=${name} elapsed_time=${elapsedTime.toFixed(2)}ms`,
  );
}

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

export function tool(
  func?: Function,
  options?: {
    name?: string;
    model?: unknown;
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

function toModelName(name: string): string {
  return name.replace(/\./g, "_");
}

export function modelTools(tools: Tool[]): Tool[] {
  return tools.map((t) => ({ ...t, name: toModelName(t.name) })) as Tool[];
}

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
