import { ChatOpenAI } from "@langchain/openai";
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { createLangchainLLMClient } from "./client-registry";
import { ErrorKindType, ErrorKind } from "@/types";
import { RepbulicError } from "./errors";
import { normalizeResponses_kwargs } from "./request-adapters";

export type AttemptDecision = "retry_same_model" | "retry_next_model";

export type AttemptOutCome = {
  error: RepbulicError;
  decision: AttemptDecision;
};

export type TransportResponse = {
  transport: "completion" | "response" | "messages";
  payload: any;
};

export type TransportCallRequest = {
  client: ChatOpenAI;
  providerName: string;
  modelId: string;
  messagePayload: Record<string, any>[];
  toolsPayload: Record<string, any>[] | undefined;
  maxTokens: number | undefined;
  stream: boolean;
  reasoningEffort: any | undefined;
  kwargs: Record<string, any>;
};

export class LLMCore {
  private _provider: string;
  private _model: string;
  private _fallback_models: string[];
  private _max_retries: number;
  private _api_key: string | Record<string, string> | undefined;
  private _api_key_resolver: (
    key: string,
  ) => Promise<string | undefined> | undefined;
  private _api_base: string | Record<string, string> | undefined;
  private _client_args: Record<string, any> | undefined;
  private _api_format: "completion" | "response" | "messages";
  private _verbose: number;
  private _error_classifier: (error: Error) => ErrorKindType | undefined;
  private _client_cache: Record<string, any> = {};

  constructor(
    provider: string,
    model: string,
    fallback_models: string[],
    max_retries: number,
    api_key: string | Record<string, string> | undefined,
    api_key_resolver: (key: string) => Promise<string | undefined> | undefined,
    api_base: string | Record<string, string> | undefined,
    client_args: Record<string, any> | undefined,
    api_format: "completion" | "response" | "messages",
    verbose: number,
    error_classifier: (error: Error) => ErrorKindType | undefined,
  ) {
    this._provider = provider;
    this._model = model;
    this._fallback_models = fallback_models;
    this._max_retries = max_retries;
    this._api_key = api_key;
    this._api_key_resolver = api_key_resolver;
    this._api_base = api_base;
    this._client_args = client_args;
    this._api_format = api_format;
    this._verbose = verbose;
    this._error_classifier = error_classifier;
  }

  get provider(): string {
    return this._provider;
  }

  get model(): string {
    return this._model;
  }

  get fallback_models(): string[] {
    return this._fallback_models;
  }

  get max_retries(): number {
    return this._max_retries;
  }

  maxAttempts(): number {
    return Math.max(this._max_retries + 1, 1);
  }

  static resolveModelProvider(
    model: string,
    provider: string | undefined,
  ): Record<string, any> {
    if (provider) {
      if (model.includes(":")) {
        throw new RepbulicError(
          ErrorKind.INVALID_INPUT,
          "Model name cannot contain ':'",
        );
      }
      return {
        provider,
        model,
      };
    }

    if (!model.includes(":")) {
      throw new RepbulicError(
        ErrorKind.INVALID_INPUT,
        "Model must be in 'provider:model' format.",
      );
    }

    const [providerName, modelId] = model.split(":");
    if (!providerName || !modelId) {
      throw new RepbulicError(
        ErrorKind.INVALID_INPUT,
        "Model must be in 'provider:model' format.",
      );
    }
    return {
      provider: providerName,
      model: modelId,
    };
  }

  resolveFallback(model: string): Record<string, any> {
    if (model.includes(":")) {
      const [providerName, modelId] = model.split(":");
      if (!providerName || !modelId) {
        throw new RepbulicError(
          ErrorKind.INVALID_INPUT,
          "Fallback models must be in 'provider:model' format.",
        );
      }
      return {
        provider: providerName,
        model: modelId,
      };
    }
    if (this._provider) {
      return {
        provider: this._provider,
        model: model,
      };
    }
    throw new RepbulicError(
      ErrorKind.INVALID_INPUT,
      "Fallback models must include provider or LLM must be initialized with a provider.",
    );
  }

