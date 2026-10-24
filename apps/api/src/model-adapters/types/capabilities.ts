/**
 * Declared runtime capabilities of an adapter.
 *
 * Keeps capability detection minimal and runtime-oriented without requiring
 * database columns. Allows consumers (e.g. streaming pipelines or discovery
 * endpoints) to inspect adapter feature support before invoking methods.
 */
export interface ModelCapabilities {
  /** Whether the adapter supports token-by-token streaming via SSE */
  readonly supportsStreaming: boolean;
  /** Whether the adapter supports querying available models via an API */
  readonly supportsDiscovery: boolean;
  /** Whether the provider supports separate system prompt instructions */
  readonly supportsSystemPrompt: boolean;
  /** Whether the provider supports tool/function calling specifications */
  readonly supportsToolCalls: boolean;
}
