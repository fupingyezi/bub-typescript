/**
 * 工具架构模块
 */

import { ErrorPayload } from "@/core/results";
import { ErrorKind } from "@/types";
import { ToolContext } from "./context";

export type ToolHandler = (...args: any[]) => any;

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export class Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, any>;
  readonly handler: ToolHandler | null;
  readonly context: boolean;

  constructor(
    name: string,
    description: string = "",
    parameters: Record<string, any> = {},
    handler: ToolHandler | null = null,
    context: boolean = false,
  ) {
    this.name = name;
    this.description = description;
    this.parameters = parameters;
    this.handler = handler;
    this.context = context;
  }

  /**
   * 获取工具架构
   * @returns 工具架构
   */
  schema(): ToolSchema {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }

  /**
   * 获取工具的架构表示
   * @param jsonMode 是否返回JSON格式
   * @returns 工具架构
   */
  asTool(jsonMode: boolean = false): string | ToolSchema {
    const schema = this.schema();
    if (jsonMode) {
      return JSON.stringify(schema, null, 2);
    }
    return schema;
  }

  /**
   * 执行工具
   * @param args 参数
   * @returns 执行结果
   */
  run(...args: any[]): any {
    if (this.handler === null) {
      throw new Error(
        `Tool '${this.name}' is schema-only and cannot be executed.`,
      );
    }
    return this.handler(...args);
  }

  /**
   * 从可调用对象创建工具
   * @param func 函数
   * @param options 配置选项
   * @returns 工具
   */
  static fromCallable(
    func: ToolHandler,
    options: {
      name?: string;
      description?: string;
      context?: boolean;
    } = {},
  ): Tool {
    const { name, description, context = false } = options;

    if (context) {
      const funcStr = func.toString();
      if (!funcStr.includes("context")) {
        throw new TypeError(
          "Tool context is enabled but the callable lacks a 'context' parameter.",
        );
      }
    }

    const toolName = name || toSnakeCase(getCallableName(func));
    const toolDescription =
      description !== undefined ? description : getFunctionDoc(func);
    const parameters = schemaFromFunction(func, context ? ["context"] : []);

    return new Tool(toolName, toolDescription, parameters, func, context);
  }

  /**
   * 从模型创建工具
   * @param model 模型类
   * @param handler 处理器
   * @param context 是否需要上下文
   * @returns 工具
   */
  static fromModel(
    model: new (...args: any[]) => any,
    handler?: ToolHandler,
    context: boolean = false,
  ): Tool {
    const defaultHandler = (payload: any) => payload;
    const handlerFn = handler || defaultHandler;
    return toolFromModel(model, handlerFn, { context });
  }

  /**
   * 转换工具输入
   * @param tools 工具输入
   * @returns 工具数组
   */
  static convertTools(tools: ToolInput): Tool[] {
    if (!tools) {
      return [];
    }
    if (tools instanceof ToolSet) {
      return tools.runnable;
    }
    if (
      tools.some(
        (toolItem) =>
          typeof toolItem === "object" && !(toolItem instanceof Tool),
      )
    ) {
      throw new TypeError(
        "Schema-only tools are not supported in convertTools.",
      );
    }
    const toolset = normalizeTools(tools);
    return toolset.runnable;
  }
}

/**
 * 工具集类
 */
export class ToolSet {
  readonly schemas: ToolSchema[];
  readonly runnable: Tool[];

  /**
   * 构造函数
   * @param schemas 架构列表
   * @param runnable 可执行工具列表
   */
  constructor(schemas: ToolSchema[] = [], runnable: Tool[] = []) {
    this.schemas = schemas;
    this.runnable = runnable;
  }

  /**
   * 获取载荷
   * @returns 架构数组
   */
  get payload(): any[] {
    return this.schemas.length > 0 ? this.schemas : [];
  }

  /**
   * 要求可执行工具
   * @throws 如果工具集只有架构但没有可执行工具
   */
  requireRunnable(): void {
    if (this.schemas.length > 0 && this.runnable.length === 0) {
      throw new Error("Schema-only tools cannot be executed.");
    }
  }

  /**
   * 从工具输入创建工具集
   * @param tools 工具输入
   * @returns 工具集
   */
  static fromTools(tools: ToolInput): ToolSet {
    return normalizeTools(tools);
  }
}

/**
 * 工具输入类型
 */
export type ToolInput = ToolSet | any[] | null;

/**
 * 工具条目接口
 */
interface ToolEntry {
  schema: ToolSchema;
  runnable: Tool | null;
}

/**
 * 转换为蛇形命名法
 * @param name 名称
 * @returns 蛇形命名的名称
 */
function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

