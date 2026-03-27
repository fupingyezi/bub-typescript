import fs from "fs/promises";
import fsSync from "fs";
import nodePath from "path";
import { ToolContext, TapeEntry } from "republic";
import { AnchorSummary } from "./tape";
import { ShellManager } from "./shell-manager";

const shellManager = new ShellManager();

export type EntryKind =
  | "event"
  | "anchor"
  | "system"
  | "message"
  | "tool_call"
  | "tool_result";

export const DEFAULT_COMMAND_TIMEOUT_SECONDS = 30;
export const DEFAULT_HEADERS = { accept: "text/markdown" };
export const DEFAULT_REQUEST_TIMEOUT_SECONDS = 10;

export interface SearchInput {
  query: string;
  limit?: number;
  start?: string | null;
  end?: string | null;
  kinds?: EntryKind[];
}

export interface SubAgentInput {
  prompt: string | Record<string, any>[];
  model?: string | null;
  session?: string;
  allowedTools?: string[] | null;
  allowedSkills?: string[] | null;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, any>;
  context?: boolean;
  model?: any;
}

export interface ToolEntry {
  name: string;
  run: (...args: any[]) => any;
  context?: boolean;
}

export const REGISTRY: Record<string, ToolEntry> = {};

/**
 * 将 REGISTRY 中的工具条目转换为 republic Tool 格式，供模型调用。
 * @param entries - 工具条目数组
 * @returns 符合 OpenAI function calling 格式的工具对象数组
 */
export function modelTools(entries: ToolEntry[]): any[] {
  return entries.map((entry) => ({
    type: "function",
    function: {
      name: entry.name,
      description: "",
      parameters: { type: "object", properties: {} },
    },
  }));
}

/**
 * 渲染工具列表为系统提示词文本。
 * @param entries - 工具条目数组
 * @returns 包含工具名称列表的提示词字符串，若列表为空则返回空字符串
 */
export function renderToolsPrompt(entries: ToolEntry[]): string {
  if (!entries || entries.length === 0) return "";
  const lines = ["Available tools:"];
  for (const entry of entries) {
    lines.push(`  - ${entry.name}`);
  }
  return lines.join("\n");
}

/**
 * 装饰器工具，将函数注册到内置 REGISTRY。
 * @param context - 是否需要注入 ToolContext，默认 `false`
 * @param name - 工具名称，默认使用函数名
 * @param model - 关联的模型（暂未使用）
 * @returns 装饰器函数，接受工具实现函数并返回原函数
 */
export function tool(context: boolean = false, name?: string, model?: any) {
  return function <T extends (...args: any[]) => any>(fn: T): T {
    const toolName = name || fn.name;
    REGISTRY[toolName] = {
      name: toolName,
      run: fn,
      context,
    };
    return fn;
  };
}

/**
 * 从 ToolContext 中获取运行时 Agent 实例。
 * @param context - 工具调用上下文
 * @returns Agent 实例
 * @throws 若 context.state 中不存在 `_runtime_agent`，抛出错误
 */
function getAgent(context: ToolContext): any {
  if (!("_runtime_agent" in context.state)) {
    throw new Error("no runtime agent found in tool context");
  }
  return context.state["_runtime_agent"];
}

/**
 * 将相对路径解析为绝对路径，以工作区为基准目录。
 * 若路径已是绝对路径则直接返回。
 * @param context - 工具调用上下文
 * @param rawPath - 原始路径字符串
 * @returns 解析后的绝对路径
 * @throws 若为相对路径且未设置工作区，抛出错误
 */
function resolvePath(context: ToolContext, rawPath: string): string {
  if (nodePath.isAbsolute(rawPath)) {
    return rawPath;
  }
  const workspace = context.state["_runtime_workspace"] as string | undefined;
  if (!workspace) {
    throw new Error(
      `relative path '${rawPath}' is not allowed without a workspace`,
    );
  }
  return nodePath.join(workspace, rawPath);
}

