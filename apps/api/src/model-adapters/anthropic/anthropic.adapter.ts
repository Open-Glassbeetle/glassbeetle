import {
  AuthenticationError,
  ContextLengthExceededError,
  InvalidRequestError,
  ModelAdapterError,
  ModelNotFoundError,
  ProviderUnavailableError,
  RateLimitError,
  RequestAbortedError,
} from '../errors/model-adapter-error.js';
import type { ModelAdapter } from '../model-adapter.interface.js';
import type {
  AdapterConfig,
  AdapterMessage,
  CompletionOptions,
  CompletionRequest,
  CompletionResponse,
  DiscoveredModel,
  DiscoveryOptions,
  FinishReason,
  ModelCapabilities,
  StreamEvent,
} from '../types/index.js';
import type {
  AnthropicContentBlock,
  AnthropicErrorBody,
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicModelsResponse,
  AnthropicWireMessage,
} from './anthropic.types.js';

/**
 * Standard Anthropic API base endpoint URL.
 */
export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';

/**
 * Anthropic API protocol version header.
 */
export const ANTHROPIC_API_VERSION = '2023-06-01';

/**
 * Documented fallback for `max_tokens` when omitted by both the caller and the model configuration.
 *
 * The Anthropic Messages API strictly requires `max_tokens`. 4096 is supported by all Claude 3 and 3.5
 * models (Haiku, Sonnet, Opus) and provides a generous token budget without risking schema rejection.
 */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096;

/**
 * Default Claude model identifier when omitted from both request and provider configuration.
 */
export const ANTHROPIC_DEFAULT_MODEL = 'claude-3-5-sonnet-20241022';

/**
 * Model adapter for Anthropic's Messages and Models API.
 *
 * ## Capabilities:
 * - Translates normalised completion requests into Anthropic Messages API wire payloads.
 * - Extracts and hoists top-level system prompts and conversation system-role messages.
 * - Merges consecutive same-role turns into single turns to satisfy Anthropic turn alternation rules.
 * - Enforces `max_tokens` fallback when unspecified (`ANTHROPIC_DEFAULT_MAX_TOKENS = 4096`).
 * - Maps HTTP and upstream error codes into normalised {@link ModelAdapterError} classes.
 * - Strictly prevents API key and credential leaks across logs and errors.
 */
export class AnthropicAdapter implements ModelAdapter {
  readonly capabilities: ModelCapabilities = {
    supportsStreaming: true,
    supportsDiscovery: true,
    supportsSystemPrompt: true,
    supportsToolCalls: false,
  };

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultModel: string;

  constructor(private readonly config: AdapterConfig) {
    this.baseUrl = (config.baseUrl?.trim() || ANTHROPIC_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.defaultModel = config.modelIdentifier || ANTHROPIC_DEFAULT_MODEL;
  }

  /**
   * Executes a non-streaming completion using the Anthropic Messages API.
   *
   * @param request - Normalised completion request.
   * @param options - Cancellation signal and additional request headers.
   * @returns Normalised completion response with generated content and token usage.
   */
  async complete(
    request: CompletionRequest,
    options?: CompletionOptions,
  ): Promise<CompletionResponse> {
    const payload = this.buildMessagesPayload(request, false);
    const url = this.resolveEndpointUrl('/messages');
    const headers = this.buildHeaders(options?.headers);

    const res = await this.executeFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: options?.signal,
    });

    const data = (await res.json()) as AnthropicMessagesResponse;

    const textContent = this.extractTextContent(data.content);
    const reasoningContent = this.extractReasoningContent(data.content);

