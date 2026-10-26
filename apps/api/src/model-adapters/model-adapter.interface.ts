import type {
  AdapterConfig,
  CompletionOptions,
  CompletionRequest,
  CompletionResponse,
  DiscoveredModel,
  DiscoveryOptions,
  ModelCapabilities,
  StreamEvent,
} from './types/index.js';

/**
 * Common, provider-agnostic interface that every AI model adapter implements.
 *
 * This abstraction decouples orchestration (chats, agents, teams, completions)
 * from specific AI vendors (Anthropic, OpenAI, Google, Ollama, LM Studio).
 *
 * ## Security Guarantees:
 * - Adapters receive decrypted credentials via {@link AdapterConfig.apiKey}.
 * - An adapter **MUST NEVER** log, print, cache, or return the decrypted API key.
 * - An adapter **MUST NEVER** attach credentials to thrown errors or serialized error bodies.
 *
 * ## System Prompt Normalisation:
 * - {@link CompletionRequest.systemPrompt} is a top-level string.
 * - Adapters for providers that require a top-level parameter (e.g. Anthropic) pass it directly.
 * - Adapters for providers that treat system instructions as messages (e.g. OpenAI) prepend
 *   it as the first message with role `system`.
 *
 * ## Streaming Protocol:
 * - {@link ModelAdapter.stream} returns an async iterable yielding structured {@link StreamEvent} objects.
 * - Tokens are yielded incrementally as `{ type: 'text-delta', delta: '...' }`.
 * - Models supporting chain-of-thought yield `{ type: 'thought-delta', delta: '...' }`.
 * - The stream terminates with a `{ type: 'complete' }` event or by throwing a {@link model-adapters/errors/model-adapter-error.ModelAdapterError}.
 *
 * ## Cancellation:
 * - All methods accept {@link CompletionOptions.signal} or {@link DiscoveryOptions.signal}.
 * - When aborted, in-flight HTTP requests must be aborted immediately and throw {@link model-adapters/errors/model-adapter-error.RequestAbortedError}.
 */
export interface ModelAdapter {
  /**
   * Runtime capabilities of this adapter (streaming, discovery, tool calls, system prompts).
   */
  readonly capabilities: ModelCapabilities;

  /**
   * Executes a non-streaming completion request.
   *
   * @param request - Normalised prompt and conversation history.
   * @param options - Cancellation signal and request options.
   * @returns Normalised completion response with generated content and token usage.
   * @throws ModelAdapterError (or subclass) on failure.
   */
  complete(
    request: CompletionRequest,
    options?: CompletionOptions,
  ): Promise<CompletionResponse>;

  /**
   * Executes a streaming completion yielding structured events.
   *
   * @param request - Normalised prompt and conversation history.
   * @param options - Cancellation signal and request options.
   * @returns Async iterable yielding typed {@link StreamEvent} objects.
   * @throws ModelAdapterError (or subclass) on failure.
   */
  stream(
    request: CompletionRequest,
    options?: CompletionOptions,
  ): AsyncIterable<StreamEvent>;

  /**
   * Discovers models available from the provider's remote API.
   *
   * Optional: adapters for providers with no discovery API may omit this or
   * report `capabilities.supportsDiscovery === false`.
   *
   * @param options - Cancellation and query options.
   * @returns List of discovered models in normalised shape.
   * @throws UnsupportedCapabilityError if called on an adapter that does not support discovery.
   */
  discoverModels?(options?: DiscoveryOptions): Promise<DiscoveredModel[]>;
}

/**
 * Factory function signature for instantiating an adapter for a specific provider configuration.
 */
export type ModelAdapterCreator = (config: AdapterConfig) => ModelAdapter;
