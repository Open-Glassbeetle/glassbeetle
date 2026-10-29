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
  GeminiContent,
  GeminiErrorBody,
  GeminiGenerateContentRequest,
  GeminiGenerateContentResponse,
  GeminiListModelsResponse,
  GeminiSafetyRating,
  GeminiSystemInstruction,
} from './google.types.js';

/**
 * Standard Google Gemini API public base endpoint URL.
 */
export const GOOGLE_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

/**
 * Default Gemini model identifier when omitted from both request and provider configuration.
 */
export const GOOGLE_DEFAULT_MODEL = 'gemini-1.5-flash';

/**
 * Default Gemini API version segment.
 */
export const GOOGLE_DEFAULT_API_VERSION = 'v1beta';

/**
 * Default outbound request timeout in milliseconds.
 */
export const GOOGLE_DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Options for configuring {@link GoogleAdapter}.
 */
export interface GoogleAdapterOptions {
  /**
   * Request timeout in milliseconds (defaults to {@link GOOGLE_DEFAULT_TIMEOUT_MS}).
   */
  readonly timeoutMs?: number;

  /**
   * Target API version segment (defaults to {@link GOOGLE_DEFAULT_API_VERSION}).
   */
  readonly apiVersion?: string;

  /**
   * Authentication transport method:
   * - `'header'`: Sends `x-goog-api-key: <key>` (recommended; default).
   * - `'query'`: Appends `?key=<key>` to the request URL.
   */
  readonly authMethod?: 'header' | 'query';

  /**
   * Optional logger instance for request auditing.
   * All logged URLs and messages are automatically sanitized to prevent credential leaks.
   */
  readonly logger?: {
    debug?: (message: string) => void;
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  };
}

/**
 * Model adapter for Google's Gemini Generative Language API.
 *
 * Registered for `providers.kind = 'google'`.
 *
 * ## Architectural Highlights & Wire Protocol Translation:
 * 1. **Role Mapping**:
 *    - Normalized `user` -> Gemini `user`.
 *    - Normalized `assistant` -> Gemini `model` (and mapped back).
 *    - Normalized `system` -> Hoisted into top-level `systemInstruction`.
 *
 * 2. **Turn Alternation & Consecutive Turn Merging**:
 *    - Gemini requires turns to strictly alternate `user` -> `model` -> `user`...
 *    - Glassbeetle team chats often have multiple sequential `assistant` turns.
 *    - Consecutive turns with the same role are merged into a single turn separated
 *      by `\n\n`, preserving participant names (`Name: ...`).
 *    - Conversations starting with an assistant turn have a blank user turn prepended.
 *
 * 3. **Parts Structure**:
 *    - Messages are wrapped into `{ parts: [{ text: content }] }`.
 *    - Multimodal media (images, audio, PDF) slot directly into `GeminiPart`
 *      when database columns expand beyond TEXT.
 *
 * 4. **Nested Generation Config**:
 *    - `temperature` and `maxTokens` map to `generationConfig.temperature` and
 *      `generationConfig.maxOutputTokens`.
 *    - `agents.model_params` are passed through opaquely into `generationConfig`.
 *
 * 5. **Safety Block Handling**:
 *    - Gemini returns HTTP 200 with empty candidates or `finishReason: 'SAFETY'`
 *      when blocked by safety filters.
 *    - This adapter detects `promptFeedback.blockReason` and safety finish reasons
 *      and maps them into actionable {@link InvalidRequestError}s rather than
 *      returning silently empty completions.
 *
 * 6. **Strict Credential Redaction**:
 *    - The API key is never logged, printed, or attached to errors.
 *    - Outbound URLs (even with query-based auth) are strictly scrubbed via {@link sanitizeUrl}.
 */
export class GoogleAdapter implements ModelAdapter {
  readonly capabilities: ModelCapabilities = {
    supportsStreaming: true,
    supportsDiscovery: true,
    supportsSystemPrompt: true,
    supportsToolCalls: false,
  };

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultModel: string;
  private readonly apiVersion: string;
  private readonly authMethod: 'header' | 'query';
  private readonly timeoutMs: number;
  private readonly logger?: GoogleAdapterOptions['logger'];

