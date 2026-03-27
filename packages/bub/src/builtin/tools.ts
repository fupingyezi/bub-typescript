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
 * 将 REGISTRY 中的工具条目转换为 republic Tool 格式，供模型调用
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
 * 渲染工具列表为系统提示词文本
 */
export function renderToolsPrompt(entries: ToolEntry[]): string {
  if (!entries || entries.length === 0) return "";
  const lines = ["Available tools:"];
  for (const entry of entries) {
    lines.push(`  - ${entry.name}`);
  }
  return lines.join("\n");
}

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

function getAgent(context: ToolContext): any {
  if (!("_runtime_agent" in context.state)) {
    throw new Error("no runtime agent found in tool context");
  }
  return context.state["_runtime_agent"];
}

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

function skillDescribe(name: string, context?: ToolContext): string {
  throw new Error("TODO: skill tool requires skill discovery implementation");
}
tool(true, "skill")(skillDescribe);

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

async function tapeReset(
  archive: boolean = false,
  context?: ToolContext,
): Promise<string> {
  const agent = getAgent(context!);
  const result = await agent.tapes.reset(context!.tape || "", { archive });
  return result;
}
tool(true, "tape.reset")(tapeReset);

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

async function tapeAnchors(context?: ToolContext): Promise<string> {
  const agent = getAgent(context!);
  const anchors = await agent.tapes.anchors(context!.tape || "");
  if (!anchors || anchors.length === 0) {
    return "(no anchors)";
  }
  return anchors.map((a: AnchorSummary) => `- ${a.name}`).join("\n");
}
tool(true, "tape.anchors")(tapeAnchors);

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
