/**
 * Tool execution helpers for Republic.
 */

import { ErrorPayload } from "@/core/results";
import { ErrorKind, ToolCall } from "@/types";
import { ToolContext } from "./context";
import { Tool, ToolInput, ToolSet, normalizeTools } from "./schema";

/**
 * 工具执行器类
 */
export class ToolExecutor {
  /**
   * 执行工具调用
   * @param response 响应对象
   * @param tools 工具输入
   * @param context 工具上下文
   * @returns 工具执行结果
   */
  execute(
    response: Record<string, any>[] | Record<string, any> | string,
    tools: ToolInput = null,
    context: ToolContext | null = null,
  ): ToolExecution {
    const [toolCalls, toolMap] = this._prepareExecution(response, tools);
    if (!toolMap || toolMap.size === 0) {
      if (toolCalls.length > 0) {
        throw new ErrorPayload(
          ErrorKind.TOOL,
          "No runnable tools are available.",
        );
      }
      return new ToolExecution([], []);
    }

    const results: any[] = [];
    let error: ErrorPayload | null = null;

    for (const toolResponse of toolCalls) {
      try {
        const result = this._handleToolResponse(toolResponse, toolMap, context);
        results.push(result);
      } catch (exc) {
        if (exc instanceof ErrorPayload) {
          error = exc;
          results.push(exc.asDict());
        } else {
          throw exc;
        }
      }
    }

    return new ToolExecution(toolCalls, results, error);
  }

  /**
   * 异步执行工具调用
   * @param response 响应对象
   * @param tools 工具输入
   * @param context 工具上下文
   * @returns 包含工具执行结果的Promise
   */
  async executeAsync(
    response: Record<string, any>[] | Record<string, any> | string,
    tools: ToolInput = null,
    context: ToolContext | null = null,
  ): Promise<ToolExecution> {
    const [toolCalls, toolMap] = this._prepareExecution(response, tools);
    if (!toolMap || toolMap.size === 0) {
      if (toolCalls.length > 0) {
        throw new ErrorPayload(
          ErrorKind.TOOL,
          "No runnable tools are available.",
        );
      }
      return new ToolExecution([], []);
    }

    const results: any[] = [];
    let error: ErrorPayload | null = null;

    for (const toolResponse of toolCalls) {
      try {
        const result = await this._handleToolResponseAsync(
          toolResponse,
          toolMap,
          context,
        );
        results.push(result);
      } catch (exc) {
        if (exc instanceof ErrorPayload) {
          error = exc;
          results.push(exc.asDict());
        } else {
          throw exc;
        }
      }
    }

    return new ToolExecution(toolCalls, results, error);
  }

  /**
   * 准备执行工具调用
   * @param response 响应对象
   * @param tools 工具输入
   * @returns [toolCalls, toolMap]元组
   */
  private _prepareExecution(
    response: Record<string, any>[] | Record<string, any> | string,
    tools: ToolInput,
  ): [ToolCall[], Map<string, Tool>] {
    const toolCalls = this._normalizeResponse(response);
    const toolMap = this._buildToolMap(tools);
    return [toolCalls, toolMap];
  }

  /**
   * 解析工具调用
   * @param toolResponse 工具响应
   * @param toolMap 工具映射
   * @returns [toolName, toolObj, toolArgs]元组
   */
  private _resolveToolCall(
    toolResponse: any,
    toolMap: Map<string, Tool>,
  ): [string, Tool, Record<string, any>] {
    if (typeof toolResponse !== "object" || toolResponse === null) {
      throw new ErrorPayload(
        ErrorKind.INVALID_INPUT,
        "Each tool call must be an object.",
      );
    }

    const toolName = toolResponse.function?.name;
    if (!toolName) {
      throw new ErrorPayload(
        ErrorKind.INVALID_INPUT,
        "Tool call is missing name.",
      );
    }

    const toolObj = toolMap.get(toolName);
    if (toolObj === undefined) {
      throw new ErrorPayload(ErrorKind.TOOL, `Unknown tool name: ${toolName}.`);
    }

    let toolArgs = toolResponse.function?.arguments ?? {};
    toolArgs = this._normalizeToolArgs(toolName, toolArgs);

    return [toolName, toolObj, toolArgs];
  }

  /**
   * 调用工具
   * @param toolName 工具名称
   * @param toolObj 工具对象
   * @param toolArgs 工具参数
   * @param context 工具上下文
   * @returns 工具执行结果
   */
  private _invokeTool(
    toolName: string,
    toolObj: Tool,
    toolArgs: Record<string, any>,
    context: ToolContext | null,
  ): any {
    if (toolObj.context) {
      if (context === null) {
        throw new ErrorPayload(
          ErrorKind.INVALID_INPUT,
          `Tool '${toolName}' requires context but none was provided.`,
        );
      }
      return toolObj.run({ ...toolArgs, context });
    }
    return toolObj.run(toolArgs);
  }

