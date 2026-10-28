import {
  AuthenticationError,
  ContextLengthExceededError,
  InvalidRequestError,
  ModelAdapterError,
  ModelNotFoundError,
  ProviderUnavailableError,
  RateLimitError,
  RequestAbortedError,
  UnsupportedCapabilityError,
} from '../errors/model-adapter-error.js';
import type { ModelAdapter } from '../model-adapter.interface.js';
import type {
  AdapterConfig,
  CompletionOptions,
  CompletionRequest,
  CompletionResponse,
  DiscoveredModel,
  DiscoveryOptions,
  FinishReason,
  ModelCapabilities,
  StreamEvent,
  TokenUsage,
} from '../types/index.js';
import type {
  OpenAiChatCompletionChunk,
  OpenAiChatCompletionRequest,
  OpenAiChatCompletionResponse,
  OpenAiErrorBody,
  OpenAiModelsResponse,
  OpenAiWireMessage,
} from './openai.types.js';

/**
 * Standard OpenAI public API base endpoint URL.
 */
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com';

/**
 * Default OpenAI model identifier when omitted from both request and provider configuration.
 */
export const OPENAI_DEFAULT_MODEL = 'gpt-4o';

/**
 * Default outbound request timeout in milliseconds.
 *
 * Local runtimes (LM Studio, vLLM, Ollama) and remote endpoints fail fast within
 * this window if unreachable or unresponsive instead of hanging indefinitely.
 */
export const OPENAI_DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Options for configuring {@link OpenAiAdapter}.
 */
export interface OpenAiAdapterOptions {
  /**
   * Request timeout in milliseconds (defaults to {@link OPENAI_DEFAULT_TIMEOUT_MS}).
   */
  readonly timeoutMs?: number;
}

/**
 * Model adapter for OpenAI's Chat Completions and Models API.
 *
 * Serves three provider kinds:
 * - `openai`: Hosted OpenAI API (defaults to https://api.openai.com).
 * - `openai_compatible`: Generic OpenAI-compatible endpoints (vLLM, LocalAI, OpenRouter, Together).
 * - `lmstudio`: Local LM Studio runtime.
 *
 * ## Base URL Normalisation:
 * Users may supply `base_url` either with or without the `/v1` path segment:
 * - `http://localhost:1234` -> resolves to `http://localhost:1234/v1/chat/completions`
 * - `http://localhost:1234/v1` -> resolves to `http://localhost:1234/v1/chat/completions`
 * - `https://api.openai.com` -> resolves to `https://api.openai.com/v1/chat/completions`
 *
 * ## Credential Privacy:
 * - When configured, the API key is transmitted via `Authorization: Bearer <token>`.
 * - For local runtimes without credentials (`lmstudio`, unauthenticated `openai_compatible`),
 *   no `Authorization` header is emitted.
 * - The API key is strictly redacted from error messages, diagnostics, and stack traces.
 *
 * ## Compatibility & Tolerance:
 * - Treats missing usage in streaming chunks as unknown (`usage: undefined`) rather than zero.
 * - Reports "not supported" cleanly via {@link UnsupportedCapabilityError} when `/models` returns 404.
 * - Handles the non-JSON `data: [DONE]` SSE stream termination sentinel without parse failures.
 * - Fails fast within a configurable timeout when connecting to an unreachable local server.
 */