/**
 * 内置工具：在 shell 中执行任意命令并返回输出。
 * @param cmd - 要执行的 shell 命令
 * @param cwd - 工作目录，为 `null` 时使用工作区路径
 * @param timeoutSeconds - 超时秒数，默认 30 秒
 * @param context - 工具调用上下文
 * @returns 命令标准输出
 * @throws 命令退出码非零或超时时抛出错误
 */
async function bash(
  cmd: string,
  cwd: string | null = null,
  timeoutSeconds: number = DEFAULT_COMMAND_TIMEOUT_SECONDS,
  context?: ToolContext,
): Promise<string> {
  const workspace = context?.state["_runtime_workspace"] as
    | string
    | undefined;
  const effectiveCwd = cwd || workspace || undefined;
  try {
    const result = await shellManager.executeWithTimeout(
      cmd,
      timeoutSeconds * 1000,
      effectiveCwd,
    );
    if (result.exitCode !== 0) {
      const message =
        result.stderr || result.stdout || `exit=${result.exitCode}`;
      throw new Error(`exit=${result.exitCode}: ${message}`);
    }
    return result.stdout || "(no output)";
  } catch (error: any) {
    if (error.message?.includes("timed out")) {
      throw error;
    }
    throw new Error(`exit=1: ${error.message}`);
  }
}
tool(true)(bash);

/**
 * 内置工具：读取文件内容，支持按行切片。
 * @param path - 文件路径（支持相对路径）
 * @param offset - 起始行号（从 0 开始），默认 0
 * @param limit - 读取行数，`null` 表示读取全部
 * @param context - 工具调用上下文
 * @returns 带行号范围头部的文件内容字符串
 * @throws 文件不存在或无法读取时抛出错误
 */
async function fsRead(
  path: string,
  offset: number = 0,
  limit: number | null = null,
  context?: ToolContext,
): Promise<string> {
  const resolvedPath = resolvePath(context!, path);
  let content: string;
  try {
    content = await fs.readFile(resolvedPath, "utf-8");
  } catch (err: any) {
    throw new Error(`fs.read: cannot read '${resolvedPath}': ${err.message}`);
  }
  const lines = content.split("\n");
  const totalLines = lines.length;
  const start = Math.max(0, offset);
  const end = limit !== null ? Math.min(start + limit, totalLines) : totalLines;
  const sliced = lines.slice(start, end).join("\n");
  const header = `[lines ${start + 1}-${end} of ${totalLines}]\n`;
  return header + sliced;
}
tool(true, "fs.read")(fsRead);

/**
 * 内置工具：将内容写入文件（自动创建目录）。
 * @param path - 文件路径（支持相对路径）
 * @param content - 要写入的内容
 * @param context - 工具调用上下文
 * @returns 写入成功的确认信息
 * @throws 写入失败时抛出错误
 */
async function fsWrite(
  path: string,
  content: string,
  context?: ToolContext,
): Promise<string> {
  const resolvedPath = resolvePath(context!, path);
  const dir = nodePath.dirname(resolvedPath);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(resolvedPath, content, "utf-8");
  } catch (err: any) {
    throw new Error(`fs.write: cannot write '${resolvedPath}': ${err.message}`);
  }
  return `ok: wrote ${content.length} chars to '${resolvedPath}'`;
}
tool(true, "fs.write")(fsWrite);

/**
 * 内置工具：将文件中第一个匹配的 `oldStr` 替换为 `newStr`。
 * @param path - 文件路径（支持相对路径）
 * @param oldStr - 要替换的原始内容
 * @param newStr - 替换后的新内容
 * @param context - 工具调用上下文
 * @returns 编辑成功的确认信息
 * @throws `oldStr` 未找到或文件读写失败时抛出错误
 */