  /**
   * 处理工具响应
   * @param toolResponse 工具响应
   * @param toolMap 工具映射
   * @param context 工具上下文
   * @returns 工具执行结果
   */
  private _handleToolResponse(
    toolResponse: any,
    toolMap: Map<string, Tool>,
    context: ToolContext | null,
  ): any {
    const [toolName, toolObj, toolArgs] = this._resolveToolCall(
      toolResponse,
      toolMap,
    );

    try {
      const result = this._invokeTool(toolName, toolObj, toolArgs, context);

      if (
        result &&
        typeof result === "object" &&
        typeof result.then === "function"
      ) {
        if (typeof result.catch === "function") {
          result.catch(() => {});
        }
        this._raiseAsyncExecuteError(toolName);
      }

      return result;
    } catch (exc) {
      if (exc instanceof ErrorPayload) {
        throw exc;
      }

      if (exc instanceof Error && exc.name === "ValidationError") {
        throw new ErrorPayload(
          ErrorKind.INVALID_INPUT,
          `Tool '${toolName}' argument validation failed.`,
          { errors: (exc as any).errors || exc.message },
        );
      }

      throw new ErrorPayload(
        ErrorKind.TOOL,
        `Tool '${toolName}' execution failed.`,
        { error: String(exc) },
      );
    }
  }

  /**
   * 异步处理工具响应
   * @param toolResponse 工具响应
   * @param toolMap 工具映射
   * @param context 工具上下文
   * @returns 包含工具执行结果的Promise
   */
  private async _handleToolResponseAsync(
    toolResponse: any,
    toolMap: Map<string, Tool>,
    context: ToolContext | null,
  ): Promise<any> {
    const [toolName, toolObj, toolArgs] = this._resolveToolCall(
      toolResponse,
      toolMap,
    );

    try {
      let result = this._invokeTool(toolName, toolObj, toolArgs, context);

      if (
        result &&
        typeof result === "object" &&
        typeof result.then === "function"
      ) {
        result = await result;
      }

      return result;
    } catch (exc) {
      if (exc instanceof ErrorPayload) {
        throw exc;
      }

      if (exc instanceof Error && exc.name === "ValidationError") {
        throw new ErrorPayload(
          ErrorKind.INVALID_INPUT,
          `Tool '${toolName}' argument validation failed.`,
          { errors: (exc as any).errors || exc.message },
        );
      }

      throw new ErrorPayload(
        ErrorKind.TOOL,
        `Tool '${toolName}' execution failed.`,
        { error: String(exc) },
      );
    }
  }

  /**
   * 抛出异步执行错误
   * @param toolName 工具名称
   * @returns 从不返回
   */
  private _raiseAsyncExecuteError(toolName: string): never {
    throw new ErrorPayload(
      ErrorKind.INVALID_INPUT,
      `Tool '${toolName}' is async; use executeAsync() instead of execute().`,
    );
  }

  /**
   * 规范化响应
   * @param response 响应对象
   * @returns 工具调用列表
   */
  private _normalizeResponse(
    response: Record<string, any>[] | Record<string, any> | string,
  ): ToolCall[] {
    let parsed: any = response;

    if (typeof response === "string") {
      try {
        parsed = JSON.parse(response);
      } catch (exc) {
        throw new ErrorPayload(
          ErrorKind.INVALID_INPUT,
          "Tool response is not a valid JSON string.",
          { error: String(exc) },
        );
      }
    }

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      parsed = [parsed];
    }

    if (!Array.isArray(parsed)) {
      throw new ErrorPayload(
        ErrorKind.INVALID_INPUT,
        "Tool response must be a list of objects.",
      );
    }

    return parsed as ToolCall[];
  }

  /**
   * 构建工具映射
   * @param tools 工具输入
   * @returns 工具名称到工具对象的映射
   */
  private _buildToolMap(tools: ToolInput): Map<string, Tool> {
    if (tools === null) {
      throw new ErrorPayload(ErrorKind.INVALID_INPUT, "No tools provided.");
    }

    try {
      const toolset = normalizeTools(tools);
      const map = new Map<string, Tool>();
      for (const toolObj of toolset.runnable) {
        if (toolObj.name) {
          map.set(toolObj.name, toolObj);
        }
      }
      return map;
    } catch (exc) {
      if (exc instanceof Error) {
        throw new ErrorPayload(ErrorKind.INVALID_INPUT, exc.message);
      }
      throw exc;
    }
  }

  /**
   * 规范化工具参数
   * @param toolName 工具名称
   * @param toolArgs 工具参数
   * @returns 规范化后的工具参数
   */
  private _normalizeToolArgs(
    toolName: string,
    toolArgs: any,
  ): Record<string, any> {
    if (typeof toolArgs === "string") {
      try {
        toolArgs = JSON.parse(toolArgs);
      } catch (exc) {
        throw new ErrorPayload(
          ErrorKind.INVALID_INPUT,
          `Tool '${toolName}' arguments are not valid JSON.`,
        );
      }
    }

    if (typeof toolArgs === "object" && toolArgs !== null) {
      return { ...toolArgs };
    }

    throw new ErrorPayload(
      ErrorKind.INVALID_INPUT,
      `Tool '${toolName}' arguments must be an object.`,
    );
  }
}

export class ToolExecution {
  readonly toolCalls: ToolCall[];
  readonly toolResults: any[];
  readonly error: ErrorPayload | null;

  constructor(
    toolCalls: ToolCall[] = [],
    toolResults: any[] = [],
    error: ErrorPayload | null = null,
  ) {
    this.toolCalls = toolCalls;
    this.toolResults = toolResults;
    this.error = error;
  }
}
