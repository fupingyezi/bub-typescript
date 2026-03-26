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
  const workspace = context.state.get("_runtime_workspace");
  if (!workspace) {
    throw new Error(
      `relative path '${rawPath}' is not allowed without a workspace`,
    );
  }
  return rawPath;
}

async function bash(
  cmd: string,
  cwd: string | null = null,
  timeoutSeconds: number = DEFAULT_COMMAND_TIMEOUT_SECONDS,
  context?: ToolContext,
): Promise<string> {
  const workspace = context?.state.get("_runtime_workspace") as
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

function fsRead(
  path: string,
  offset: number = 0,
  limit: number | null = null,
  context?: ToolContext,
): string {
  throw new Error("TODO: fs.read tool requires filesystem implementation");
}
tool(true, "fs.read")(fsRead);

function fsWrite(path: string, content: string, context?: ToolContext): string {
  throw new Error("TODO: fs.write tool requires filesystem implementation");
}
tool(true, "fs.write")(fsWrite);

function fsEdit(
  path: string,
  oldStr: string,
  newStr: string,
  start: number = 0,
  context?: ToolContext,
): string {
  throw new Error("TODO: fs.edit tool requires filesystem implementation");
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
  throw new Error("TODO: tape.search tool requires TapeQuery implementation");
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
  throw new Error("TODO: web.fetch tool requires HTTP client implementation");
}
tool(false, "web.fetch")(webFetch);

async function runSubagent(
  param: SubAgentInput,
  context?: ToolContext,
): Promise<string> {
  throw new Error(
    "TODO: subagent tool requires agent coordination implementation",
  );
}
tool(false, "subagent")(runSubagent);

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
