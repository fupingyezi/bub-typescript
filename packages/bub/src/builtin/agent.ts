import { LLM, ToolAutoResult, Tape, TapeContext, TapeEntry } from "republic";
import { AgentSettingsImpl } from "./settings";
import { ForkTapeStore, FileTapeStore } from "./store";
import { TapeService } from "./tape";
import { REGISTRY, renderToolsPrompt, modelTools } from "../tools";
import { defaultTapeContext } from "./context";
import { discoverSkills, renderSkillsPrompt } from "../skills";

/** 工具调用循环中，提示模型继续执行任务或向频道发送回复的默认提示词。 */
export const CONTINUE_PROMPT = "Continue the task or respond to the channel.";
/** 通过 OpenRouter 调用模型时附加的默认 HTTP 请求头。 */
export const DEFAULT_BUB_HEADERS = { "HTTP-Referer": "https://bub.build/", "X-Title": "Bub" };
/** 用于匹配 prompt 中 `$channel` 格式提示词的正则表达式。 */
export const HINT_RE = /\$([A-Za-z0-9_.-]+)/;

export type State = Record<string, any>;

export class Agent {
  private _settings: AgentSettingsImpl;
  private _framework: any;
  public tapes: TapeService;

  constructor(framework: any) {
    this._settings = AgentSettingsImpl.fromEnv();
    this._framework = framework;
    this.tapes = this._initTapes();
  }

  /**
   * 获取当前 Agent 的配置项实例。
   */
  get settings(): AgentSettingsImpl {
    return this._settings;
  }

  /**
   * 初始化 TapeService，优先使用 framework 提供的 TapeStore，否则使用空的 ForkTapeStore。
   * @returns 初始化完成的 TapeService 实例
   */
  private _initTapes(): TapeService {
    let tapeStore = (this._framework as any).getTapeStore?.();
    if (!tapeStore) {
      tapeStore = new ForkTapeStore({} as any);
    } else {
      tapeStore = new ForkTapeStore(tapeStore);
    }
    const llm = this._buildLLM();
    return new TapeService(llm, `${this._settings.home}/tapes`, tapeStore);
  }

  /**
   * 根据当前配置构建 LLM 实例。
   * @returns 配置好的 LLM 实例
   */
  private _buildLLM(): LLM {
    return new LLM(this._settings.model, {
      apiKey: this._settings.apiKey ?? undefined,
      apiBase: this._settings.apiBase ?? undefined,
      tapeStore: this.tapes.tapes,
      context: defaultTapeContext(),
    });
  }

  /**
   * 执行一次 Agent 任务。
   * 若 prompt 以 `,` 开头则作为内部命令执行，否则进入工具调用循环。
   * @param sessionId - 当前会话 ID
   * @param prompt - 用户输入的提示词（字符串或多模态消息数组）
   * @param state - 运行时状态对象
   * @param model - 可选的模型名称覆盖
   * @param allowedSkills - 允许使用的 skill 名称列表，`null` 表示不限制
   * @param allowedTools - 允许使用的工具名称列表，`null` 表示不限制
   * @returns 模型或命令的输出文本
   */
  async run(
    sessionId: string,
    prompt: string | Record<string, any>[],
    state: State,
    model?: string | null,
    allowedSkills?: string[] | null,
    allowedTools?: string[] | null,
  ): Promise<string> {
    if (!prompt || (typeof prompt === "string" && !prompt.trim())) {
      return "error: empty prompt";
    }

    const workspace = state._runtime_workspace || ".";
    const tape = this.tapes.sessionTape(sessionId, workspace);
    (tape.context.state as Record<string, any>) = { ...tape.context.state, ...state };

    const mergeBack = !sessionId.startsWith("temp/");

    await this.tapes.forkTape(tape.name, mergeBack);
    await this.tapes.ensureBootstrapAnchor(tape.name);

    if (typeof prompt === "string" && prompt.trim().startsWith(",")) {
      return await this._runCommand(tape, prompt.trim());
    }

    return await this._agentLoop(tape, prompt, model, allowedSkills, allowedTools);
  }

  /**
   * 执行以 `,` 开头的内部命令。
   * 先尝试在 REGISTRY 中查找对应工具，若未找到则回退到 bash 执行。
   * @param tape - 当前会话的 Tape 实例
   * @param line - 原始命令行字符串（含前缀 `,`）
   * @returns 命令执行结果文本
   */
  private async _runCommand(tape: Tape, line: string): Promise<string> {
    const command = line.slice(1).trim();
    if (!command) {
      throw new Error("empty command");
    }

    const [name, argTokens] = this._parseInternalCommand(command);
    const start = Date.now();

    let output = "";
    let status = "ok";

    try {
      const entry = REGISTRY[name];
      if (!entry) {
        // 未知命令，尝试作为 bash 命令执行
        const bashEntry = REGISTRY["bash"];
        if (bashEntry) {
          const toolContext = { tape: tape.name, runId: "run_command", state: tape.context.state };
          output = await bashEntry.run(line.slice(1).trim(), null, null, toolContext);
        } else {
          output = `unknown command: ${name}`;
        }
      } else {
        const args = this._parseArgs(argTokens);
        const toolContext = { tape: tape.name, runId: "run_command", state: tape.context.state };
        if (entry.context) {
          output = await entry.run(...args.positional, ...Object.values(args.kwargs), toolContext);
        } else {
          output = await entry.run(...args.positional, ...Object.values(args.kwargs));
        }
      }
    } catch (exc) {
      status = "error";
      output = String(exc);
    }

    const elapsedMs = Date.now() - start;
    await this.tapes.appendEvent(tape.name, "command", {
      raw: line,
      name,
      status,
      elapsed_ms: elapsedMs,
      output,
      date: new Date().toISOString(),
    });

    return output;
  }

