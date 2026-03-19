/**
 * Tool helpers for Republic.
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

  asTool(jsonMode: boolean = false): string | ToolSchema {
    const schema = this.schema();
    if (jsonMode) {
      return JSON.stringify(schema, null, 2);
    }
    return schema;
  }

  run(...args: any[]): any {
    if (this.handler === null) {
      throw new Error(
        `Tool '${this.name}' is schema-only and cannot be executed.`,
      );
    }
    return this.handler(...args);
  }

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

  static fromModel(
    model: new (...args: any[]) => any,
    handler?: ToolHandler,
    context: boolean = false,
  ): Tool {
    const defaultHandler = (payload: any) => payload;
    const handlerFn = handler || defaultHandler;
    return toolFromModel(model, handlerFn, { context });
  }

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

export class ToolSet {
  readonly schemas: ToolSchema[];
  readonly runnable: Tool[];

  constructor(schemas: ToolSchema[] = [], runnable: Tool[] = []) {
    this.schemas = schemas;
    this.runnable = runnable;
  }

  get payload(): ToolSchema[] | null {
    return this.schemas.length > 0 ? this.schemas : null;
  }

  requireRunnable(): void {
    if (this.schemas.length > 0 && this.runnable.length === 0) {
      throw new Error("Schema-only tools cannot be executed.");
    }
  }

  static fromTools(tools: ToolInput): ToolSet {
    return normalizeTools(tools);
  }
}

export type ToolInput = ToolSet | any[] | null;

interface ToolEntry {
  schema: ToolSchema;
  runnable: Tool | null;
}

function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "");
}

function getCallableName(func: ToolHandler): string {
  const name = func.name;
  if (name && name.length > 0) {
    return name;
  }
  return func.constructor.name;
}

function getFunctionDoc(func: ToolHandler): string {
  return "";
}

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

function ensureUnique(name: string, seenNames: Set<string>): void {
  if (!name) {
    throw new Error("Tool name cannot be empty.");
  }
  if (seenNames.has(name)) {
    throw new Error(`Duplicate tool name: ${name}`);
  }
  seenNames.add(name);
}

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

export function tool(
  func: ToolHandler,
  options?: {
    name?: string;
    model?: new (...args: any[]) => any;
    description?: string;
    context?: boolean;
  },
): Tool;
export function tool(options: {
  name?: string;
  model?: new (...args: any[]) => any;
  description?: string;
  context?: boolean;
}): (func: ToolHandler) => Tool;
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