  modelCandidates(
    overrideModel: string | undefined,
    overrideProvider: string | undefined,
  ): Array<[string, string]> {
    if (overrideModel) {
      const resolved = LLMCore.resolveModelProvider(
        overrideModel,
        overrideProvider,
      );
      return [[resolved.provider, resolved.model]];
    }

    const candidates: Array<[string, string]> = [[this._provider, this._model]];
    for (const model of this._fallback_models) {
      const resolved = this.resolveFallback(model);
      candidates.push([resolved.provider, resolved.model]);
    }
    return candidates;
  }

  async *iterClients(
    overrideModel: string | undefined,
    overrideProvider: string | undefined,
  ): AsyncGenerator<[string, string, ChatOpenAI]> {
    for (const [providerName, modelId] of this.modelCandidates(
      overrideModel,
      overrideProvider,
    )) {
      yield [providerName, modelId, await this.getClient(providerName)];
    }
  }

  private async _resolveApiKey(provider: string): Promise<string | undefined> {
    if (typeof this._api_key === "object" && this._api_key !== null) {
      const key = this._api_key[provider];
      if (key !== undefined) {
        return key;
      }
      if (this._api_key_resolver) {
        const resolvedKey = this._api_key_resolver(provider);
        return resolvedKey instanceof Promise ? await resolvedKey : resolvedKey;
      }
      return undefined;
    }
    if (this._api_key !== undefined) {
      return this._api_key;
    }
    if (this._api_key_resolver) {
      const resolvedKey = this._api_key_resolver(provider);
      return resolvedKey instanceof Promise ? await resolvedKey : resolvedKey;
    }
    return undefined;
  }

  private _resolveApiBase(provider: string): string | undefined {
    if (typeof this._api_base === "object" && this._api_base !== null) {
      return this._api_base[provider];
    }
    return this._api_base;
  }

  private _freezeCacheKey(
    provider: string,
    apiKey: string | undefined,
    apiBase: string | undefined,
  ): string {
    const _freeze = (value: any): any => {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
      ) {
        return value;
      }
      if (Array.isArray(value)) {
        return value.map(_freeze);
      }
      if (typeof value === "object" && value !== null) {
        const result: Record<string, any> = {};
        const sortedKeys = Object.keys(value).sort();
        for (const key of sortedKeys) {
          result[key] = _freeze(value[key]);
        }
        return result;
      }
      return String(value);
    };