  /**
   * Agent 主循环：反复调用模型直到得到最终文本输出或达到最大步数。
   * 每步记录 `loop.step.start` 和 `loop.step` 事件到 tape。
   * @param tape - 当前会话的 Tape 实例
   * @param prompt - 初始提示词
   * @param model - 可选的模型名称覆盖
   * @param allowedSkills - 允许使用的 skill 名称列表
   * @param allowedTools - 允许使用的工具名称列表
   * @returns 最终文本输出
   * @throws 若达到最大步数，抛出 `max_steps_reached` 错误
   */
  private async _agentLoop(
    tape: Tape,
    prompt: string | Record<string, any>[],
    model: string | null | undefined,
    allowedSkills: string[] | null | undefined,
    allowedTools: string[] | null | undefined,
  ): Promise<string> {
    let nextPrompt: string | Record<string, any>[] = prompt;
    const displayModel = model || this._settings.model;

    for (let step = 1; step <= this._settings.maxSteps; step++) {
      const start = Date.now();

      await this.tapes.appendEvent(tape.name, "loop.step.start", { step, prompt: nextPrompt });

      try {
        const output = await this._runToolsOnce(tape, nextPrompt, model, allowedSkills, allowedTools);
        const outcome = this._resolveToolAutoResult(output);

        const elapsedMs = Date.now() - start;
        if (outcome.kind === "text") {
          await this.tapes.appendEvent(tape.name, "loop.step", {
            step,
            elapsed_ms: elapsedMs,
            status: "ok",
            date: new Date().toISOString(),
          });
          return outcome.text ?? "";
        }

        if (outcome.kind === "continue") {
          if ("context" in tape.context.state) {
            nextPrompt = `${CONTINUE_PROMPT} [context: ${tape.context.state["context"]}]`;
          } else {
            nextPrompt = CONTINUE_PROMPT;
          }
          await this.tapes.appendEvent(tape.name, "loop.step", {
            step,
            elapsed_ms: elapsedMs,
            status: "continue",
            date: new Date().toISOString(),
          });
          continue;
        }

        await this.tapes.appendEvent(tape.name, "loop.step", {
          step,
          elapsed_ms: elapsedMs,
          status: "error",
          error: outcome.error,
          date: new Date().toISOString(),
        });
        throw new Error(outcome.error);
      } catch (exc) {
        const elapsedMs = Date.now() - start;
        await this.tapes.appendEvent(tape.name, "loop.step", {
          step,
          elapsed_ms: elapsedMs,
          status: "error",
          error: String(exc),
          date: new Date().toISOString(),
        });
        throw exc;
      }
    }

    throw new Error(`max_steps_reached=${this._settings.maxSteps}`);
  }