export class OpenAiAdapter implements ModelAdapter {
  readonly capabilities: ModelCapabilities = {
    supportsStreaming: true,
    supportsDiscovery: true,
    supportsSystemPrompt: true,
    supportsToolCalls: false,
  };

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: AdapterConfig,
    options?: OpenAiAdapterOptions,
  ) {
    const kind = config.providerKind;

    if (
      kind !== 'openai' &&
      (!config.baseUrl || config.baseUrl.trim().length === 0)
    ) {
      throw new InvalidRequestError(
        `Base URL is required for provider kind "${kind}".`,
        kind,
      );
    }

    const rawBaseUrl = (
      config.baseUrl?.trim() || OPENAI_DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    this.baseUrl = rawBaseUrl;
    this.apiKey = config.apiKey?.trim() || undefined;
    this.defaultModel =
      config.modelIdentifier?.trim() ||
      (kind === 'openai' ? OPENAI_DEFAULT_MODEL : 'default');
    this.timeoutMs = options?.timeoutMs ?? OPENAI_DEFAULT_TIMEOUT_MS;
  }

  /**
   * Executes a non-streaming Chat Completions request.
   *
   * @param request - Normalised completion request.
   * @param options - Cancellation signal and additional request headers.
   * @returns Normalised completion response with generated content and token usage.
   */
  async complete(
    request: CompletionRequest,
    options?: CompletionOptions,
  ): Promise<CompletionResponse> {
    const payload = this.buildChatPayload(request, false);
    const url = this.resolveEndpointUrl('/chat/completions');
    const headers = this.buildHeaders(options?.headers);

    const res = await this.executeFetch(
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      },
      options?.signal,
    );

    const data = (await res.json()) as OpenAiChatCompletionResponse;
    const choice = data.choices?.[0];
    const textContent = choice?.message?.content ?? '';
    const reasoningContent = choice?.message?.reasoning_content ?? undefined;
    const finishReason = this.mapFinishReason(choice?.finish_reason);

    const inTok = data.usage?.prompt_tokens ?? 0;
    const outTok = data.usage?.completion_tokens ?? 0;
    const totalTok = data.usage?.total_tokens ?? inTok + outTok;
    const rTok =
      data.usage?.completion_tokens_details?.reasoning_tokens ??
      data.usage?.prompt_tokens_details?.reasoning_tokens;

    const usage: TokenUsage = {
      inputTokens: inTok,
      outputTokens: outTok,
      totalTokens: totalTok,
      ...(rTok !== undefined ? { reasoningTokens: rTok } : {}),
    };

    return {
      content: textContent,
      reasoningContent,
      finishReason,
      usage,
      model: data.model || payload.model,
      raw: data,
    };
  }

  /**
   * Executes a streaming Chat Completions request consuming an SSE stream and yielding structured {@link StreamEvent} objects.
   *
   * @param request - Normalised completion request.
   * @param options - Cancellation signal and additional request headers.
   * @returns Async iterable yielding typed {@link StreamEvent} objects.
   */
  async *stream(
    request: CompletionRequest,
    options?: CompletionOptions,
  ): AsyncIterable<StreamEvent> {
    const payload = this.buildChatPayload(request, true);
    const url = this.resolveEndpointUrl('/chat/completions');
    const headers = this.buildHeaders(options?.headers);

    const res = await this.executeFetch(
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      },
      options?.signal,
    );

    if (!res.body) {
      throw new ProviderUnavailableError(
        'OpenAI streaming response body is empty',
        this.config.providerKind,
      );
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    let model = request.model?.trim() || this.defaultModel;
    let finishReason: FinishReason = 'stop';
    let currentUsage: TokenUsage | undefined = undefined;
    let completed = false;
    let buffer = '';

    try {
      while (true) {
        if (options?.signal?.aborted) {
          throw new RequestAbortedError(
            'OpenAI streaming request was aborted',
            this.config.providerKind,
          );
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';

        const currentDataLines: string[] = [];

        for (const line of lines) {
          if (line.trim().length === 0) {
            if (currentDataLines.length > 0) {
              const dataStr = currentDataLines.join('\n').trim();
              currentDataLines.length = 0;

              const events = this.parseSseData(dataStr, {
                onModel: (m) => {
                  model = m;
                },
                onFinishReason: (r) => {
                  finishReason = r;
                },
                onUsage: (u) => {
                  currentUsage = u;
                },
                onComplete: () => {
                  completed = true;
                },
                getModel: () => model,
                getFinishReason: () => finishReason,
                getUsage: () => currentUsage,
              });

              for (const event of events) {
                yield event;
                if (event.type === 'complete' || event.type === 'error') {
                  return;
                }
              }
            }
          } else if (line.startsWith(':')) {
            // Keep-alive or comment line
            continue;
          } else if (line.startsWith('data:')) {
            currentDataLines.push(line.slice(5).trimStart());
          }
        }
      }

      // Process any trailing lines in buffer
      if (buffer.trim().length > 0) {
        const trailingData = buffer.startsWith('data:')
          ? buffer.slice(5).trimStart()
          : buffer.trim();

        const events = this.parseSseData(trailingData, {
          onModel: (m) => {
            model = m;
          },
          onFinishReason: (r) => {
            finishReason = r;
          },
          onUsage: (u) => {
            currentUsage = u;
          },
          onComplete: () => {
            completed = true;
          },
          getModel: () => model,
          getFinishReason: () => finishReason,
          getUsage: () => currentUsage,
        });

        for (const event of events) {
          yield event;
          if (event.type === 'complete' || event.type === 'error') {
            return;
          }
        }
      }

      // Stream closed without explicit [DONE] sentinel
      if (!completed) {
        yield {
          type: 'complete',
          finishReason,
          usage: currentUsage,
          model,
        };
      }
    } catch (err: unknown) {
      if (err instanceof ModelAdapterError) {
        throw err;
      }
      if (
        options?.signal?.aborted ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        throw new RequestAbortedError(
          'OpenAI streaming request was aborted',
          this.config.providerKind,
        );
      }
      const rawMsg = err instanceof Error ? err.message : String(err);
      throw new ProviderUnavailableError(
        `OpenAI streaming failed: ${this.sanitizeCredentials(rawMsg)}`,
        this.config.providerKind,
      );
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Discovers models available from the provider's `/models` endpoint.
   *
   * @param options - Cancellation signal and query options.
   * @returns List of models in normalised shape.
   * @throws UnsupportedCapabilityError if the server returns 404 (endpoint not supported).
   */
  async discoverModels(options?: DiscoveryOptions): Promise<DiscoveredModel[]> {
    const url = this.resolveEndpointUrl('/models');
    const headers = this.buildHeaders(options?.headers);

    let res: Response;
    try {
      res = await this.executeFetch(
        url,
        {
          method: 'GET',
          headers,
        },
        options?.signal,
      );
    } catch (err: unknown) {
      if (
        err instanceof ModelNotFoundError ||
        err instanceof UnsupportedCapabilityError ||
        (err instanceof ModelAdapterError &&
          (err.statusCode === 404 ||
            err.statusCode === 405 ||
            err.statusCode === 501))
      ) {
        throw new UnsupportedCapabilityError(
          'model discovery',
          this.config.providerKind,
        );
      }
      throw err;
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return [];
    }

    const rawList = Array.isArray((json as OpenAiModelsResponse)?.data)
      ? (json as OpenAiModelsResponse).data!
      : Array.isArray(json)
        ? json
        : [];

    const discoveredModels: DiscoveredModel[] = [];

    for (const item of rawList) {
      if (item?.id && typeof item.id === 'string') {
        const displayName =
          typeof item.name === 'string' && item.name.trim().length > 0
            ? item.name.trim()
            : typeof item.display_name === 'string' &&
                item.display_name.trim().length > 0
              ? item.display_name.trim()
              : item.id;

        const contextWindow =
          typeof item.context_window === 'number'
            ? item.context_window
            : typeof item.context_length === 'number'
              ? item.context_length
              : typeof item.max_context_length === 'number'
                ? item.max_context_length
                : null;

        const defaultTemperature =
          typeof item.default_temperature === 'number'
            ? item.default_temperature
            : null;

        const defaultMaxTokens =
          typeof item.default_max_tokens === 'number'
            ? item.default_max_tokens
            : typeof item.max_tokens === 'number'
              ? item.max_tokens
              : null;

        discoveredModels.push({
          modelIdentifier: item.id,
          displayName,
          contextWindow,
          defaultTemperature,
          defaultMaxTokens,
        });
      }
    }

    return discoveredModels;
  }

  /**
   * Translates a normalised {@link CompletionRequest} into an OpenAI Chat Completions wire payload.
   *
   * System Prompt Translation:
   * OpenAI expects system instructions as a message with `role: 'system'`.
   * When `request.systemPrompt` is provided, it is prepended as the first message in the array.
   */
  buildChatPayload(
    request: CompletionRequest,
    stream: boolean,
  ): OpenAiChatCompletionRequest {
    const wireMessages: OpenAiWireMessage[] = [];

    if (request.systemPrompt && request.systemPrompt.trim().length > 0) {
      wireMessages.push({
        role: 'system',
        content: request.systemPrompt.trim(),
      });
    }

    for (const msg of request.messages) {
      const wireMsg: OpenAiWireMessage = {
        role: msg.role,
        content: msg.content,
      };
      if (msg.name) {
        wireMsg.name = msg.name;
      }
      if (msg.role === 'tool' && msg.toolCallId) {
        wireMsg.tool_call_id = msg.toolCallId;
      }
      wireMessages.push(wireMsg);
    }

    const model = request.model?.trim() || this.defaultModel;

    const payload: OpenAiChatCompletionRequest = {
      model,
      messages: wireMessages,
      stream,
      ...(request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
      ...(request.maxTokens !== undefined
        ? { max_tokens: request.maxTokens }
        : {}),
      ...request.modelParams,
    };

    // For hosted OpenAI, opt into streaming usage tracking unless explicitly overridden in modelParams
    if (
      stream &&
      this.config.providerKind === 'openai' &&
      !payload.stream_options
    ) {
      payload.stream_options = { include_usage: true };
    }

    return payload;
  }

  /**
   * Resolves endpoint paths, normalising `/v1` prefix whether supplied by user or omitted.
   */
  resolveEndpointUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    if (this.baseUrl.endsWith('/v1')) {
      return `${this.baseUrl}${cleanPath}`;
    }
    return `${this.baseUrl}/v1${cleanPath}`;
  }

  /**
   * Constructs outbound request headers.
   *
   * Only includes `Authorization` header when a decrypted API key is configured.
   */
  private buildHeaders(
    customHeaders?: Record<string, string>,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...customHeaders,
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  /**
   * Safely executes an HTTP fetch request applying connection timeout and cancellation.
   */
  private async executeFetch(
    url: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (signal) {
      if (signal.aborted) {
        throw new RequestAbortedError(
          'Request to OpenAI was aborted',
          this.config.providerKind,
        );
      }
      signal.addEventListener(
        'abort',
        () => {
          controller.abort();
        },
        { once: true },
      );
    }

    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }

      if (!res.ok) {
        await this.handleErrorResponse(res);
      }

      return res;
    } catch (err: unknown) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }

      if (err instanceof ModelAdapterError) {
        throw err;
      }

      if (timedOut) {
        throw new ProviderUnavailableError(
          `Request to OpenAI timed out after ${this.timeoutMs}ms`,
          this.config.providerKind,
        );
      }

      if (
        signal?.aborted ||
        (err instanceof Error &&
          err.name === 'AbortError' &&
          !timedOut &&
          signal?.aborted)
      ) {
        throw new RequestAbortedError(
          'Request to OpenAI was aborted',
          this.config.providerKind,
        );
      }

      const rawMsg = err instanceof Error ? err.message : String(err);
      const safeMsg = this.sanitizeCredentials(rawMsg);

      throw new ProviderUnavailableError(
        `Failed to reach OpenAI: ${safeMsg}`,
        this.config.providerKind,
      );
    }
  }

  /**
   * Translates HTTP error responses into normalised {@link ModelAdapterError} subclasses.
   */
  private async handleErrorResponse(res: Response): Promise<never> {
    let upstreamMessage = `HTTP ${res.status}`;
    let upstreamType = '';
    let upstreamCode = '';

    try {
      const body = (await res.json()) as OpenAiErrorBody;
      if (body?.error?.message) {
        upstreamMessage = body.error.message;
      } else if (typeof body?.message === 'string') {
        upstreamMessage = body.message;
      }
      if (body?.error?.type) {
        upstreamType = body.error.type;
      }
      if (body?.error?.code !== undefined && body?.error?.code !== null) {
        upstreamCode = String(body.error.code);
      }
    } catch {
      // Body not JSON or unreadable
    }

    throw this.mapErrorByTypeAndStatus(
      upstreamType,
      upstreamCode,
      upstreamMessage,
      res.status,
    );
  }

  /**
   * Maps error response metadata to typed {@link ModelAdapterError} instances.
   */
  private mapErrorByTypeAndStatus(
    upstreamType: string,
    upstreamCode: string,
    upstreamMessage: string,
    status: number,
  ): ModelAdapterError {
    const safeMessage = this.sanitizeCredentials(upstreamMessage);
    const kind = this.config.providerKind;

    if (
      status === 401 ||
      status === 403 ||
      upstreamCode === 'invalid_api_key' ||
      upstreamType === 'invalid_auth'
    ) {
      return new AuthenticationError(
        `OpenAI authentication failed: ${safeMessage}`,
        kind,
      );
    }

    if (
      status === 404 ||
      upstreamCode === 'model_not_found' ||
      safeMessage.includes('does not exist')
    ) {
      return new ModelNotFoundError(this.defaultModel, kind);
    }

    if (
      status === 429 ||
      upstreamCode === 'insufficient_quota' ||
      upstreamCode === 'rate_limit_exceeded' ||
      upstreamType === 'insufficient_quota'
    ) {
      return new RateLimitError(
        `OpenAI rate limit exceeded: ${safeMessage}`,
        kind,
      );
    }

    if (status === 400 || upstreamType === 'invalid_request_error') {
      if (
        upstreamCode === 'context_length_exceeded' ||
        safeMessage.toLowerCase().includes('maximum context length') ||
        safeMessage.toLowerCase().includes('context length') ||
        safeMessage.toLowerCase().includes('too long')
      ) {
        return new ContextLengthExceededError(safeMessage, kind);
      }
      return new InvalidRequestError(
        `OpenAI rejected request: ${safeMessage}`,
        kind,
      );
    }

    if (status === 405 || status === 501) {
      return new UnsupportedCapabilityError(
        `OpenAI endpoint not supported (HTTP ${status}): ${safeMessage}`,
        kind,
      );
    }

    if (status === 500 || status === 502 || status === 503 || status === 504) {
      return new ProviderUnavailableError(
        `OpenAI service unavailable (HTTP ${status}): ${safeMessage}`,
        kind,
      );
    }

    return new ProviderUnavailableError(
      `OpenAI error (HTTP ${status}): ${safeMessage}`,
      kind,
    );
  }

  /**
   * Parses SSE data string and yields corresponding {@link StreamEvent} objects.
   */
  private parseSseData(
    dataStr: string,
    ctx: {
      onModel: (model: string) => void;
      onFinishReason: (reason: FinishReason) => void;
      onUsage: (usage: TokenUsage) => void;
      onComplete: () => void;
      getModel: () => string;
      getFinishReason: () => FinishReason;
      getUsage: () => TokenUsage | undefined;
    },
  ): StreamEvent[] {
    const trimmed = dataStr.trim();
    if (!trimmed) {
      return [];
    }

    // Handled explicitly before JSON parsing to avoid syntax error
    if (trimmed === '[DONE]') {
      ctx.onComplete();
      return [
        {
          type: 'complete',
          finishReason: ctx.getFinishReason(),
          usage: ctx.getUsage(),
          model: ctx.getModel(),
        },
      ];
    }

    let parsed: OpenAiChatCompletionChunk;
    try {
      parsed = JSON.parse(trimmed) as OpenAiChatCompletionChunk;
    } catch {
      // Non-JSON or corrupt SSE chunk; ignore defensively
      return [];
    }

    const events: StreamEvent[] = [];

    if (parsed.error) {
      const errType = parsed.error.type || 'error';
      const errCode = parsed.error.code ? String(parsed.error.code) : '';
      const errMsg = parsed.error.message || 'Streaming error';
      const mappedError = this.mapErrorByTypeAndStatus(
        errType,
        errCode,
        errMsg,
        500,
      );
      events.push({
        type: 'error',
        error: mappedError,
      });
      return events;
    }

    if (parsed.model) {
      ctx.onModel(parsed.model);
    }

    if (parsed.usage) {
      const inTok = parsed.usage.prompt_tokens ?? 0;
      const outTok = parsed.usage.completion_tokens ?? 0;
      const totTok = parsed.usage.total_tokens ?? inTok + outTok;
      const rTok =
        parsed.usage.completion_tokens_details?.reasoning_tokens ??
        parsed.usage.prompt_tokens_details?.reasoning_tokens;

      const usage: TokenUsage = {
        inputTokens: inTok,
        outputTokens: outTok,
        totalTokens: totTok,
        ...(rTok !== undefined ? { reasoningTokens: rTok } : {}),
      };

      ctx.onUsage(usage);
      events.push({
        type: 'usage',
        usage,
      });
    }

    for (const choice of parsed.choices ?? []) {
      if (choice.delta?.content) {
        events.push({
          type: 'text-delta',
          delta: choice.delta.content,
        });
      }

      if (choice.delta?.reasoning_content) {
        events.push({
          type: 'thought-delta',
          delta: choice.delta.reasoning_content,
        });
      }

      if (choice.finish_reason) {
        ctx.onFinishReason(this.mapFinishReason(choice.finish_reason));
      }
    }

    return events;
  }

  /**
   * Sanitizes decrypted credentials from error messages and logs.
   */
  private sanitizeCredentials(message: string): string {
    if (!this.apiKey || this.apiKey.length === 0) {
      return message;
    }
    return message.replaceAll(this.apiKey, '[REDACTED_API_KEY]');
  }

  /**
   * Maps OpenAI finish reasons to normalised {@link FinishReason}.
   */
  private mapFinishReason(reason?: string | null): FinishReason {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
      case 'function_call':
        return 'tool_calls';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'other';
    }
  }
}