  constructor(
    private readonly config: AdapterConfig,
    options?: GoogleAdapterOptions,
  ) {
    const rawBaseUrl = (config.baseUrl?.trim() || GOOGLE_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.baseUrl = rawBaseUrl;
    this.apiKey = config.apiKey?.trim() || undefined;
    this.defaultModel = config.modelIdentifier?.trim() || GOOGLE_DEFAULT_MODEL;
    this.apiVersion = options?.apiVersion?.trim() || GOOGLE_DEFAULT_API_VERSION;
    this.authMethod = options?.authMethod ?? 'header';
    this.timeoutMs = options?.timeoutMs ?? GOOGLE_DEFAULT_TIMEOUT_MS;
    this.logger = options?.logger;
  }

  /**
   * Executes a non-streaming completion using Gemini's `generateContent` endpoint.
   *
   * @param request - Normalised completion request.
   * @param options - Cancellation signal and additional request headers.
   * @returns Normalised completion response with generated content and token usage.
   */
  async complete(
    request: CompletionRequest,
    options?: CompletionOptions,
  ): Promise<CompletionResponse> {
    const payload = this.buildGenerateContentPayload(request);
    const targetModel = request.model?.trim() || this.defaultModel;
    const url = this.resolveEndpointUrl(':generateContent', targetModel);
    const headers = this.buildHeaders(options?.headers);

    this.logDebug(`Executing Gemini complete for model "${targetModel}" at ${this.sanitizeUrl(url)}`);

    const res = await this.executeFetch(
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      },
      options?.signal,
    );

    const data = (await res.json()) as GeminiGenerateContentResponse;

    // Detect prompt-level safety blocks
    if (data.promptFeedback?.blockReason) {
      throw this.createSafetyBlockedError(
        data.promptFeedback.blockReason,
        data.promptFeedback.safetyRatings,
      );
    }

    const candidate = data.candidates?.[0];

    // Detect candidate-level safety blocks or empty candidate list
    if (!candidate) {
      throw new InvalidRequestError(
        'Gemini returned an empty candidate list with no usable content.',
        'google',
      );
    }

    if (
      candidate.finishReason === 'SAFETY' ||
      candidate.finishReason === 'BLOCKLIST' ||
      candidate.finishReason === 'PROHIBITED_CONTENT' ||
      candidate.finishReason === 'SPII'
    ) {
      throw this.createSafetyBlockedError(
        candidate.finishReason,
        candidate.safetyRatings,
      );
    }

    const textContent = this.extractTextContent(candidate.content?.parts);
    const reasoningContent = this.extractReasoningContent(candidate.content?.parts);

    // If candidate has no text and was not marked normal stop
    if (!textContent && candidate.finishReason !== 'STOP') {
      throw new InvalidRequestError(
        `Gemini returned empty content with finish reason: ${candidate.finishReason || 'UNKNOWN'}`,
        'google',
      );
    }

    const inTok = data.usageMetadata?.promptTokenCount ?? 0;
    const outTok = data.usageMetadata?.candidatesTokenCount ?? 0;
    const totalTok = data.usageMetadata?.totalTokenCount ?? inTok + outTok;

    return {
      content: textContent,
      reasoningContent,
      finishReason: this.mapFinishReason(candidate.finishReason),
      usage: {
        inputTokens: inTok,
        outputTokens: outTok,
        totalTokens: totalTok,
      },
      model: data.modelVersion || targetModel,
      raw: data,
    };
  }

  /**
   * Executes a streaming completion using Gemini's `streamGenerateContent` endpoint.
   *
   * @param request - Normalised completion request.
   * @param options - Cancellation signal and additional request headers.
   * @returns Async iterable yielding typed {@link StreamEvent} objects.
   */
  async *stream(
    request: CompletionRequest,
    options?: CompletionOptions,
  ): AsyncIterable<StreamEvent> {
    const payload = this.buildGenerateContentPayload(request);
    const targetModel = request.model?.trim() || this.defaultModel;
    const url = this.resolveEndpointUrl(':streamGenerateContent', targetModel, { alt: 'sse' });
    const headers = this.buildHeaders(options?.headers);

    this.logDebug(`Executing Gemini stream for model "${targetModel}" at ${this.sanitizeUrl(url)}`);

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
        'Gemini streaming response body is empty',
        'google',
      );
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    let model = targetModel;
    let finishReason: FinishReason = 'stop';
    let inputTokens = 0;
    let outputTokens = 0;
    let completed = false;
    let buffer = '';

