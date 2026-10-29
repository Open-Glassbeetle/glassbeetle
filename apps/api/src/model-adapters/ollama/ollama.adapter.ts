import {
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
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaTagsResponse,
  OllamaWireMessage,
} from './ollama.types.js';

/**
 * Standard Ollama local runtime base endpoint URL.
 */
export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434';

/**
 * Default Ollama model identifier when omitted from request and provider configuration.
 */
export const OLLAMA_DEFAULT_MODEL = 'llama3.2';

/**
 * Fast connection timeout in milliseconds.
 *
 * Local runtimes fail fast within this window if the server process is not running,
 * preventing long connection hangs while distinguishing server reachability from slow generation.
 */
export const OLLAMA_DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

/**
 * Generous generation timeout in milliseconds (5 minutes).
 *
 * Accommodates large local models running on CPU or low-end hardware that may require
 * significant time to load model weights into VRAM and produce initial tokens.
 */
export const OLLAMA_DEFAULT_GENERATION_TIMEOUT_MS = 300_000;

/**
 * Options for configuring {@link OllamaAdapter}.
 */
export interface OllamaAdapterOptions {
  /**
   * Fast connection timeout in milliseconds (defaults to {@link OLLAMA_DEFAULT_CONNECT_TIMEOUT_MS}).
   * Fails fast if Ollama server is not running on localhost/network.
   */
  readonly connectTimeoutMs?: number;

  /**
   * Generous generation timeout in milliseconds (defaults to {@link OLLAMA_DEFAULT_GENERATION_TIMEOUT_MS}).
   * Accommodates heavy local model inference and weight loading. Set to 0 to disable.
   */
  readonly generationTimeoutMs?: number;

  /**
   * Optional logger instance for request auditing.
   */
  readonly logger?: {
    debug?: (message: string) => void;
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  };
}

/**
 * Model adapter for Ollama, the local AI model runtime.
 *
 * Registered for `providers.kind = 'ollama'`.
 *
 * ## Architectural Highlights & Local Runtime Considerations:
 * 1. **Zero Credential Dependency**:
 *    - Ollama requires no API key or remote authentication.
 *    - The adapter operates fully without credentials without logging warnings or errors.
 *    - If an API key is provided (e.g. reverse proxy authentication), it is forwarded
 *      as an `Authorization: Bearer <key>` header.
 *
 * 2. **Financial Cost Accounting (`cost_usd`)**:
 *    - Local inference has zero marginal financial cost per token since computation executes
 *      entirely on local hardware.
 *    - In downstream usage event accounting (`usage_events.cost_usd`), this provider
 *      is evaluated to `0.0` (zero) rather than `null`, explicitly documenting that inference
 *      occurred with zero financial expenditure.
 *
 * 3. **Timeout Architecture (Connect vs Generation)**:
 *    - Separates fast connect timeout (5s default) from generous generation timeout (300s default).
 *    - Connect timeout fails fast if Ollama is not running on localhost.
 *    - Connect timeout is immediately cleared once response headers arrive, ensuring slow local
 *      CPU models are not cut off prematurely during token generation.
 *
 * 4. **Actionable Local Error Mapping**:
 *    - Connection refused $\to$ Explains Ollama is not running at the target URL and advises starting it.
 *    - Model not found (404) $\to$ Names the missing model tag and advises running `ollama pull <model>`.
 *    - Model loading $\to$ Explains that model weights are loading into memory.
 *
 * 5. **Newline-Delimited JSON Streaming**:
 *    - Parses Ollama's raw NDJSON stream (one JSON object per line).
 *    - Safely buffers partial JSON chunks arriving across TCP packet boundaries.
 *    - Extracts token counts from the terminating object (`done: true`), reporting absent
 *      counts as unknown (`usage: undefined`) rather than zero.
 *
 * 6. **Model Tags & Discovery**:
 *    - Preserves model tags verbatim (e.g. `qwen2.5:14b`).
 *    - Queries `GET /api/tags` to list installed local models.
 */
export class OllamaAdapter implements ModelAdapter {
  readonly capabilities: ModelCapabilities = {
    supportsStreaming: true,
    supportsDiscovery: true,
    supportsSystemPrompt: true,
    supportsToolCalls: false,
  };

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultModel: string;
  private readonly connectTimeoutMs: number;
  private readonly generationTimeoutMs: number;
  private readonly logger?: OllamaAdapterOptions['logger'];