/**
 * 获取可调用对象的名称
 * @param func 函数
 * @returns 名称
 */
function getCallableName(func: ToolHandler): string {
  const name = func.name;
  if (name && name.length > 0) {
    return name;
  }
  return func.constructor.name;
}

/**
 * 获取函数文档
 * @param func 函数
 * @returns 文档字符串
 */
function getFunctionDoc(func: ToolHandler): string {
  return "";
}

/**
 * 从函数生成架构
 * @param func 函数
 * @param ignoreParams 忽略的参数
 * @returns 架构对象
 */
function schemaFromFunction(
  func: ToolHandler,
  ignoreParams: string[] = [],
): Record<string, any> {
  const funcStr = func.toString();
  const match = funcStr.match(/\(([^)]*)\)/);
  const params = match ? match[1] : "";

  const properties: Record<string, any> = {};
  const required: string[] = [];

  if (params.trim()) {
    const paramList = params.split(",").map((p) => p.trim());
    for (const param of paramList) {
      const [paramName] = param.split("=").map((p) => p.trim());
      const cleanName = paramName.replace(/[:?].*$/, "").trim();

      if (ignoreParams.includes(cleanName) || !cleanName) {
        continue;
      }

      properties[cleanName] = { type: "any" };

      if (!param.includes("=") && !param.includes("?")) {
        required.push(cleanName);
      }
    }
  }

  const schema: Record<string, any> = { type: "object", properties };
  if (required.length > 0) {
    schema.required = required;
  }
  return schema;
}

/**
 * 验证工具架构
 * @param toolSchema 工具架构
 * @returns 工具名称
 * @throws 如果架构无效
 */
function validateToolSchema(toolSchema: ToolSchema): string {
  if (toolSchema.type !== "function") {
    throw new Error("Tool schema must have type='function'.");
  }
  const func = toolSchema.function;
  if (!func || typeof func !== "object") {
    throw new TypeError("Tool schema must include a 'function' object.");
  }
  const name = func.name;
  if (typeof name !== "string") {
    throw new TypeError("Tool schema must include a non-empty function name.");
  }
  if (!name.trim()) {
    throw new Error("Tool schema must include a non-empty function name.");
  }
  if (!func.parameters) {
    throw new Error("Tool schema must include function parameters.");
  }
  return name;
}

/**
 * 确保工具名称唯一
 * @param name 工具名称
 * @param seenNames 已见的名称集合
 * @throws 如果名称为空或已存在
 */
function ensureUnique(name: string, seenNames: Set<string>): void {
  if (!name) {
    throw new Error("Tool name cannot be empty.");
  }
  if (seenNames.has(name)) {
    throw new Error(`Duplicate tool name: ${name}`);
  }
  seenNames.add(name);
}

/**
 * 规范化工具项
 * @param toolItem 工具项
 * @param seenNames 已见的名称集合
 * @returns 工具条目
 * @throws 如果工具类型不支持
 */
function normalizeToolItem(toolItem: any, seenNames: Set<string>): ToolEntry {
  if (
    typeof toolItem === "object" &&
    !(toolItem instanceof Tool) &&
    toolItem.type === "function"
  ) {
    const toolName = validateToolSchema(toolItem as ToolSchema);
    ensureUnique(toolName, seenNames);
    return { schema: toolItem as ToolSchema, runnable: null };
  }

  let toolObj: Tool;
  if (toolItem instanceof Tool) {
    toolObj = toolItem;
  } else if (typeof toolItem === "function") {
    toolObj = Tool.fromCallable(toolItem);
  } else {
    throw new TypeError(`Unsupported tool type: ${typeof toolItem}`);
  }

  ensureUnique(toolObj.name, seenNames);
  return {
    schema: toolObj.schema(),
    runnable: toolObj.handler !== null ? toolObj : null,
  };
}

/**
 * 规范化工具输入
 * @param tools 工具输入
 * @returns 工具集
 */
export function normalizeTools(tools: ToolInput): ToolSet {
  if (tools === null) {
    return new ToolSet([], []);
  }
  if (tools instanceof ToolSet) {
    return tools;
  }
  if (tools.some((toolItem) => toolItem instanceof ToolSet)) {
    throw new TypeError("ToolSet cannot be mixed with other tool definitions.");
  }
  if (tools.length === 0) {
    return new ToolSet([], []);
  }

  const schemas: ToolSchema[] = [];
  const runnableTools: Tool[] = [];
  const seenNames: Set<string> = new Set();

  for (const toolItem of tools) {
    const entry = normalizeToolItem(toolItem, seenNames);
    schemas.push(entry.schema);
    if (entry.runnable !== null) {
      runnableTools.push(entry.runnable);
    }
  }

  return new ToolSet(schemas, runnableTools);
}