async function fsEdit(
  path: string,
  oldStr: string,
  newStr: string,
  context?: ToolContext,
): Promise<string> {
  const resolvedPath = resolvePath(context!, path);
  let content: string;
  try {
    content = await fs.readFile(resolvedPath, "utf-8");
  } catch (err: any) {
    throw new Error(`fs.edit: cannot read '${resolvedPath}': ${err.message}`);
  }
  if (!content.includes(oldStr)) {
    throw new Error(
      `fs.edit: oldStr not found in '${resolvedPath}'. No changes made.`,
    );
  }
  const updated = content.replace(oldStr, newStr);
  try {
    await fs.writeFile(resolvedPath, updated, "utf-8");
  } catch (err: any) {
    throw new Error(`fs.edit: cannot write '${resolvedPath}': ${err.message}`);
  }
  return `ok: edited '${resolvedPath}'`;
}
tool(true, "fs.edit")(fsEdit);

/**
 * 内置工具：显示指定 skill 的详细信息。
 * @param name - skill 名称
 * @param context - 工具调用上下文
 * @returns skill 描述内容
 * @throws 待实现，目前始终抛出 TODO 错误
 */
function skillDescribe(name: string, context?: ToolContext): string {
  throw new Error("TODO: skill tool requires skill discovery implementation");
}
tool(true, "skill")(skillDescribe);

/**
 * 内置工具：获取当前 tape 的概要信息（条目数、锤点数、token 用量等）。
 * @param context - 工具调用上下文
 * @returns 格式化的 tape 信息字符串
 */
async function tapeInfo(context?: ToolContext): Promise<string> {
  const agent = getAgent(context!);
  const info = await agent.tapes.info(context!.tape || "");
  return (
    `name: ${info.name}\n` +
    `entries: ${info.entries}\n` +
    `anchors: ${info.anchors}\n` +
    `last_anchor: ${info.lastAnchor}\n` +
    `entries_since_last_anchor: ${info.entriesSinceLastAnchor}\n` +
    `last_token_usage: ${info.lastTokenUsage}`
  );
}
tool(true, "tape.info")(tapeInfo);

/**
 * 内置工具：在当前 tape 中搜索历史条目。
 * 支持按类型、时间范围、关键词和数量进行过滤。
 * @param param - 搜索参数对象
 * @param context - 工具调用上下文
 * @returns 格式化的搜索结果字符串
 */
async function tapeSearch(
  param: SearchInput,
  context?: ToolContext,
): Promise<string> {
  const agent = getAgent(context!);
  const tapeName = context!.tape || "";
  const tape = agent.tapes._llm.tape(tapeName);

  // 构建查询
  let query = tape.queryAsync;
  if (param.kinds && param.kinds.length > 0) {
    query = query.kinds(...param.kinds);
  }
  if (param.start || param.end) {
    const start = param.start || "1970-01-01";
    const end = param.end || new Date().toISOString();
    query = query.betweenDates(start, end);
  }
  if (param.query) {
    query = query.search(param.query);
  }
  if (param.limit) {
    query = query.limit(param.limit);
  }

  const entries: TapeEntry[] = await query.all();
  if (!entries || entries.length === 0) {
    return "(no results)";
  }

  const lines = entries.map((e) => {
    const ts = e.timestamp ? new Date(e.timestamp).toISOString() : "";
    const payload = JSON.stringify(e.payload).slice(0, 200);
    return `[${ts}] ${e.kind}: ${payload}`;
  });
  return lines.join("\n");
}
tool(true, "tape.search")(tapeSearch);

/**
 * 内置工具：重置当前 tape，可选将历史内容归档。
 * @param archive - 是否将当前 tape 内容归档，默认 `false`
 * @param context - 工具调用上下文
 * @returns 操作结果字符串
 */
async function tapeReset(
  archive: boolean = false,
  context?: ToolContext,
): Promise<string> {
  const agent = getAgent(context!);
  const result = await agent.tapes.reset(context!.tape || "", { archive });
  return result;
}
tool(true, "tape.reset")(tapeReset);