  constructor(
    private readonly config: AdapterConfig,
    options?: OllamaAdapterOptions,
  ) {
    const rawBaseUrl = (config.baseUrl?.trim() || OLLAMA_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.baseUrl = rawBaseUrl;
    this.apiKey = config.apiKey?.trim() || undefined;
    this.defaultModel = config.modelIdentifier?.trim() || OLLAMA_DEFAULT_MODEL;
    this.connectTimeoutMs = options?.connectTimeoutMs ?? OLLAMA_DEFAULT_CONNECT_TIMEOUT_MS;
    this.generationTimeoutMs =
      options?.generationTimeoutMs ?? OLLAMA_DEFAULT_GENERATION_TIMEOUT_MS;
    this.logger = options?.logger;
  }

  /**
   * Executes a non-streaming chat completion using Ollama's native `/api/chat` endpoint.
   *
   * @param request - Normalised completion request.
   * @param options - Cancellation signal and additional request headers.
   * @returns Normalised completion response with generated content and token counts.
   */
  async complete(
    request: CompletionRequest,
    options?: CompletionOptions,
  ): Promise<CompletionResponse> {
    const payload = this.buildChatPayload(request, false);
    const targetModel = payload.model;
    const url = `${this.baseUrl}/api/chat`;
    const headers = this.buildHeaders(options?.headers);

    this.logDebug(`Executing Ollama complete for model "${targetModel}" at ${url}`);

    const res = await this.executeFetch(
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      },
      options?.signal,
      targetModel,
    );

    const data = (await res.json()) as OllamaChatResponse;

    if (data.error) {
      throw this.mapError(res.status, data.error, targetModel);
    }

    const textContent = data.message?.content ?? '';
    const reasoningContent =
      data.message?.thinking || data.message?.reasoning_content || undefined;

    const inTok = data.prompt_eval_count ?? 0;
    const outTok = data.eval_count ?? 0;
    const totalTok = inTok + outTok;

    return {
      content: textContent,
      reasoningContent,
      finishReason: this.mapDoneReason(data.done_reason),
      usage: {
        inputTokens: inTok,
        outputTokens: outTok,
        totalTokens: totalTok,
      },
      model: data.model || targetModel,
      raw: data,
    };
  }

  /**
   * Executes a streaming chat completion consuming Ollama's newline-delimited JSON stream.
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
    const targetModel = payload.model;
    const url = `${this.baseUrl}/api/chat`;
    const headers = this.buildHeaders(options?.headers);

    this.logDebug(`Executing Ollama stream for model "${targetModel}" at ${url}`);

    const res = await this.executeFetch(
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      },
      options?.signal,
      targetModel,
    );

    if (!res.body) {
      throw new ProviderUnavailableError(
        `Ollama streaming response body is empty from ${this.baseUrl}`,
        'ollama',
      );
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    let model = targetModel;
    let finishReason: FinishReason = 'stop';
    let currentUsage: TokenUsage | undefined = undefined;
    let completed = false;
    let buffer = '';

    try {
      while (true) {
        if (options?.signal?.aborted) {
          throw new RequestAbortedError(
            'Ollama streaming request was aborted',
            'ollama',
          );
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let chunk: OllamaChatResponse;
          try {
            chunk = JSON.parse(trimmed) as OllamaChatResponse;
          } catch {
            // Malformed line
            continue;
          }

          if (chunk.error) {
            const mappedError = this.mapError(res.status, chunk.error, targetModel);
            yield {
              type: 'error',
              error: mappedError,
            };
            return;
          }

          if (chunk.model) {
            model = chunk.model;
          }

          // Emit reasoning / thought delta if present
          const thinkingText =
            chunk.message?.thinking || chunk.message?.reasoning_content;
          if (thinkingText) {
            yield {
              type: 'thought-delta',
              delta: thinkingText,
            };
          }

          // Emit text delta if present
          if (chunk.message?.content) {
            yield {
              type: 'text-delta',
              delta: chunk.message.content,
            };
          }

          if (chunk.done_reason) {
            finishReason = this.mapDoneReason(chunk.done_reason);
          }

          // Token counts are reported on the terminating object
          if (
            chunk.prompt_eval_count !== undefined ||
            chunk.eval_count !== undefined
          ) {
            const inTok = chunk.prompt_eval_count ?? 0;
            const outTok = chunk.eval_count ?? 0;
            currentUsage = {
              inputTokens: inTok,
              outputTokens: outTok,
              totalTokens: inTok + outTok,
            };
            yield {
              type: 'usage',
              usage: currentUsage,
            };
          }

          if (chunk.done) {
            completed = true;
            yield {
              type: 'complete',
              finishReason,
              usage: currentUsage,
              model,
            };
            return;
          }
        }
      }

      // Process any trailing line in buffer
      if (buffer.trim().length > 0) {
        const trimmed = buffer.trim();
        try {
          const chunk = JSON.parse(trimmed) as OllamaChatResponse;
          if (chunk.message?.content) {
            yield {
              type: 'text-delta',
              delta: chunk.message.content,
            };
          }
          if (
            chunk.prompt_eval_count !== undefined ||
            chunk.eval_count !== undefined
          ) {
            const inTok = chunk.prompt_eval_count ?? 0;
            const outTok = chunk.eval_count ?? 0;
            currentUsage = {
              inputTokens: inTok,
              outputTokens: outTok,
              totalTokens: inTok + outTok,
            };
            yield {
              type: 'usage',
              usage: currentUsage,
            };
          }
          if (chunk.done) {
            completed = true;
            yield {
              type: 'complete',
              finishReason: this.mapDoneReason(chunk.done_reason),
              usage: currentUsage,
              model: chunk.model || model,
            };
            return;
          }
        } catch {
          // Ignore incomplete trailing buffer
        }
      }

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
          'Ollama streaming request was aborted',
          'ollama',
        );
      }
      const rawMsg = err instanceof Error ? err.message : String(err);
      throw new ProviderUnavailableError(
        `Ollama streaming failed: ${this.sanitizeCredentials(rawMsg)}`,
        'ollama',
      );
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Discovers models locally installed in Ollama via `GET /api/tags`.
   *
   * @param options - Cancellation signal and query options.
   * @returns List of installed models in normalised shape.
   */
  async discoverModels(options?: DiscoveryOptions): Promise<DiscoveredModel[]> {
    const url = `${this.baseUrl}/api/tags`;
    const headers = this.buildHeaders(options?.headers);

    this.logDebug(`Discovering Ollama models at ${url}`);

    const res = await this.executeFetch(
      url,
      {
        method: 'GET',
        headers,
      },
      options?.signal,
    );

    let data: OllamaTagsResponse;
    try {
      data = (await res.json()) as OllamaTagsResponse;
    } catch {
      return [];
    }

    const items = data.models ?? [];
    const discoveredModels: DiscoveredModel[] = [];

    for (const item of items) {
      if (!item?.name && !item?.model) continue;

      const modelIdentifier = item.name || item.model!;

      discoveredModels.push({
        modelIdentifier,
        displayName: modelIdentifier,
        contextWindow:
          typeof item.context_window === 'number' ? item.context_window : null,
        defaultTemperature: null,
        defaultMaxTokens: null,
      });
    }

    return discoveredModels;
  }

