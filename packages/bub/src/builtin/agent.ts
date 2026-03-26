import { LLM, ToolAutoResult, Tape, TapeContext, TapeEntry } from "republic";
import { AgentSettingsImpl } from "./settings";
import { ForkTapeStore, FileTapeStore } from "./store";
import { TapeService } from "./tape";
import { REGISTRY } from "./tools";
import { defaultTapeContext } from "./context";

export const CONTINUE_PROMPT = "Continue the task or respond to the channel.";
export const DEFAULT_BUB_HEADERS = { "HTTP-Referer": "https://bub.build/", "X-Title": "Bub" };
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

  get settings(): AgentSettingsImpl {
    return this._settings;
  }

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

  private _buildLLM(): LLM {
    return new LLM(this._settings.model, {
      apiKey: this._settings.apiKey ?? undefined,
      apiBase: this._settings.apiBase ?? undefined,
      tapeStore: this.tapes.tapes,
      context: defaultTapeContext(),
    });
  }

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
        output = "TODO: bash execution requires shell implementation";
      } else {
        const args = this._parseArgs(argTokens);
        if (entry.context) {
          args.kwargs["context"] = JSON.stringify({
            tape: tape.name,
            runId: "run_command",
            state: tape.context.state,
          });
        }
        output = await entry.run(...args.positional, ...Object.entries(args.kwargs).map(([k, v]) => `${k}=${v}`));
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

    let filteredTools = Object.values(REGISTRY);
    if (allowedTools) {
      const allowedSet = new Set(allowedTools.map((n) => n.toLowerCase()));
      filteredTools = filteredTools.filter((t) => allowedSet.has(t.name.toLowerCase()));
    }

    const timeoutMs = this._settings.modelTimeoutSeconds ? this._settings.modelTimeoutSeconds * 1000 : undefined;

    const result = await Promise.race([
      tape.runToolsAsync(promptText, {
        systemPrompt: this._systemPrompt(promptText, tape.context.state, allowedSkills),
        maxTokens: this._settings.maxTokens,
        model,
        ...extraOptions,
      }),
      timeoutMs ? new Promise<void>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)) : new Promise<void>((resolve) => setTimeout(() => resolve(undefined), 999999999)),
    ]);

    return result;
  }

  private _systemPrompt(prompt: string, state: State, allowedSkills: string[] | null | undefined): string {
    const blocks: string[] = [];

    const frameworkPrompt = (this._framework as any).getSystemPrompt?.(prompt, state);
    if (frameworkPrompt) {
      blocks.push(frameworkPrompt);
    }

    blocks.push("TODO: tools prompt rendering requires tools implementation");

    return blocks.join("\n\n");
  }

  private _loadSkillsPrompt(prompt: string, workspace: string, allowedSkills: Set<string> | null): string {
    return "";
  }

  private _parseInternalCommand(line: string): [string, string[]] {
    const words = line.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return ["", []];
    return [words[0], words.slice(1)];
  }

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

  private _extractTextFromParts(parts: Record<string, any>[]): string {
    return parts.filter((p) => p.type === "text").map((p) => p.text || "").join("\n");
  }

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
