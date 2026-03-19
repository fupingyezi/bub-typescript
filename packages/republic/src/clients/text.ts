import { ErrorPayload } from "@/core/results";
import { ErrorKind } from "@/types";

interface DecisionOutput {
  value: boolean;
}

interface ClassifyDecision {
  label: string;
}

export class TextClient {
  private _chat: any;

  constructor(chat: any) {
    this._chat = chat;
  }

  private static _buildIfPrompt(inputText: string, question: string): string {
    return `
Here is an input:
<input>
${inputText.trim()}
</input>

And a question:
<question>
${question.trim()}
</question>

Answer by calling the tool with a boolean \`value\`.
    `.trim();
  }

  private static _buildClassifyPrompt(
    inputText: string,
    choicesStr: string,
  ): string {
    return `
You are given this input:
<input>
${inputText.trim()}
</input>

And the following choices:
<choices>
${choicesStr}
</choices>

Answer by calling the tool with \`label\` set to one of the choices.
    `.trim();
  }

  private static _normalizeChoices(choices: string[]): string[] {
    if (!choices || choices.length === 0) {
      throw new ErrorPayload(
        ErrorKind.INVALID_INPUT,
        "choices must not be empty.",
      );
    }
    return choices.map((choice) => choice.trim());
  }

  async if_(
    inputText: string,
    question: string,
    options: {
      tape?: string | null;
      context?: any;
    } = {},
  ): Promise<boolean> {
    const { tape = null, context = null } = options;
    const prompt = TextClient._buildIfPrompt(inputText, question);
    const toolSchema = {
      name: "if_decision",
      description: "Return a boolean.",
      parameters: {
        type: "object",
        properties: {
          value: {
            type: "boolean",
          },
        },
        required: ["value"],
      },
    };
    const calls = await this._chat.toolCallsAsync({
      prompt,
      tools: [toolSchema],
      tape,
      context,
    });
    return this._parseToolCall(calls, "value");
  }

  async classify(
    inputText: string,
    choices: string[],
    options: {
      tape?: string | null;
      context?: any;
    } = {},
  ): Promise<string> {
    const { tape = null, context = null } = options;
    const normalized = TextClient._normalizeChoices(choices);
    const choicesStr = normalized.join(", ");
    const prompt = TextClient._buildClassifyPrompt(inputText, choicesStr);
    const toolSchema = {
      name: "classify_decision",
      description: "Return one label.",
      parameters: {
        type: "object",
        properties: {
          label: {
            type: "string",
          },
        },
        required: ["label"],
      },
    };
    const calls = await this._chat.toolCallsAsync({
      prompt,
      tools: [toolSchema],
      tape,
      context,
    });
    const label = this._parseToolCall(calls, "label");
    if (!normalized.includes(label)) {
      throw new ErrorPayload(
        ErrorKind.INVALID_INPUT,
        "classification label is not in the allowed choices.",
        { label, choices: normalized },
      );
    }
    return label;
  }

  private _parseToolCall(calls: any, field: string): any {
    if (!Array.isArray(calls) || calls.length === 0) {
      throw new ErrorPayload(ErrorKind.INVALID_INPUT, "tool call is missing.");
    }
    const call = calls[0];
    let args = call?.function?.arguments;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch (exc) {
        throw new ErrorPayload(
          ErrorKind.INVALID_INPUT,
          "tool arguments are not valid JSON.",
          { error: String(exc) },
        );
      }
    }
    if (typeof args !== "object" || args === null) {
      throw new ErrorPayload(
        ErrorKind.INVALID_INPUT,
        "tool arguments must be an object.",
      );
    }
    return args[field];
  }
}