  /**
   * Translates a normalised {@link CompletionRequest} into Ollama's wire payload.
   */
  buildChatPayload(
    request: CompletionRequest,
    stream: boolean,
  ): OllamaChatRequest {
    const wireMessages: OllamaWireMessage[] = [];

    // Prepend system prompt if supplied
    if (request.systemPrompt && request.systemPrompt.trim().length > 0) {
      wireMessages.push({
        role: 'system',
        content: request.systemPrompt.trim(),
      });
    }

    for (const msg of request.messages) {
      wireMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // Default to blank user turn if conversation is completely empty
    if (wireMessages.length === 0) {
      wireMessages.push({ role: 'user', content: ' ' });
    }

    const model = request.model?.trim() || this.defaultModel;

    // Build options object
    const options: Record<string, unknown> = {};

    if (request.temperature !== undefined) {
      options.temperature = request.temperature;
    }

    if (request.maxTokens !== undefined) {
      options.num_predict = request.maxTokens;
    }

    // Pass through agents.model_params opaquely into options
    if (request.modelParams && typeof request.modelParams === 'object') {
      Object.assign(options, request.modelParams);
    }

    const payload: OllamaChatRequest = {
      model,
      messages: wireMessages,
      stream,
      ...(Object.keys(options).length > 0 ? { options } : {}),
    };

    return payload;
  }

  /**
   * Safely executes an HTTP fetch request, enforcing separate connection and generation timeouts.
   */
  private async executeFetch(
    url: string,
    init: RequestInit,
    callerSignal?: AbortSignal,
    requestedModel?: string,
  ): Promise<Response> {
    const controller = new AbortController();
    let isConnected = false;
    let connectTimedOut = false;

    // Fast connection timer: triggers only if connection/headers take too long
    const connectTimer = setTimeout(() => {
      if (!isConnected) {
        connectTimedOut = true;
        controller.abort(
          new Error(`Connection to Ollama timed out after ${this.connectTimeoutMs}ms`),
        );
      }
    }, this.connectTimeoutMs);

    // Generous generation timer: governs full request cycle
    let generationTimer: ReturnType<typeof setTimeout> | undefined = undefined;
    if (this.generationTimeoutMs > 0) {
      generationTimer = setTimeout(() => {
        controller.abort(
          new Error(`Ollama generation timed out after ${this.generationTimeoutMs}ms`),
        );
      }, this.generationTimeoutMs);
    }

    const abortHandler = () => {
      controller.abort(callerSignal?.reason);
    };

    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort(callerSignal.reason);
      } else {
        callerSignal.addEventListener('abort', abortHandler, { once: true });
      }
    }

    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      // Headers arrived: connection established! Clear fast connection timeout immediately.
      isConnected = true;
      clearTimeout(connectTimer);