/**
 * 从模型生成架构
 * @param model 模型类
 * @param options 配置选项
 * @returns 工具架构
 */
export function schemaFromModel(
  model: new (...args: any[]) => any,
  options: {
    name?: string;
    description?: string;
  } = {},
): ToolSchema {
  const { name, description } = options;
  const modelName = name || toSnakeCase(model.name);
  const modelDescription = description !== undefined ? description : "";

  let parameters: Record<string, any> = { type: "object", properties: {} };
  if (model.prototype && (model.prototype as any).constructor) {
    try {
      const instance = new model();
      parameters = extractSchemaFromInstance(instance);
    } catch {
      parameters = { type: "object", properties: {} };
    }
  }

  return {
    type: "function",
    function: {
      name: modelName,
      description: modelDescription,
      parameters,
    },
  };
}

/**
 * 从实例提取架构
 * @param instance 实例
 * @returns 架构对象
 */
function extractSchemaFromInstance(instance: any): Record<string, any> {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const key of Object.keys(instance)) {
    const value = instance[key];
    const type = typeof value;

    if (type === "string") {
      properties[key] = { type: "string" };
    } else if (type === "number") {
      properties[key] = { type: "number" };
    } else if (type === "boolean") {
      properties[key] = { type: "boolean" };
    } else if (Array.isArray(value)) {
      properties[key] = { type: "array" };
    } else if (type === "object" && value !== null) {
      properties[key] = { type: "object" };
    } else {
      properties[key] = { type: "any" };
    }
    required.push(key);
  }

  const schema: Record<string, any> = { type: "object", properties };
  if (required.length > 0) {
    schema.required = required;
  }
  return schema;
}

/**
 * 从模型创建工具
 * @param model 模型类
 * @param handler 处理器
 * @param options 配置选项
 * @returns 工具
 */
export function toolFromModel(
  model: new (...args: any[]) => any,
  handler: ToolHandler,
  options: {
    name?: string;
    description?: string;
    context?: boolean;
  } = {},
): Tool {
  const { name, description, context = false } = options;
  const toolName = name || toSnakeCase(model.name);
  const toolDescription = description !== undefined ? description : "";

  if (context) {
    const funcStr = handler.toString();
    if (!funcStr.includes("context")) {
      throw new TypeError(
        "Tool context is enabled but the handler lacks a 'context' parameter.",
      );
    }
  }

  const _handler = (...args: any[]) => {
    const kwargs: Record<string, any> = args[0] || {};
    const toolContext = kwargs.context;
    delete kwargs.context;

    const parsed = new model(kwargs);
    if (context) {
      return handler(parsed, toolContext);
    }
    return handler(parsed);
  };

  const parameters = schemaFromModel(model).function.parameters;

  return new Tool(toolName, toolDescription, parameters, _handler, context);
}

/**
 * 创建工具（函数形式）
 * @param func 函数
 * @param options 配置选项
 * @returns 工具
 */
export function tool(
  func: ToolHandler,
  options?: {
    name?: string;
    model?: new (...args: any[]) => any;
    description?: string;
    context?: boolean;
  },
): Tool;
/**
 * 创建工具（选项形式）
 * @param options 配置选项
 * @returns 返回函数的函数
 */
export function tool(options: {
  name?: string;
  model?: new (...args: any[]) => any;
  description?: string;
  context?: boolean;
}): (func: ToolHandler) => Tool;
/**
 * 创建工具
 * @param funcOrOptions 函数或配置选项
 * @param options 配置选项
 * @returns 工具或返回函数的函数
 */
export function tool(
  funcOrOptions:
    | ToolHandler
    | {
        name?: string;
        model?: new (...args: any[]) => any;
        description?: string;
        context?: boolean;
      },
  options?: {
    name?: string;
    model?: new (...args: any[]) => any;
    description?: string;
    context?: boolean;
  },
): Tool | ((func: ToolHandler) => Tool) {
  const mergedOpts = options ?? {};
  if (typeof funcOrOptions === "function") {
    const func = funcOrOptions;
    const { name, model, description, context = false } = mergedOpts;

    if (model !== undefined) {
      return toolFromModel(model, func, { name, description, context });
    }
    return Tool.fromCallable(func, { name, description, context });
  } else {
    const opts = funcOrOptions;
    return (func: ToolHandler): Tool => {
      const {
        name,
        model,
        description,
        context = false,
      } = { ...opts, ...mergedOpts };

      if (model !== undefined) {
        return toolFromModel(model, func, { name, description, context });
      }
      return Tool.fromCallable(func, { name, description, context });
    };
  }
}
