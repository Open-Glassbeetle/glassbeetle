import {
  AuthenticationError,
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
  ModelCapabilities,
  StreamEvent,
} from '../types/index.js';

/**
 * Worked example demonstrating how a real vendor adapter (e.g. OpenAI or Anthropic compatible)
 * is implemented against the {@link ModelAdapter} interface using native `fetch`.
 *
 * ## Key Principles:
 * 1. **No External SDKs**: Uses standard global `fetch` and web streams.
 * 2. **Credential Privacy**: The decrypted API key is scoped privately and never logged or exposed.
 * 3. **System Prompt Normalisation**: Translates top-level `systemPrompt` into the vendor's protocol.
 * 4. **Cancellation**: Forwards `options.signal` directly to `fetch`.
 * 5. **Normalised Error Mapping**: Maps HTTP 401, 404, 429, 5xx to {@link ModelAdapterError} subclasses.
 */
export class ExampleOpenAiCompatibleAdapter implements ModelAdapter {
  readonly capabilities: ModelCapabilities = {
    supportsStreaming: true,
    supportsDiscovery: true,
    supportsSystemPrompt: true,
    supportsToolCalls: true,
  };

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultModel: string;

  constructor(config: AdapterConfig) {
    // Fallback to official endpoint if no custom baseUrl provided
    this.baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.defaultModel = config.modelIdentifier || 'gpt-4o';
  }

  /**
   * Non-streaming completion.
   */
  async complete(
    request: CompletionRequest,
    options?: CompletionOptions,
  ): Promise<CompletionResponse> {
    const payload = this.buildPayload(request, false);

    const res = await this.executeFetch('/chat/completions', payload, options);
    const json = (await res.json()) as {
      model: string;
      choices: { message: { content: string }; finish_reason: string }[];
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    const choice = json.choices[0];
    return {
      content: choice?.message?.content ?? '',
      finishReason: this.mapFinishReason(choice?.finish_reason),
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        totalTokens: json.usage?.total_tokens ?? 0,
      },
      model: json.model ?? request.model ?? this.defaultModel,
      raw: json,
    };
  }

  /**
   * Streaming completion yielding structured {@link StreamEvent} objects.
   */
  async *stream(
    request: CompletionRequest,
    options?: CompletionOptions,
  ): AsyncIterable<StreamEvent> {
    const payload = this.buildPayload(request, true);
    const res = await this.executeFetch('/chat/completions', payload, options);

    if (!res.body) {
      throw new ProviderUnavailableError('Response body is empty', 'openai_compatible');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (options?.signal?.aborted) {
          throw new RequestAbortedError('Stream aborted', 'openai_compatible');
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.replace(/^data:\s*/, '');
          if (dataStr === '[DONE]') {
            yield { type: 'complete', finishReason: 'stop' };
            return;
          }

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              yield { type: 'text-delta', delta };
            }
          } catch {
            // Ignore keep-alive or malformed fragments
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Model discovery query.
   */
  async discoverModels(options?: DiscoveryOptions): Promise<DiscoveredModel[]> {
    const res = await this.executeFetch('/models', null, options, 'GET');
    const json = (await res.json()) as { data: { id: string }[] };

    return (json.data || []).map((m) => ({
      modelIdentifier: m.id,
      displayName: m.id,
      contextWindow: null,
      defaultTemperature: null,
      defaultMaxTokens: null,
    }));
  }

  /**
   * Builds the vendor wire payload, normalising top-level system prompt.
   */
  private buildPayload(request: CompletionRequest, stream: boolean): Record<string, unknown> {
    const wireMessages: { role: string; content: string }[] = [];

    // Translate top-level systemPrompt to first message
    if (request.systemPrompt) {
      wireMessages.push({ role: 'system', content: request.systemPrompt });
    }

    // Append regular turns
    for (const msg of request.messages) {
      wireMessages.push({ role: msg.role, content: msg.content });
    }

    return {
      model: request.model ?? this.defaultModel,
      messages: wireMessages,
      stream,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      ...(request.modelParams ?? {}),
    };
  }

  private async executeFetch(
    path: string,
    body: unknown,
    options?: CompletionOptions,
    method = 'POST',
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: options?.signal,
      });

      if (!res.ok) {
        await this.handleErrorResponse(res);
      }

      return res;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new RequestAbortedError('Request was aborted', 'openai_compatible');
      }
      throw new ProviderUnavailableError(
        `Failed to reach provider: ${err instanceof Error ? err.message : String(err)}`,
        'openai_compatible',
        err,
      );
    }
  }

  private async handleErrorResponse(res: Response): Promise<never> {
    let errorMsg = `Provider error: HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) {
        errorMsg = body.error.message;
      }
    } catch {
      // Use fallback error message
    }

    switch (res.status) {
      case 401:
      case 403:
        throw new AuthenticationError(errorMsg, 'openai_compatible');
      case 404:
        throw new ModelNotFoundError(this.defaultModel, 'openai_compatible');
      case 429:
        throw new RateLimitError(errorMsg, 'openai_compatible');
      default:
        throw new ProviderUnavailableError(errorMsg, 'openai_compatible');
    }
  }

  private mapFinishReason(reason?: string): 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'other' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
        return 'tool_calls';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'other';
    }
  }
}