      if (!res.ok) {
        await this.handleErrorResponse(res, requestedModel);
      }

      return res;
    } catch (err: unknown) {
      if (err instanceof ModelAdapterError) {
        throw err;
      }

      if (callerSignal?.aborted) {
        throw new RequestAbortedError(
          'Request to Ollama was aborted',
          'ollama',
        );
      }

      if (connectTimedOut) {
        throw new ProviderUnavailableError(
          `Ollama is not running at ${this.baseUrl} (connection timed out after ${this.connectTimeoutMs}ms). Ensure Ollama is started with 'ollama serve' or by opening the Ollama application.`,
          'ollama',
        );
      }

      const rawMsg = err instanceof Error ? err.message : String(err);
      const lower = rawMsg.toLowerCase();

      // Check for connection refused
      if (
        lower.includes('econnrefused') ||
        lower.includes('fetch failed') ||
        lower.includes('connect error')
      ) {
        throw new ProviderUnavailableError(
          `Ollama is not running at ${this.baseUrl}. Ensure Ollama is started with 'ollama serve' or by opening the Ollama application.`,
          'ollama',
        );
      }

      throw new ProviderUnavailableError(
        `Failed to reach Ollama at ${this.baseUrl}: ${this.sanitizeCredentials(rawMsg)}`,
        'ollama',
      );
    } finally {
      clearTimeout(connectTimer);
      if (generationTimer) {
        clearTimeout(generationTimer);
      }
      if (callerSignal) {
        callerSignal.removeEventListener('abort', abortHandler);
      }
    }
  }

  /**
   * Handles non-2xx HTTP responses from Ollama, extracting rich local error messages.
   */
  private async handleErrorResponse(
    res: Response,
    requestedModel?: string,
  ): Promise<never> {
    let upstreamMessage = `HTTP ${res.status}`;

    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) {
        upstreamMessage = body.error;
      }
    } catch {
      // Body not readable as JSON
    }

    throw this.mapError(res.status, upstreamMessage, requestedModel);
  }

  /**
   * Maps status codes and error messages into typed {@link ModelAdapterError} subclasses.
   */
  private mapError(
    status: number,
    message: string,
    requestedModel?: string,
  ): ModelAdapterError {
    const safeMessage = this.sanitizeCredentials(message);
    const lower = safeMessage.toLowerCase();

    // 1. Missing model error: Ollama returns error mentioning "not found" or "pulling it"
    if (
      status === 404 ||
      lower.includes('not found') ||
      lower.includes('try pulling')
    ) {
      // Attempt to extract model name from message e.g. "model 'qwen2.5:14b' not found"
      const match = safeMessage.match(/model ['"]([^'"]+)['"] not found/i);
      const modelName = match ? match[1] : requestedModel || this.defaultModel;
      return new ModelNotFoundError(modelName, 'ollama');
    }

    // 2. Model loading error
    if (lower.includes('loading') || lower.includes('busy')) {
      const modelName = requestedModel || this.defaultModel;
      return new ProviderUnavailableError(
        `Model "${modelName}" is still loading into memory. Please wait a moment and try again.`,
        'ollama',
      );
    }

    // 3. Context length exceeded
    if (
      lower.includes('context length') ||
      lower.includes('token limit') ||
      lower.includes('too many tokens')
    ) {
      return new ContextLengthExceededError(safeMessage, 'ollama');
    }

    // 4. Rate limit (if Ollama is behind rate-limited proxy)
    if (status === 429) {
      return new RateLimitError(`Ollama rate limit exceeded: ${safeMessage}`, 'ollama');
    }

    // 5. Invalid request
    if (status === 400) {
      return new InvalidRequestError(`Ollama rejected request: ${safeMessage}`, 'ollama');
    }

    // 6. Server / generic errors
    return new ProviderUnavailableError(
      `Ollama error (HTTP ${status}): ${safeMessage}`,
      'ollama',
    );
  }

  /**
   * Maps Ollama done_reason string to normalised {@link FinishReason}.
   */
  mapDoneReason(doneReason?: string): FinishReason {
    switch (doneReason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      default:
        return 'stop';
    }
  }

  /**
   * Constructs request headers, attaching Authorization header only if an API key is configured.
   */
  private buildHeaders(customHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(customHeaders),
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  /**
   * Sanitizes any occurrences of credentials from log messages or errors.
   */
  sanitizeCredentials(message: string): string {
    if (!this.apiKey || this.apiKey.length === 0) {
      return message;
    }
    return message.replaceAll(this.apiKey, '[REDACTED_API_KEY]');
  }

  private logDebug(message: string): void {
    if (this.logger?.debug) {
      this.logger.debug(this.sanitizeCredentials(message));
    }
  }
}
