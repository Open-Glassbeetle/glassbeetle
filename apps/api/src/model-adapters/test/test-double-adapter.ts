import { RequestAbortedError } from '../errors/model-adapter-error.js';
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

/**
 * Options for configuring the behavior of {@link TestDoubleAdapter}.
 */
export interface TestDoubleOptions {
  /** Override default capabilities */
  capabilities?: Partial<ModelCapabilities>;

  /** Static completion response to return */
  cannedResponse?: Partial<CompletionResponse>;

  /** Sequence of completion responses to return for successive calls */
  cannedResponses?: Partial<CompletionResponse>[];

  /** Explicit stream events to yield instead of auto-chunking text */
  cannedStreamEvents?: StreamEvent[];

  /** Simulated error to throw on complete() or stream() */
  simulateError?: Error;

  /** Number of text-delta chunks to emit before throwing `simulateError` during streaming */
  failAfterChunks?: number;

  /** Models returned by `discoverModels()` */
  discoveredModels?: DiscoveredModel[];

  /** Chunk size in characters when generating stream events from text (defaults to 10) */
  streamChunkSize?: number;

  /** Artificial delay in ms between stream chunks (defaults to 0 for fast tests) */
  streamDelayMs?: number;
}

/**
 * Deterministic in-repo test double adapter implementing {@link ModelAdapter}.
 *
 * Used by completions, streaming, and integration test suites to simulate AI
 * model behavior predictably without hitting real network endpoints.
 */
export class TestDoubleAdapter implements ModelAdapter {
  readonly capabilities: ModelCapabilities;

  readonly completedRequests: CompletionRequest[] = [];
  readonly streamedRequests: CompletionRequest[] = [];
  readonly discoveryCalls: DiscoveryOptions[] = [];

  private readonly config: AdapterConfig;
  private readonly options: TestDoubleOptions;
  private responseIndex = 0;

  constructor(
    config?: Partial<AdapterConfig>,
    options: TestDoubleOptions = {},
  ) {
    this.config = {
      providerId: 'test-provider-id',
      providerKind: 'openai',
      baseUrl: 'http://localhost:11434',
      ...config,
    };
    this.options = options;

    this.capabilities = {
      supportsStreaming: true,
      supportsDiscovery: true,
      supportsSystemPrompt: true,
      supportsToolCalls: true,
      ...options.capabilities,
    };
  }

  /**
   * Clears recorded request history and resets response queue index.
   */
  resetHistory(): void {
    this.completedRequests.length = 0;
    this.streamedRequests.length = 0;
    this.discoveryCalls.length = 0;
    this.responseIndex = 0;
  }

  /**
   * Deterministic completion implementation.
   */
  async complete(
    request: CompletionRequest,
    options?: CompletionOptions,
  ): Promise<CompletionResponse> {
    if (options?.signal?.aborted) {
      throw new RequestAbortedError(
        'Request was aborted before execution',
        this.config.providerKind,
      );
    }

    this.completedRequests.push(request);

    if (this.options.simulateError) {
      throw this.options.simulateError;
    }

    return this.buildResponse(request);
  }

  /**
   * Deterministic streaming implementation yielding typed {@link StreamEvent}s.
   */
  async *stream(
    request: CompletionRequest,
    options?: CompletionOptions,
  ): AsyncIterable<StreamEvent> {
    if (options?.signal?.aborted) {
      throw new RequestAbortedError(
        'Stream was aborted before execution',
        this.config.providerKind,
      );
    }

    this.streamedRequests.push(request);

    if (this.options.simulateError && this.options.failAfterChunks === undefined) {
      throw this.options.simulateError;
    }

    // Custom canned events take priority if configured
    if (this.options.cannedStreamEvents) {
      for (const event of this.options.cannedStreamEvents) {
        if (options?.signal?.aborted) {
          throw new RequestAbortedError(
            'Stream aborted during iteration',
            this.config.providerKind,
          );
        }
        yield event;
      }
      return;
    }

    // Generate stream events from completion response
    const fullResponse = this.buildResponse(request);
    const text = fullResponse.content;
    const chunkSize = Math.max(1, this.options.streamChunkSize ?? 10);

    let emittedChunks = 0;

    for (let i = 0; i < text.length; i += chunkSize) {
      if (options?.signal?.aborted) {
        throw new RequestAbortedError(
          'Stream aborted during iteration',
          this.config.providerKind,
        );
      }

      if (
        this.options.simulateError &&
        this.options.failAfterChunks !== undefined &&
        emittedChunks >= this.options.failAfterChunks
      ) {
        throw this.options.simulateError;
      }

      if (this.options.streamDelayMs && this.options.streamDelayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.options.streamDelayMs),
        );
      }

      yield {
        type: 'text-delta',
        delta: text.slice(i, i + chunkSize),
      };
      emittedChunks++;
    }

    // Emit final complete event
    yield {
      type: 'complete',
      finishReason: fullResponse.finishReason,
      usage: fullResponse.usage,
      model: fullResponse.model,
    };
  }

  /**
   * Returns deterministic model list.
   */
  async discoverModels(options?: DiscoveryOptions): Promise<DiscoveredModel[]> {
    if (options?.signal?.aborted) {
      throw new RequestAbortedError(
        'Discovery aborted',
        this.config.providerKind,
      );
    }

    this.discoveryCalls.push(options ?? {});

    if (this.options.simulateError) {
      throw this.options.simulateError;
    }

    return (
      this.options.discoveredModels ?? [
        {
          modelIdentifier: 'test-model-alpha',
          displayName: 'Test Model Alpha',
          contextWindow: 128000,
          defaultTemperature: 0.7,
          defaultMaxTokens: 4096,
        },
        {
          modelIdentifier: 'test-model-beta',
          displayName: 'Test Model Beta',
          contextWindow: 32768,
          defaultTemperature: 0.5,
          defaultMaxTokens: 2048,
        },
      ]
    );
  }

  private buildResponse(request: CompletionRequest): CompletionResponse {
    let canned: Partial<CompletionResponse> | undefined;

    if (
      this.options.cannedResponses &&
      this.options.cannedResponses.length > 0
    ) {
      canned =
        this.options.cannedResponses[
          this.responseIndex % this.options.cannedResponses.length
        ];
      this.responseIndex++;
    } else if (this.options.cannedResponse) {
      canned = this.options.cannedResponse;
    }

    const defaultContent =
      canned?.content ??
      `Response to: "${request.messages[request.messages.length - 1]?.content ?? ''}"`;

    const model =
      canned?.model ??
      request.model ??
      this.config.modelIdentifier ??
      'test-model-alpha';

    const finishReason: FinishReason = canned?.finishReason ?? 'stop';

    const usage: TokenUsage = canned?.usage ?? {
      inputTokens: request.messages.reduce(
        (sum, m) => sum + m.content.length / 4,
        0,
      ) | 0,
      outputTokens: (defaultContent.length / 4) | 0,
      totalTokens:
        ((request.messages.reduce((sum, m) => sum + m.content.length / 4, 0) +
          defaultContent.length / 4) |
          0) || 10,
    };

    return {
      content: defaultContent,
      reasoningContent: canned?.reasoningContent,
      finishReason,
      usage,
      model,
      raw: canned?.raw ?? { provider: 'test-double' },
    };
  }
}