    return {
      content: textContent,
      reasoningContent,
      finishReason: this.mapFinishReason(data.stop_reason),
      usage: {
        inputTokens: data.usage.input_tokens ?? 0,
        outputTokens: data.usage.output_tokens ?? 0,
        totalTokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
      },
      model: data.model || payload.model,
      raw: data,
    };
  }

  /**
   * Executes a streaming completion consuming Anthropic's SSE stream and yielding structured {@link StreamEvent} objects.
   *
   * @param request - Normalised completion request.
   * @param options - Cancellation signal and additional request headers.
   * @returns Async iterable yielding typed {@link StreamEvent} objects.
   */
  async *stream(
    request: CompletionRequest,
    options?: CompletionOptions,
  ): AsyncIterable<StreamEvent> {
    const payload = this.buildMessagesPayload(request, true);
    const url = this.resolveEndpointUrl('/messages');
    const headers = this.buildHeaders(options?.headers);

    const res = await this.executeFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: options?.signal,
    });

    if (!res.body) {
      throw new ProviderUnavailableError(
        'Anthropic streaming response body is empty',
        'anthropic',
      );
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    let model = request.model?.trim() || this.defaultModel;
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: FinishReason = 'stop';
    let completed = false;

    let buffer = '';

    try {
      while (true) {
        if (options?.signal?.aborted) {
          throw new RequestAbortedError(
            'Anthropic streaming request was aborted',
            'anthropic',
          );
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';

        let currentEvent = '';
        const currentDataLines: string[] = [];

        for (const line of lines) {
          if (line.trim().length === 0) {
            if (currentDataLines.length > 0 || currentEvent.length > 0) {
              const dataStr = currentDataLines.join('\n');
              const events = this.parseSseEvent(dataStr, currentEvent, {
                onModel: (m) => {
                  model = m;
                },
                onFinishReason: (r) => {
                  finishReason = r;
                },
                onUsage: (inTok, outTok) => {
                  if (inTok !== undefined) inputTokens = inTok;
                  if (outTok !== undefined) outputTokens = outTok;
                },
                onComplete: () => {
                  completed = true;
                },
                getUsage: () => ({
                  inputTokens,
                  outputTokens,
                  totalTokens: inputTokens + outputTokens,
                }),
                getModel: () => model,
                getFinishReason: () => finishReason,
              });

              for (const event of events) {
                yield event;
              }

              currentEvent = '';
              currentDataLines.length = 0;
            }
          } else if (line.startsWith(':')) {
            // Ping / comment
            continue;
          } else if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            currentDataLines.push(line.slice(5).trimStart());
          }
        }
      }

      // Process any trailing line in buffer
      if (buffer.trim().length > 0) {
        const events = this.parseSseEvent(buffer, '', {
          onModel: (m) => {
            model = m;
          },
          onFinishReason: (r) => {
            finishReason = r;
          },
          onUsage: (inTok, outTok) => {
            if (inTok !== undefined) inputTokens = inTok;
            if (outTok !== undefined) outputTokens = outTok;
          },
          onComplete: () => {
            completed = true;
          },
          getUsage: () => ({
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
          }),
          getModel: () => model,
          getFinishReason: () => finishReason,
        });

        for (const event of events) {
          yield event;
        }
      }

      // Final complete event if stream closed without explicit message_stop
      if (!completed) {
        yield {
          type: 'complete',
          finishReason,
          usage: {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
          },
          model,
        };
      }
    } catch (err: unknown) {
      if (err instanceof ModelAdapterError) {
        throw err;
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw new RequestAbortedError(
          'Anthropic streaming request was aborted',
          'anthropic',
        );
      }
      const rawMsg = err instanceof Error ? err.message : String(err);
      throw new ProviderUnavailableError(
        `Anthropic streaming failed: ${this.sanitizeCredentials(rawMsg)}`,
        'anthropic',
      );
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Discovers models available from Anthropic's `/v1/models` endpoint.
   *
   * Maps upstream models into normalised {@link DiscoveredModel} instances, extracting
   * context window and token limit properties where reported.
   *
   * @param options - Cancellation signal and query options.
   * @returns List of models in normalised shape.
   */
  async discoverModels(options?: DiscoveryOptions): Promise<DiscoveredModel[]> {
    const headers = this.buildHeaders(options?.headers);
    const discoveredModels: DiscoveredModel[] = [];
    let afterId: string | null | undefined = undefined;
    let pageCount = 0;
    const maxPages = 10;

    do {
      const endpoint = this.resolveEndpointUrl('/models');
      const url = new URL(endpoint);
      url.searchParams.set('limit', '100');
      if (afterId) {
        url.searchParams.set('after_id', afterId);
      }

      const res = await this.executeFetch(url.toString(), {
        method: 'GET',
        headers,
        signal: options?.signal,
      });

      const json = (await res.json()) as AnthropicModelsResponse;
      const items = json.data ?? [];

      for (const item of items) {
        if (item?.id) {
          discoveredModels.push({
            modelIdentifier: item.id,
            displayName: item.display_name || item.id,
            contextWindow:
              typeof item.context_window === 'number' ? item.context_window : null,
            defaultTemperature:
              typeof item.default_temperature === 'number'
                ? item.default_temperature
                : null,
            defaultMaxTokens:
              typeof item.max_tokens === 'number'
                ? item.max_tokens
                : typeof item.default_max_tokens === 'number'
                  ? item.default_max_tokens
                  : null,
          });
        }
      }

      if (json.has_more && json.last_id && pageCount < maxPages) {
        afterId = json.last_id;
        pageCount++;
      } else {
        break;
      }
    } while (afterId);

    return discoveredModels;
  }

  /**
   * Translates a normalised {@link CompletionRequest} into the Anthropic wire payload.
   *
   * Handles:
   * 1. System prompt hoisting (from `request.systemPrompt` and any `role === 'system'` messages).
   * 2. Turn alternation & consecutive same-role merging (e.g. multi-agent team responses).
   * 3. Fallback `max_tokens` when omitted.
   * 4. Opaque pass-through of `request.modelParams`.
   */
  buildMessagesPayload(
    request: CompletionRequest,
    stream: boolean,
  ): AnthropicMessagesRequest {
    const { systemPrompt, wireMessages } = this.translateMessages(request);

    const model = request.model?.trim() || this.defaultModel;
    const maxTokens = request.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS;

    const payload: AnthropicMessagesRequest = {
      model,
      messages: wireMessages,
      max_tokens: maxTokens,
      stream,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.modelParams),
    };

    if (systemPrompt) {
      payload.system = systemPrompt;
    }

    return payload;
  }

  /**
   * Normalises conversation history for Anthropic:
   * - Hoists any `role === 'system'` messages alongside `request.systemPrompt`.
   * - Converts `role === 'tool'` messages to user turns (if any).
   * - Merges consecutive same-role messages by joining formatted contents with `\n\n`.
   * - Prepends an introductory user turn if conversation begins with an assistant turn.
   */
  private translateMessages(request: CompletionRequest): {
    systemPrompt?: string;
    wireMessages: AnthropicWireMessage[];
  } {
    const systemParts: string[] = [];

    if (request.systemPrompt && request.systemPrompt.trim().length > 0) {
      systemParts.push(request.systemPrompt.trim());
    }

    // Filter system messages and hoist their contents
    const nonSystemMessages: AdapterMessage[] = [];
    for (const msg of request.messages) {
      if (msg.role === 'system') {
        if (msg.content.trim().length > 0) {
          systemParts.push(msg.content.trim());
        }
      } else {
        nonSystemMessages.push(msg);
      }
    }

    const systemPrompt = systemParts.length > 0 ? systemParts.join('\n\n') : undefined;

    if (nonSystemMessages.length === 0) {
      return {
        systemPrompt,
        wireMessages: [{ role: 'user', content: ' ' }],
      };
    }

    // Merge consecutive same-role messages
    const wireMessages: AnthropicWireMessage[] = [];

    for (const msg of nonSystemMessages) {
      // Map tool messages to user role for turn alternation
      const role: 'user' | 'assistant' = msg.role === 'assistant' ? 'assistant' : 'user';
      const formattedContent = msg.name ? `${msg.name}: ${msg.content}` : msg.content;

      const previous = wireMessages[wireMessages.length - 1];

      if (previous && previous.role === role) {
        // Merge consecutive same-role turn
        if (typeof previous.content === 'string') {
          previous.content = `${previous.content}\n\n${formattedContent}`;
        }
      } else {
        wireMessages.push({
          role,
          content: formattedContent,
        });
      }
    }

    // Anthropic requires the first message to have role 'user'
    if (wireMessages.length > 0 && wireMessages[0].role === 'assistant') {
      wireMessages.unshift({ role: 'user', content: ' ' });
    }

    return {
      systemPrompt,
      wireMessages,
    };
  }

  /**
   * Resolves endpoint URLs, supporting both standard Anthropic endpoints and custom gateways.
   */
  private resolveEndpointUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    if (this.baseUrl.endsWith('/v1')) {
      return `${this.baseUrl}${cleanPath}`;
    }
    return `${this.baseUrl}/v1${cleanPath}`;
  }

  /**
   * Constructs request headers, including mandatory `anthropic-version` and authentication.
   */
  private buildHeaders(customHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': ANTHROPIC_API_VERSION,
      ...(customHeaders),
    };

    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    return headers;
  }

  /**
   * Safely executes an HTTP request, ensuring API keys are never leaked upon failure.
   */
  private async executeFetch(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    try {
      const res = await fetch(url, init);

      if (!res.ok) {
        await this.handleErrorResponse(res);
      }

      return res;
    } catch (err: unknown) {
      if (err instanceof ModelAdapterError) {
        throw err;
      }

      if (err instanceof Error && err.name === 'AbortError') {
        throw new RequestAbortedError('Request to Anthropic was aborted', 'anthropic');
      }

      const rawMsg = err instanceof Error ? err.message : String(err);
      const safeMsg = this.sanitizeCredentials(rawMsg);

      throw new ProviderUnavailableError(
        `Failed to reach Anthropic: ${safeMsg}`,
        'anthropic',
      );
    }
  }

  /**
   * Translates HTTP error responses into normalised {@link ModelAdapterError} subclasses.
   */
  private async handleErrorResponse(res: Response): Promise<never> {
    let upstreamMessage = `HTTP ${res.status}`;
    let upstreamType = '';

    try {
      const body = (await res.json()) as AnthropicErrorBody;
      if (body?.error?.message) {
        upstreamMessage = body.error.message;
      }
      if (body?.error?.type) {
        upstreamType = body.error.type;
      }
    } catch {
      // Body not JSON or unreadable
    }

    throw this.mapErrorByTypeAndStatus(upstreamType, upstreamMessage, res.status);
  }

  /**
   * Normalises Anthropic error codes into typed {@link ModelAdapterError} instances.
   */
  private mapErrorByTypeAndStatus(
    upstreamType: string,
    upstreamMessage: string,
    status: number,
  ): ModelAdapterError {
    const safeMessage = this.sanitizeCredentials(upstreamMessage);

    if (status === 401 || status === 403 || upstreamType === 'authentication_error') {
      return new AuthenticationError(
        `Anthropic authentication failed: ${safeMessage}`,
        'anthropic',
      );
    }

    if (status === 404 || upstreamType === 'not_found_error') {
      return new ModelNotFoundError(this.defaultModel, 'anthropic');
    }

    if (status === 429 || upstreamType === 'rate_limit_error') {
      return new RateLimitError(
        `Anthropic rate limit exceeded: ${safeMessage}`,
        'anthropic',
      );
    }

    if (status === 400 || upstreamType === 'invalid_request_error') {
      if (
        safeMessage.toLowerCase().includes('prompt is too long') ||
        safeMessage.toLowerCase().includes('context') ||
        safeMessage.toLowerCase().includes('maximum context length')
      ) {
        return new ContextLengthExceededError(safeMessage, 'anthropic');
      }
      return new InvalidRequestError(
        `Anthropic rejected request: ${safeMessage}`,
        'anthropic',
      );
    }

    if (status === 529 || upstreamType === 'overloaded_error') {
      return new ProviderUnavailableError(
        `Anthropic is currently overloaded (529): ${safeMessage}`,
        'anthropic',
      );
    }

    if (status === 500 || status === 502 || status === 503 || status === 504) {
      return new ProviderUnavailableError(
        `Anthropic service unavailable (HTTP ${status}): ${safeMessage}`,
        'anthropic',
      );
    }

    return new ProviderUnavailableError(
      `Anthropic error (HTTP ${status}): ${safeMessage}`,
      'anthropic',
    );
  }

  /**
   * Processes a single parsed SSE event block and emits corresponding normalised {@link StreamEvent}s.
   */
  private parseSseEvent(
    dataStr: string,
    eventName: string,
    ctx: {
      onModel: (model: string) => void;
      onFinishReason: (reason: FinishReason) => void;
      onUsage: (inputTokens?: number, outputTokens?: number) => void;
      onComplete: () => void;
      getUsage: () => { inputTokens: number; outputTokens: number; totalTokens: number };
      getModel: () => string;
      getFinishReason: () => FinishReason;
    },
  ): StreamEvent[] {
    const trimmed = dataStr.trim();
    if (!trimmed || trimmed === '[DONE]') {
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
      return [];
    }

    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Non-JSON SSE payload (e.g. keep-alive or ping)
      return [];
    }

    const type = eventName || parsed.type;
    const events: StreamEvent[] = [];

    switch (type) {
      case 'message_start': {
        if (parsed.message?.model) {
          ctx.onModel(parsed.message.model);
        }
        if (parsed.message?.usage) {
          const inTok = parsed.message.usage.input_tokens ?? 0;
          const outTok = parsed.message.usage.output_tokens ?? 0;
          ctx.onUsage(inTok, outTok);
          events.push({
            type: 'usage',
            usage: ctx.getUsage(),
          });
        }
        break;
      }

      case 'content_block_delta': {
        const delta = parsed.delta;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          events.push({
            type: 'text-delta',
            delta: delta.text,
          });
        } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          events.push({
            type: 'thought-delta',
            delta: delta.thinking,
          });
        }
        break;
      }

      case 'message_delta': {
        if (parsed.delta?.stop_reason) {
          ctx.onFinishReason(this.mapFinishReason(parsed.delta.stop_reason));
        }
        if (parsed.usage?.output_tokens !== undefined) {
          ctx.onUsage(undefined, parsed.usage.output_tokens);
          events.push({
            type: 'usage',
            usage: ctx.getUsage(),
          });
        }
        break;
      }

      case 'message_stop': {
        ctx.onComplete();
        events.push({
          type: 'complete',
          finishReason: ctx.getFinishReason(),
          usage: ctx.getUsage(),
          model: ctx.getModel(),
        });
        break;
      }

      case 'error': {
        const errType = parsed.error?.type || 'error';
        const errMsg = parsed.error?.message || 'Streaming error';
        const mappedError = this.mapErrorByTypeAndStatus(errType, errMsg, 500);
        events.push({
          type: 'error',
          error: mappedError,
        });
        break;
      }

      case 'ping':
      case 'content_block_start':
      case 'content_block_stop':
      default:
        // Internal control events; no StreamEvent emitted
        break;
    }

    return events;
  }

  /**
   * Sanitizes any occurrences of the decrypted API key from error strings or logs.
   */
  private sanitizeCredentials(message: string): string {
    if (!this.apiKey || this.apiKey.length === 0) {
      return message;
    }
    return message.replaceAll(this.apiKey, '[REDACTED_API_KEY]');
  }

  /**
   * Extracts text content from Anthropic content blocks.
   */
  private extractTextContent(blocks: AnthropicContentBlock[]): string {
    return blocks
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }

  /**
   * Extracts thinking / chain-of-thought content from Anthropic content blocks (if any).
   */
  private extractReasoningContent(blocks: AnthropicContentBlock[]): string | undefined {
    const thinkingBlocks = blocks
      .filter((b): b is { type: 'thinking'; thinking: string } => b.type === 'thinking')
      .map((b) => b.thinking);

    return thinkingBlocks.length > 0 ? thinkingBlocks.join('') : undefined;
  }

  /**
   * Maps Anthropic stop reason to normalised {@link FinishReason}.
   */
  private mapFinishReason(stopReason?: string | null): FinishReason {
    switch (stopReason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      default:
        return 'other';
    }
  }
}