/**
 * 内置工具：在当前 tape 中添加一个锤点（handoff anchor）。
 * @param name - 锤点名称，默认 `"handoff"`
 * @param summary - 锤点摘要信息，默认空字符串
 * @param context - 工具调用上下文
 * @returns 添加成功的确认信息
 */
async function tapeHandoff(
  name: string = "handoff",
  summary: string = "",
  context?: ToolContext,
): Promise<string> {
  const agent = getAgent(context!);
  await agent.tapes.handoff(context!.tape || "", name, { summary });
  return `anchor added: ${name}`;
}
tool(true, "tape.handoff")(tapeHandoff);

/**
 * 内置工具：列出当前 tape 中所有锤点的名称列表。
 * @param context - 工具调用上下文
 * @returns 锤点名称列表字符串，若无锤点则返回 `"(no anchors)"`
 */
async function tapeAnchors(context?: ToolContext): Promise<string> {
  const agent = getAgent(context!);
  const anchors = await agent.tapes.anchors(context!.tape || "");
  if (!anchors || anchors.length === 0) {
    return "(no anchors)";
  }
  return anchors.map((a: AnchorSummary) => `- ${a.name}`).join("\n");
}
tool(true, "tape.anchors")(tapeAnchors);

/**
 * 内置工具：发起 HTTP GET 请求并返回响应文本。
 * @param url - 请求的 URL
 * @param headers - 额外请求头，为 `null` 时仅使用默认头
 * @param timeout - 超时秒数，为 `null` 时使用默认超时
 * @returns 响应文本内容
 * @throws HTTP 错误、超时或网络错误时抛出异常
 */
async function webFetch(
  url: string,
  headers: Record<string, string> | null = null,
  timeout: number | null = null,
): Promise<string> {
  const effectiveTimeout = (timeout ?? DEFAULT_REQUEST_TIMEOUT_SECONDS) * 1000;
  const effectiveHeaders: Record<string, string> = {
    ...DEFAULT_HEADERS,
    ...(headers || {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: effectiveHeaders,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return await response.text();
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error(`web.fetch: request to '${url}' timed out after ${effectiveTimeout}ms`);
    }
    throw new Error(`web.fetch: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}
tool(false, "web.fetch")(webFetch);

/**
 * 内置工具：启动一个子 Agent 任务。
 * 子 Agent 共享当前状态，并使用临时 session ID（以 `temp/` 开头）。
 * @param param - 子 Agent 输入参数
 * @param context - 工具调用上下文
 * @returns 子 Agent 的输出文本
 */
async function runSubagent(
  param: SubAgentInput,
  context?: ToolContext,
): Promise<string> {
  const agent = getAgent(context!);
  const sessionId = param.session || `temp/${Date.now()}`;
  const state: Record<string, any> = {
    ...context!.state,
    _runtime_agent: agent,
  };
  return await agent.run(
    sessionId,
    param.prompt,
    state,
    param.model ?? null,
    param.allowedSkills ?? null,
    param.allowedTools ?? null,
  );
}
tool(true, "subagent")(runSubagent);

/**
 * 内置工具：显示内置命令的帮助信息。
 * @returns 帮助文本字符串
 */
function showHelp(): string {
  return (
    "Commands use ',' at line start.\n" +
    "Known internal commands:\n" +
    "  ,help\n" +
    "  ,skill name=foo\n" +
    "  ,tape.info\n" +
    "  ,tape.search query=error\n" +
    "  ,tape.handoff name=phase-1 summary='done'\n" +
    "  ,tape.anchors\n" +
    "  ,fs.read path=README.md\n" +
    "  ,fs.write path=tmp.txt content='hello'\n" +
    "  ,fs.edit path=tmp.txt old=hello new=world\n" +
    "Any unknown command after ',' is executed as shell via bash."
  );
}
tool(false, "help")(showHelp);