    const payload = {
      provider,
      api_key: apiKey,
      api_base: apiBase,
      client_args: _freeze(this._client_args),
    };
    return JSON.stringify(payload);
  }

  async getClient(provider: string): Promise<ChatOpenAI> {
    const apiKey = await this._resolveApiKey(provider);
    const apiBase = this._resolveApiBase(provider);
    const cacheKey = this._freezeCacheKey(provider, apiKey, apiBase);

    if (!(cacheKey in this._client_cache)) {
      const client = createLangchainLLMClient({
        provider,
        model: this._model,
        apiKey,
        apiBaseUrl: apiBase,
        configuration: this._client_args,
      });
      this._client_cache[cacheKey] = client;
    }
    return this._client_cache[cacheKey];
  }

  private logError(
    error: RepbulicError,
    provider: string,
    model: string,
    attempt: number,
  ): void {
    if (this._verbose === 0) {
      return;
    }

    const prefix = `[${provider}:${model}] attempt ${attempt + 1}/${this.maxAttempts()}`;
    if (error.cause) {
      console.warn(`${prefix} failed: ${error} (cause=${error.cause})`);
    } else {
      console.warn(`${prefix} failed: ${error}`);
    }
  }

  private static _extractStatusCode(exc: Error): number | undefined {
    const status = (exc as any).status_code;
    if (typeof status === "number") {
      return status;
    }

    const response = (exc as any).response;
    const responseStatus = response?.status_code;
    if (typeof responseStatus === "number") {
      return responseStatus;
    }
    return undefined;
  }

  private static _textMatches(text: string, patterns: string[]): boolean {
    return patterns.some((pattern) => new RegExp(pattern, "i").test(text));
  }

  private _classifyByHttpStatus(exc: Error): ErrorKindType | undefined {
    const status = LLMCore._extractStatusCode(exc);
    if (status === 401 || status === 403) {
      return ErrorKind.CONFIG;
    }
    if ([400, 404, 413, 422].includes(status!)) {
      return ErrorKind.INVALID_INPUT;
    }
    if ([408, 409, 425, 429].includes(status!)) {
      return ErrorKind.TEMPORARY;
    }
    if (status !== undefined && status >= 500 && status < 600) {
      return ErrorKind.PROVIDER;
    }
    return undefined;
  }

  private _classifyByTextSignature(exc: Error): ErrorKindType | undefined {
    const name = exc.constructor.name.toLowerCase();
    const text = `${name} ${exc.message}`.toLowerCase();

    if (
      LLMCore._textMatches(text, [
        "auth|authentication|unauthorized|forbidden|permission denied|access denied",
        "invalid[_\\s-]?api[_\\s-]?key|incorrect api key|api key.*not valid",
      ])
    ) {
      return ErrorKind.CONFIG;
    }

    if (
      LLMCore._textMatches(text, [
        "ratelimit|rate[_\\s-]?limit|too many requests|quota exceeded",
        "\\b429\\b",
      ])
    ) {
      return ErrorKind.TEMPORARY;
    }

    if (
      LLMCore._textMatches(text, [
        "invalid request|bad request|validation|unprocessable",
        "model.*not.*found|does not exist",
        "context.*length|maximum.*context|token limit",
        "unsupported parameter",
      ])
    ) {
      return ErrorKind.INVALID_INPUT;
    }

    if (
      LLMCore._textMatches(text, [
        "timeout|timed out|connection error|network error",
        "internal server|service unavailable|gateway timeout",
      ])
    ) {
      return ErrorKind.PROVIDER;
    }
    return undefined;
  }

  classifyException(exc: Error): ErrorKindType {
    if (exc instanceof RepbulicError) {
      return (exc as any).kind;
    }

    if (this._error_classifier) {
      try {
        const kind = this._error_classifier(exc);
        if (kind) {
          return kind;
        }
      } catch (classifierExc) {
        console.warn("error_classifier failed:", classifierExc);
      }
    }

    const classifiers = [
      this._classifyByHttpStatus.bind(this),
      this._classifyByTextSignature.bind(this),
    ];

    for (const classifier of classifiers) {
      const mapped = classifier(exc);
      if (mapped) {
        return mapped;
      }
    }

    return ErrorKind.UNKNOWN;
  }

  shouldRetry(kind: ErrorKindType): boolean {
    return kind === ErrorKind.TEMPORARY || kind === ErrorKind.PROVIDER;
  }

  wrapError(
    exc: Error,
    kind: ErrorKindType,
    provider: string,
    model: string,
  ): RepbulicError {
    const message = `${provider}:${model}: ${exc}`;
    return new RepbulicError(kind, message, exc);
  }

  private _handleAttemptError(
    exc: Error,
    providerName: string,
    modelId: string,
    attempt: number,
  ): AttemptOutCome {
    let wrapped: RepbulicError;
    let kind: ErrorKindType;

    if (exc instanceof RepbulicError) {
      wrapped = exc;
      kind = (exc as any).kind;
    } else {
      kind = this.classifyException(exc);
      wrapped = this.wrapError(exc, kind, providerName, modelId);
    }

    this.logError(wrapped, providerName, modelId, attempt);

    const canRetrySameModel =
      this.shouldRetry(kind) && attempt + 1 < this.maxAttempts();

    if (canRetrySameModel) {
      return {
        error: wrapped,
        decision: "retry_same_model",
      };
    }

    return {
      error: wrapped,
      decision: "retry_next_model",
    };
  }

  private _decideKwargsForProvider(
    provider: string,
    maxTokens: number | undefined,
    stream: boolean,
    kwargs: Record<string, any>,
  ): Record<string, any> {
    const cleanKwargs = { ...kwargs };
    const maxTokensArg = "max_tokens";
    if (maxTokensArg in cleanKwargs) {
      return { ...cleanKwargs, stream };
    }
    return { ...cleanKwargs, [maxTokensArg]: maxTokens, stream };
  }

  private _decideResponsesKwargs(
    maxTokens: number | undefined,
    stream: boolean,
    kwargs: Record<string, any>,
    dropExtraHeaders: boolean = true,
  ): Record<string, any> {
    const cleanKwargs = { ...kwargs };
    if (dropExtraHeaders) {
      delete cleanKwargs.extra_headers;
    }
    const normalizedKwargs = normalizeResponses_kwargs(cleanKwargs);
    if ("max_output_tokens" in normalizedKwargs || maxTokens === undefined) {
      return { ...normalizedKwargs, stream };
    }
    return { ...normalizedKwargs, max_output_tokens: maxTokens, stream };
  }

  private _withDefaultCompletionStreamOptions(
    providerName: string,
    stream: boolean,
    kwargs: Record<string, any>,
  ): Record<string, any> {
    if (!stream) {
      return kwargs;
    }
    if ("stream_options" in kwargs) {
      return kwargs;
    }
    return { ...kwargs, stream_options: { include_usage: true } };
  }

  private _withResponsesReasoning(
    kwargs: Record<string, any>,
    reasoningEffort: any | undefined,
  ): Record<string, any> {
    if (reasoningEffort === undefined) {
      return kwargs;
    }
    if ("reasoning" in kwargs) {
      return kwargs;
    }
    return { ...kwargs, reasoning: { effort: reasoningEffort } };
  }

  private _convertToolsForResponses(
    toolsPayload: Record<string, any>[] | undefined,
  ): Record<string, any>[] | undefined {
    if (!toolsPayload || toolsPayload.length === 0) {
      return toolsPayload;
    }

    const convertedTools: Record<string, any>[] = [];
    for (const tool of toolsPayload) {
      const func = tool.function;
      if (typeof func === "object" && func !== null) {
        const converted: Record<string, any> = {
          type: tool.type || "function",
          name: func.name,
          description: func.description || "",
          parameters: func.parameters || {},
        };
        if ("strict" in func) {
          converted.strict = func.strict;
        }
        convertedTools.push(converted);
        continue;
      }
      convertedTools.push({ ...tool });
    }
    return convertedTools;
  }

  private _selectedTransport(
    client: ChatOpenAI,
    providerName: string,
    modelId: string,
    toolsPayload: Record<string, any>[] | undefined,
  ): "completion" | "response" | "messages" {
    const forcedTransport = (client as any).PREFERRED_TRANSPORT;
    if (
      forcedTransport === "completion" ||
      forcedTransport === "response" ||
      forcedTransport === "messages"
    ) {
      return forcedTransport;
    }

    if (this._api_format === "completion") {
      return "completion";
    }

    if (this._api_format === "messages") {
      if (!this._supportsMessagesFormat(providerName, modelId)) {
        throw new RepbulicError(
          ErrorKind.INVALID_INPUT,
          `${providerName}:${modelId}: messages format is only valid for Anthropic models`,
        );
      }
      return "messages";
    }

    const reason = this._responsesRejectionReason(
      providerName,
      modelId,
      Boolean(toolsPayload),
      Boolean((client as any).SUPPORTS_RESPONSES),
    );

    if (reason) {
      throw new RepbulicError(
        ErrorKind.INVALID_INPUT,
        `${providerName}:${modelId}: ${reason}`,
      );
    }

    return "response";
  }

  private _supportsMessagesFormat(
    providerName: string,
    modelId: string,
  ): boolean {
    return providerName === "anthropic";
  }

  private _responsesRejectionReason(
    providerName: string,
    modelId: string,
    hasTools: boolean,
    supportsResponses: boolean,
  ): string | undefined {
    if (!supportsResponses) {
      return "responses format is not supported by this client";
    }
    return undefined;
  }

  private _splitMessagesForResponses(
    messages: Record<string, any>[],
  ): [string | undefined, Record<string, any>[]] {
    const instructionsParts: string[] = [];
    const filteredMessages: Record<string, any>[] = [];

    for (const message of messages) {
      const role = message.role;
      if (role === "system" || role === "developer") {
        const content = message.content;
        if (content !== null && content !== "") {
          instructionsParts.push(String(content));
        }
        continue;
      }
      filteredMessages.push(message);
    }

    const instructions = instructionsParts
      .filter((part) => part.trim())
      .join("\n\n");

    return [
      instructions || undefined,
      LLMCore._convertMessagesToResponsesInput(filteredMessages),
    ];
  }

  private static _convertMessagesToResponsesInput(
    messages: Record<string, any>[],
  ): Record<string, any>[] {
    const inputItems: Record<string, any>[] = [];

    for (const message of messages) {
      const role = message.role;
      const content = message.content;

      if (
        (role === "user" || role === "assistant") &&
        content !== null &&
        content !== ""
      ) {
        inputItems.push({
          role,
          content,
          type: "message",
        });
      }

      if (role === "assistant") {
        const toolCalls = message.tool_calls || [];
        for (let index = 0; index < toolCalls.length; index++) {
          const toolCall = toolCalls[index];
          const func = toolCall.function || {};
          const name = func.name;
          if (!name) {
            continue;
          }
          const callId = toolCall.id || toolCall.call_id || `call_${index}`;
          inputItems.push({
            type: "function_call",
            name,
            arguments: func.arguments || "",
            call_id: callId,
          });
        }
      }

      if (role === "tool") {
        const callId = message.tool_call_id || message.call_id;
        if (!callId) {
          continue;
        }
        inputItems.push({
          type: "function_call_output",
          call_id: callId,
          output: message.content || "",
        });
      }
    }

    return inputItems;
  }

  async runChat(
    messagesPayload: Record<string, any>[],
    toolsPayload: Record<string, any>[] | undefined,
    model: string | undefined,
    provider: string | undefined,
    maxTokens: number | undefined,
    stream: boolean,
    reasoningEffort: any | undefined,
    kwargs: Record<string, any>,
  ): Promise<TransportResponse> {
    let lastProvider: string | undefined;
    let lastModel: string | undefined;
    let lastError: RepbulicError | undefined;

    for await (const [providerName, modelId, client] of this.iterClients(
      model,
      provider,
    )) {
      lastProvider = providerName;
      lastModel = modelId;

      for (let attempt = 0; attempt < this.maxAttempts(); attempt++) {
        try {
          const response = await this._callClient(
            client,
            providerName,
            modelId,
            messagesPayload,
            toolsPayload,
            maxTokens,
            stream,
            reasoningEffort,
            kwargs,
          );
          return response;
        } catch (exc) {
          const outcome = this._handleAttemptError(
            exc as Error,
            providerName,
            modelId,
            attempt,
          );
          lastError = outcome.error;

          if (outcome.decision === "retry_same_model") {
            continue;
          }
          break;
        }
      }
    }

    if (lastError) {
      throw lastError;
    }

    if (lastProvider && lastModel) {
      throw new RepbulicError(
        ErrorKind.TEMPORARY,
        `${lastProvider}:${lastModel}: LLM call failed after retries`,
      );
    }

    throw new RepbulicError(
      ErrorKind.UNKNOWN,
      "LLM call failed with unknown error",
    );
  }

  private async _callClient(
    client: ChatOpenAI,
    providerName: string,
    modelId: string,
    messagesPayload: Record<string, any>[],
    toolsPayload: Record<string, any>[] | undefined,
    maxTokens: number | undefined,
    stream: boolean,
    reasoningEffort: any | undefined,
    kwargs: Record<string, any>,
  ): Promise<TransportResponse> {
    const transport = this._selectedTransport(
      client,
      providerName,
      modelId,
      toolsPayload,
    );

    if (transport === "response") {
      return this._callResponses(
        client,
        providerName,
        modelId,
        messagesPayload,
        toolsPayload,
        maxTokens,
        stream,
        reasoningEffort,
        kwargs,
      );
    }

    return this._callCompletionLike(
      transport,
      client,
      providerName,
      modelId,
      messagesPayload,
      toolsPayload,
      maxTokens,
      stream,
      reasoningEffort,
      kwargs,
    );
  }

  private async _callResponses(
    client: ChatOpenAI,
    providerName: string,
    modelId: string,
    messagesPayload: Record<string, any>[],
    toolsPayload: Record<string, any>[] | undefined,
    maxTokens: number | undefined,
    stream: boolean,
    reasoningEffort: any | undefined,
    kwargs: Record<string, any>,
  ): Promise<TransportResponse> {
    const [instructions, inputItems] =
      this._splitMessagesForResponses(messagesPayload);
    const responsesKwargs = this._withResponsesReasoning(
      kwargs,
      reasoningEffort,
    );

    const finalKwargs = this._decideResponsesKwargs(
      maxTokens,
      stream,
      responsesKwargs,
      !this._preservesResponsesExtraHeaders(client),
    );

    const langChainMessages = this._convertToLangChainMessages(messagesPayload);

    const payload = await client.invoke(langChainMessages, {
      tools: this._convertToolsForResponses(toolsPayload),
      ...finalKwargs,
    });

    return {
      transport: "response",
      payload,
    };
  }

  private async _callCompletionLike(
    transport: "completion" | "messages",
    client: ChatOpenAI,
    providerName: string,
    modelId: string,
    messagesPayload: Record<string, any>[],
    toolsPayload: Record<string, any>[] | undefined,
    maxTokens: number | undefined,
    stream: boolean,
    reasoningEffort: any | undefined,
    kwargs: Record<string, any>,
  ): Promise<TransportResponse> {
    let completionKwargs = this._decideKwargsForProvider(
      providerName,
      maxTokens,
      stream,
      kwargs,
    );
    completionKwargs = this._withDefaultCompletionStreamOptions(
      providerName,
      stream,
      completionKwargs,
    );

    const langChainMessages = this._convertToLangChainMessages(messagesPayload);

    const payload = await client.invoke(langChainMessages, {
      tools: toolsPayload,
      reasoningEffort: reasoningEffort,
      ...completionKwargs,
    });

    return {
      transport,
      payload,
    };
  }

  private _preservesResponsesExtraHeaders(client: ChatOpenAI): boolean {
    return Boolean((client as any).PRESERVE_EXTRA_HEADERS_IN_RESPONSES);
  }

  private _convertToLangChainMessages(
    messages: Record<string, any>[],
  ): Array<HumanMessage | SystemMessage | AIMessage | ToolMessage> {
    const langChainMessages: Array<
      HumanMessage | SystemMessage | AIMessage | ToolMessage
    > = [];

    for (const message of messages) {
      const role = message.role;
      const content = message.content;

      switch (role) {
        case "system":
        case "developer":
          langChainMessages.push(new SystemMessage(content));
          break;
        case "user":
          langChainMessages.push(new HumanMessage(content));
          break;
        case "assistant":
          const aiMessage = new AIMessage(content);
          if (message.tool_calls && message.tool_calls.length > 0) {
            (aiMessage as any).tool_calls = message.tool_calls;
          }
          langChainMessages.push(aiMessage);
          break;
        case "tool":
          const toolMessage = new ToolMessage({
            content: content,
            tool_call_id: message.tool_call_id || message.call_id,
          });
          langChainMessages.push(toolMessage);
          break;
      }
    }

    return langChainMessages;
  }
}