  /**
   * 执行一次模型调用（含工具调用），返回 `ToolAutoResult`。
   * 若配置了超时，则使用 `Promise.race` 实现超时控制。
   * @param tape - 当前会话的 Tape 实例
   * @param prompt - 当前步骤的提示词
   * @param model - 可选的模型名称覆盖
   * @param allowedSkills - 允许使用的 skill 名称列表
   * @param allowedTools - 允许使用的工具名称列表
   * @returns 模型调用结果
   */
  private async _runToolsOnce(
    tape: Tape,
    prompt: string | Record<string, any>[],
    model: string | null | undefined,
    allowedSkills: string[] | null | undefined,
    allowedTools: string[] | null | undefined,
  ): Promise<ToolAutoResult> {
    const extraOptions: Record<string, any> = {};
    if (this._settings.model.startsWith("openrouter:")) {
      extraOptions.extra_headers = DEFAULT_BUB_HEADERS;
    }

    const promptText = typeof prompt === "string" ? prompt : this._extractTextFromParts(prompt);

    // 过滤工具列表，并转换为 republic Tool 格式
    let filteredTools = Object.values(REGISTRY);
    if (allowedTools) {
      const allowedSet = new Set(allowedTools.map((n) => n.toLowerCase()));
      filteredTools = filteredTools.filter((t) => allowedSet.has(t.name.toLowerCase()));
    }
    const tools = modelTools(filteredTools);

    const systemPrompt = await this._systemPrompt(promptText, tape.context.state, allowedSkills);

    const timeoutMs = this._settings.modelTimeoutSeconds ? this._settings.modelTimeoutSeconds * 1000 : undefined;

    const runPromise = tape.runToolsAsync(promptText, {
      systemPrompt,
      maxTokens: this._settings.maxTokens,
      model,
      tools,
      ...extraOptions,
    });

    const result = timeoutMs
      ? await Promise.race([
          runPromise,
          new Promise<ToolAutoResult>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), timeoutMs),
          ),
        ])
      : await runPromise;

    return result;
  }

  /**
   * 构建完整的系统提示词，依次拼接：framework 系统提示词、工具列表、skill 列表。
   * @param prompt - 当前用户提示词文本
   * @param state - 运行时状态对象
   * @param allowedSkills - 允许使用的 skill 名称列表
   * @returns 拼接后的系统提示词字符串
   */
  private async _systemPrompt(
    prompt: string,
    state: State,
    allowedSkills: string[] | null | undefined,
  ): Promise<string> {
    const blocks: string[] = [];

    // 获取 framework 系统提示词（异步）
    const frameworkPrompt = await (this._framework as any).getSystemPrompt?.(prompt, state);
    if (frameworkPrompt) {
      blocks.push(frameworkPrompt);
    }

    // 渲染工具提示词
    const allTools = Object.values(REGISTRY);
    const toolsPrompt = renderToolsPrompt(allTools);
    if (toolsPrompt) {
      blocks.push(toolsPrompt);
    }

    // 渲染技能提示词
    const workspace = (state._runtime_workspace as string) || process.cwd();
    const skillsPromptStr = this._loadSkillsPrompt(prompt, workspace, allowedSkills ? new Set(allowedSkills) : null);
    if (skillsPromptStr) {
      blocks.push(skillsPromptStr);
    }

    return blocks.join("\n\n");
  }

  /**
   * 发现并渲染 skill 列表提示词。
   * 若发现失败或无可用 skill，返回空字符串。
   * @param prompt - 当前用户提示词（暂未使用，保留供未来扩展）
   * @param workspace - 工作区绝对路径
   * @param allowedSkills - 允许使用的 skill 名称集合，`null` 表示不限制
   * @returns skill 列表提示词字符串
   */
  private _loadSkillsPrompt(
    prompt: string,
    workspace: string,
    allowedSkills: Set<string> | null,
  ): string {
    try {
      const skills = discoverSkills(workspace);
      const filtered = allowedSkills
        ? skills.filter((s) => allowedSkills.has(s.name))
        : skills;
      if (filtered.length === 0) return "";
      return renderSkillsPrompt(filtered);
    } catch {
      return "";
    }
  }

  /**
   * 将命令行字符串解析为命令名和参数 token 列表。
   * @param line - 命令行字符串（不含前缀 `,`）
   * @returns `[命令名, 参数token数组]` 元组
   */
  private _parseInternalCommand(line: string): [string, string[]] {
    const words = line.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return ["", []];
    return [words[0], words.slice(1)];
  }

  /**
   * 将参数 token 列表解析为位置参数和关键字参数。
   * 关键字参数格式为 `key=value`，位置参数不能出现在关键字参数之后。
   * @param argsTokens - 参数 token 数组
   * @returns 包含 `positional` 和 `kwargs` 的对象
   * @throws 若位置参数出现在关键字参数之后，抛出错误
   */
  private _parseArgs(argsTokens: string[]): { positional: string[]; kwargs: Record<string, string> } {
    const positional: string[] = [];
    const kwargs: Record<string, string> = {};
    let firstKwarg = false;

    for (const token of argsTokens) {
      if (token.includes("=")) {
        const [key, value] = token.split("=", 1);
        kwargs[key] = value;
        firstKwarg = true;
      } else if (firstKwarg) {
        throw new Error(`positional argument '${token}' cannot appear after keyword arguments`);
      } else {
        positional.push(token);
      }
    }

    return { positional, kwargs };
  }

  /**
   * 从多模态消息数组中提取所有 `type=text` 部分的文本，以换行拼接。
   * @param parts - 多模态消息数组
   * @returns 拼接后的纯文本字符串
   */
  private _extractTextFromParts(parts: Record<string, any>[]): string {
    return parts.filter((p) => p.type === "text").map((p) => p.text || "").join("\n");
  }

  /**
   * 将 `ToolAutoResult` 解析为统一的结果对象。
   * - `text`：模型返回了最终文本
   * - `continue`：模型发起了工具调用，需继续循环
   * - `error`：发生错误
   * @param output - republic 返回的 ToolAutoResult
   * @returns 包含 `kind`、可选 `text` 和 `error` 的结果对象
   */
  private _resolveToolAutoResult(output: ToolAutoResult): { kind: string; text?: string; error?: string } {
    if (output.kind === "text") {
      return { kind: "text", text: output.text || "" };
    }
    if (output.kind === "tools" || output.toolCalls || output.toolResults) {
      return { kind: "continue" };
    }
    if (!output.error) {
      return { kind: "error", error: "tool_auto_error: unknown" };
    }
    const errorKind = output.error.kind?.value || String(output.error.kind);
    return { kind: "error", error: `${errorKind}: ${output.error.message}` };
  }
}