    try {
      while (true) {
        if (options?.signal?.aborted) {
          throw new RequestAbortedError(
            'Gemini streaming request was aborted',
            'google',
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

              const events = this.parseSseChunk(dataStr, {
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
                if (event.type === 'complete' || event.type === 'error') {
                  return;
                }
              }
            }
          } else if (line.startsWith(':')) {
            // SSE comment / ping
            continue;
          } else if (line.startsWith('data:')) {
            currentDataLines.push(line.slice(5).trimStart());
          }
        }
      }

      // Handle any trailing buffer
      if (buffer.trim().length > 0) {
        const trailingData = buffer.startsWith('data:')
          ? buffer.slice(5).trimStart()
          : buffer.trim();

        const events = this.parseSseChunk(trailingData, {
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
          if (event.type === 'complete' || event.type === 'error') {
            return;
          }
        }
      }

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
      if (
        options?.signal?.aborted ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        throw new RequestAbortedError(
          'Gemini streaming request was aborted',
          'google',
        );
      }
      const rawMsg = err instanceof Error ? err.message : String(err);
      throw new ProviderUnavailableError(
        `Gemini streaming failed: ${this.sanitizeCredentials(rawMsg)}`,
        'google',
      );
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Discovers models available from Gemini's `GET /v1beta/models` endpoint.
   *
   * Maps upstream models into normalised {@link DiscoveredModel} instances:
   * - Strips `models/` prefix from `name`.
   * - Maps `inputTokenLimit` to `contextWindow`.
   * - Maps `outputTokenLimit` to `defaultMaxTokens`.
   * - Maps `temperature` to `defaultTemperature`.
   * - Filters for models supporting `generateContent` when methods are reported.
   *
   * @param options - Cancellation signal and query options.
   * @returns List of models in normalised shape.
   */
  async discoverModels(options?: DiscoveryOptions): Promise<DiscoveredModel[]> {
    const headers = this.buildHeaders(options?.headers);
    const discoveredModels: DiscoveredModel[] = [];
    let pageToken: string | undefined = undefined;
    let pageCount = 0;
    const maxPages = 10;

    do {
      const queryParams: Record<string, string> = { pageSize: '100' };
      if (pageToken) {
        queryParams['pageToken'] = pageToken;
      }

      const url = this.resolveEndpointUrl('/models', undefined, queryParams);
      this.logDebug(`Discovering Gemini models at ${this.sanitizeUrl(url)}`);

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
          (err instanceof ModelAdapterError && err.statusCode === 404)
        ) {
          throw new UnsupportedCapabilityError('model discovery', 'google');
        }
        throw err;
      }

      let data: GeminiListModelsResponse;
      try {
        data = (await res.json()) as GeminiListModelsResponse;
      } catch {
        return discoveredModels;
      }

      const items = data.models ?? [];

      for (const item of items) {
        if (!item?.name) continue;

        // Strip leading 'models/' prefix for model identifier
        const modelIdentifier = item.name.replace(/^models\//, '');

        // If supportedGenerationMethods is reported, only include models supporting content generation
        if (
          Array.isArray(item.supportedGenerationMethods) &&
          !item.supportedGenerationMethods.includes('generateContent')
        ) {
          continue;
        }

        discoveredModels.push({
          modelIdentifier,
          displayName: item.displayName || modelIdentifier,
          contextWindow:
            typeof item.inputTokenLimit === 'number' ? item.inputTokenLimit : null,
          defaultTemperature:
            typeof item.temperature === 'number' ? item.temperature : null,
          defaultMaxTokens:
            typeof item.outputTokenLimit === 'number' ? item.outputTokenLimit : null,
        });
      }

      if (data.nextPageToken && pageCount < maxPages) {
        pageToken = data.nextPageToken;
        pageCount++;
      } else {
        pageToken = undefined;
      }
    } while (pageToken);

    return discoveredModels;
  }

  /**
   * Translates a normalised {@link CompletionRequest} into Gemini's wire payload.
   */
  buildGenerateContentPayload(request: CompletionRequest): GeminiGenerateContentRequest {
    const { systemInstruction, contents } = this.translateMessages(request);

    const payload: GeminiGenerateContentRequest = {
      contents,
    };

    if (systemInstruction) {
      payload.systemInstruction = systemInstruction;
    }

    // Build generationConfig
    const generationConfig: Record<string, unknown> = {};

    if (request.temperature !== undefined) {
      generationConfig.temperature = request.temperature;
    }

    if (request.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = request.maxTokens;
    }

    // Pass through modelParams opaquely
    if (request.modelParams && typeof request.modelParams === 'object') {
      const { safetySettings, ...otherParams } = request.modelParams;
      if (safetySettings !== undefined) {
        payload.safetySettings = safetySettings;
      }
      Object.assign(generationConfig, otherParams);
    }

    if (Object.keys(generationConfig).length > 0) {
      payload.generationConfig = generationConfig;
    }

    return payload;
  }

  /**
   * Normalises conversation history for Gemini:
   * 1. Hoists any `role === 'system'` messages alongside `request.systemPrompt` into `systemInstruction`.
   * 2. Maps `assistant` -> `model` and `tool` -> `user`.
   * 3. Merges consecutive same-role turns into a single turn separated by `\n\n`, preserving participant names.
   * 4. Prepends an introductory user turn if conversation begins with a model turn.
   * 5. Wraps content strings into the `{ parts: [{ text }] }` structure.
   */
  private translateMessages(request: CompletionRequest): {
    systemInstruction?: GeminiSystemInstruction;
    contents: GeminiContent[];
  } {
    const systemParts: string[] = [];

    if (request.systemPrompt && request.systemPrompt.trim().length > 0) {
      systemParts.push(request.systemPrompt.trim());
    }

    // Separate system messages from conversational messages
    const nonSystemMessages: AdapterMessage[] = [];
    for (const msg of request.messages) {
      if (msg.role === 'system') {
        if (msg.content?.trim()) {
          systemParts.push(msg.content.trim());
        }
      } else {
        nonSystemMessages.push(msg);
      }
    }

    let systemInstruction: GeminiSystemInstruction | undefined = undefined;
    if (systemParts.length > 0) {
      systemInstruction = {
        parts: [{ text: systemParts.join('\n\n') }],
      };
    }

    if (nonSystemMessages.length === 0) {
      return {
        systemInstruction,
        contents: [{ role: 'user', parts: [{ text: ' ' }] }],
      };
    }

    // Merge consecutive same-role messages
    const contents: GeminiContent[] = [];

    for (const msg of nonSystemMessages) {
      const role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
      const formattedContent = msg.name ? `${msg.name}: ${msg.content}` : msg.content;

      const previous = contents[contents.length - 1];

      if (previous && previous.role === role) {
        // Merge consecutive same-role turn by concatenating with double newline
        if (previous.parts.length > 0 && typeof previous.parts[0].text === 'string') {
          previous.parts[0].text = `${previous.parts[0].text}\n\n${formattedContent}`;
        } else {
          previous.parts.push({ text: formattedContent });
        }
      } else {
        contents.push({
          role,
          parts: [{ text: formattedContent }],
        });
      }
    }

    // Gemini strictly requires the first turn to be 'user'
    if (contents.length > 0 && contents[0].role === 'model') {
      contents.unshift({ role: 'user', parts: [{ text: ' ' }] });
    }

    return {
      systemInstruction,
      contents,
    };
  }

  /**
   * Resolves endpoint URLs, supporting standard Gemini endpoints and custom proxies.
   */
  private resolveEndpointUrl(
    actionOrPath: string,
    model?: string,
    extraQueryParams?: Record<string, string>,
  ): string {
    const cleanModel = model ? model.replace(/^models\//, '') : '';
    let relativePath: string;

    if (actionOrPath === '/models') {
      relativePath = 'models';
    } else if (actionOrPath.startsWith(':')) {
      relativePath = `models/${cleanModel}${actionOrPath}`;
    } else {
      relativePath = actionOrPath.replace(/^\/+/, '');
    }

    // Determine path prefix based on whether baseUrl already includes version segment
    let fullUrlString: string;
    if (
      this.baseUrl.endsWith('/v1beta') ||
      this.baseUrl.endsWith('/v1') ||
      /\/v\d+(alpha|beta)?$/i.test(this.baseUrl)
    ) {
      fullUrlString = `${this.baseUrl}/${relativePath}`;
    } else {
      fullUrlString = `${this.baseUrl}/${this.apiVersion}/${relativePath}`;
    }

    const url = new URL(fullUrlString);

    if (extraQueryParams) {
      for (const [k, v] of Object.entries(extraQueryParams)) {
        url.searchParams.set(k, v);
      }
    }

    // If query authentication is configured and apiKey is present, attach to search parameters
    if (this.authMethod === 'query' && this.apiKey) {
      url.searchParams.set('key', this.apiKey);
    }

    return url.toString();
  }

  /**
   * Constructs request headers, including Google API key authentication when using header mode.
   */
  private buildHeaders(customHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(customHeaders),
    };

    if (this.apiKey && this.authMethod === 'header') {
      headers['x-goog-api-key'] = this.apiKey;
    }

    return headers;
  }

  /**
   * Safely executes an HTTP fetch request with timeout and signal wiring.
   */
  private async executeFetch(
    url: string,
    init: RequestInit,
    callerSignal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined = undefined;

    if (this.timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        controller.abort(new Error(`Gemini request timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
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

      if (!res.ok) {
        await this.handleErrorResponse(res);
      }

      return res;
    } catch (err: unknown) {
      if (err instanceof ModelAdapterError) {
        throw err;
      }

      if (
        callerSignal?.aborted ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        throw new RequestAbortedError(
          'Request to Google Gemini was aborted',
          'google',
        );
      }

      const rawMsg = err instanceof Error ? err.message : String(err);
      const safeMsg = this.sanitizeCredentials(rawMsg);

      throw new ProviderUnavailableError(
        `Failed to reach Google Gemini: ${safeMsg}`,
        'google',
      );
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (callerSignal) {
        callerSignal.removeEventListener('abort', abortHandler);
      }
    }
  }

  /**
   * Handles non-2xx responses from Google APIs, mapping them into typed {@link ModelAdapterError}s.
   */
  private async handleErrorResponse(res: Response): Promise<never> {
    let upstreamMessage = `HTTP ${res.status}`;
    let upstreamStatus = '';

    try {
      const body = (await res.json()) as GeminiErrorBody;
      if (body?.error?.message) {
        upstreamMessage = body.error.message;
      }
      if (body?.error?.status) {
        upstreamStatus = body.error.status;
      }
    } catch {
      // Body not readable as JSON
    }

    throw this.mapErrorByStatus(res.status, upstreamMessage, upstreamStatus);
  }

  /**
   * Normalises Google error codes and HTTP statuses into typed {@link ModelAdapterError} instances.
   */
  private mapErrorByStatus(
    status: number,
    upstreamMessage: string,
    upstreamStatus: string,
  ): ModelAdapterError {
    const safeMessage = this.sanitizeCredentials(upstreamMessage);
    const lowerMsg = safeMessage.toLowerCase();

    if (
      status === 401 ||
      status === 403 ||
      upstreamStatus === 'UNAUTHENTICATED' ||
      upstreamStatus === 'PERMISSION_DENIED' ||
      lowerMsg.includes('api key not valid') ||
      lowerMsg.includes('api_key_invalid')
    ) {
      return new AuthenticationError(
        `Google Gemini authentication failed: ${safeMessage}`,
        'google',
      );
    }

    if (status === 404 || upstreamStatus === 'NOT_FOUND') {
      return new ModelNotFoundError(this.defaultModel, 'google');
    }

    if (status === 429 || upstreamStatus === 'RESOURCE_EXHAUSTED') {
      return new RateLimitError(
        `Google Gemini rate limit exceeded: ${safeMessage}`,
        'google',
      );
    }

    if (status === 400 || upstreamStatus === 'INVALID_ARGUMENT') {
      if (
        lowerMsg.includes('context') ||
        lowerMsg.includes('token count') ||
        lowerMsg.includes('maximum token') ||
        lowerMsg.includes('input token limit')
      ) {
        return new ContextLengthExceededError(safeMessage, 'google');
      }
      return new InvalidRequestError(
        `Google Gemini rejected request: ${safeMessage}`,
        'google',
      );
    }

    if (
      status === 500 ||
      status === 502 ||
      status === 503 ||
      status === 504 ||
      upstreamStatus === 'UNAVAILABLE' ||
      upstreamStatus === 'INTERNAL' ||
      upstreamStatus === 'DEADLINE_EXCEEDED'
    ) {
      return new ProviderUnavailableError(
        `Google Gemini service unavailable (HTTP ${status}): ${safeMessage}`,
        'google',
      );
    }

    return new ProviderUnavailableError(
      `Google Gemini error (HTTP ${status}): ${safeMessage}`,
      'google',
    );
  }

  /**
   * Processes a single parsed SSE event block and emits corresponding normalised {@link StreamEvent}s.
   */
  private parseSseChunk(
    dataStr: string,
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
    if (!trimmed) return [];

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

    let parsed: GeminiGenerateContentResponse & GeminiErrorBody;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }

    const events: StreamEvent[] = [];

    // Upstream error in streaming event
    if (parsed.error) {
      const errStatus = parsed.error.status || '';
      const errMsg = parsed.error.message || 'Gemini streaming error';
      const mapped = this.mapErrorByStatus(parsed.error.code ?? 500, errMsg, errStatus);
      events.push({
        type: 'error',
        error: mapped,
      });
      return events;
    }

    if (parsed.modelVersion) {
      ctx.onModel(parsed.modelVersion);
    }

    // Prompt-level safety block
    if (parsed.promptFeedback?.blockReason) {
      const safetyError = this.createSafetyBlockedError(
        parsed.promptFeedback.blockReason,
        parsed.promptFeedback.safetyRatings,
      );
      events.push({
        type: 'error',
        error: safetyError,
      });
      return events;
    }

    const candidate = parsed.candidates?.[0];

    // Candidate-level safety block
    if (
      candidate?.finishReason === 'SAFETY' ||
      candidate?.finishReason === 'BLOCKLIST' ||
      candidate?.finishReason === 'PROHIBITED_CONTENT' ||
      candidate?.finishReason === 'SPII'
    ) {
      const safetyError = this.createSafetyBlockedError(
        candidate.finishReason,
        candidate.safetyRatings,
      );
      events.push({
        type: 'error',
        error: safetyError,
      });
      return events;
    }

    // Text & thought deltas
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.thought && part.text) {
          events.push({
            type: 'thought-delta',
            delta: part.text,
          });
        } else if (part.text) {
          events.push({
            type: 'text-delta',
            delta: part.text,
          });
        }
      }
    }

    // Candidate finish reason
    if (candidate?.finishReason) {
      ctx.onFinishReason(this.mapFinishReason(candidate.finishReason));
    }

    // Usage update
    if (parsed.usageMetadata) {
      const inTok = parsed.usageMetadata.promptTokenCount;
      const outTok = parsed.usageMetadata.candidatesTokenCount;
      ctx.onUsage(inTok, outTok);
      events.push({
        type: 'usage',
        usage: ctx.getUsage(),
      });
    }

    return events;
  }

  /**
   * Creates an actionable {@link InvalidRequestError} when Gemini blocks generation due to safety.
   */
  private createSafetyBlockedError(
    reason: string,
    ratings?: GeminiSafetyRating[],
  ): InvalidRequestError {
    const blockedCategories = ratings
      ?.filter((r) => r.blocked || r.probability === 'HIGH' || r.probability === 'MEDIUM')
      .map((r) => `${r.category} (${r.probability})`)
      .join(', ');

    const detailStr = blockedCategories ? `: ${blockedCategories}` : '';
    const message = `Gemini generation was blocked by safety filters (${reason})${detailStr}.`;

    return new InvalidRequestError(message, 'google');
  }

  /**
   * Extracts text content from candidate parts, excluding reasoning/thought parts.
   */
  private extractTextContent(parts?: Array<{ text?: string; thought?: boolean }>): string {
    if (!parts) return '';
    return parts
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
  }

  /**
   * Extracts reasoning content from candidate thought parts (if any).
   */
  private extractReasoningContent(
    parts?: Array<{ text?: string; thought?: boolean }>,
  ): string | undefined {
    if (!parts) return undefined;
    const thoughts = parts
      .filter((p) => p.thought && typeof p.text === 'string')
      .map((p) => p.text);
    return thoughts.length > 0 ? thoughts.join('') : undefined;
  }

  /**
   * Maps Gemini wire finish reason to normalised {@link FinishReason}.
   */
  mapFinishReason(finishReason?: string | null): FinishReason {
    switch (finishReason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'RECITATION':
      case 'BLOCKLIST':
      case 'PROHIBITED_CONTENT':
      case 'SPII':
        return 'content_filter';
      default:
        return 'other';
    }
  }

  /**
   * Sanitizes occurrences of the API key from arbitrary strings, logs, or error messages.
   */
  sanitizeCredentials(message: string): string {
    if (!this.apiKey || this.apiKey.length === 0) {
      return message;
    }
    return message.replaceAll(this.apiKey, '[REDACTED_API_KEY]');
  }

  /**
   * Sanitizes URLs so that query-based API keys (`?key=...` or `&key=...`) or raw keys
   * never leak into application logs or telemetry.
   */
  sanitizeUrl(url: string): string {
    let sanitized = url.replace(/([?&]key=)[^&]+/g, '$1[REDACTED_API_KEY]');
    if (this.apiKey && this.apiKey.length > 0) {
      sanitized = sanitized.replaceAll(this.apiKey, '[REDACTED_API_KEY]');
    }
    return sanitized;
  }

  private logDebug(message: string): void {
    if (this.logger?.debug) {
      this.logger.debug(this.sanitizeCredentials(message));
    }
  }
}
