import type { AdapterMessage } from './messages.js';

/**
 * Standardised reason why generation finished.
 */
export type FinishReason =
  | 'stop'
  | 'length'
  | 'tool_calls'
  | 'content_filter'
  | 'abort'
  | 'other';

/**
 * Normalised token usage metrics reported by an LLM provider.
 */
export interface TokenUsage {
  /** Number of prompt/input tokens processed */
  readonly inputTokens: number;
  /** Number of generated completion/output tokens */
  readonly outputTokens: number;
  /** Total tokens processed (input + output) */
  readonly totalTokens: number;
  /** Optional reasoning or chain-of-thought tokens consumed */
  readonly reasoningTokens?: number;
}

/**
 * Normalised completion request submitted to an adapter.
 *
 * Designed to decouple caller inference logic from vendor-specific payload shapes.
 */
export interface CompletionRequest {
  /**
   * The model to invoke (e.g. 'claude-sonnet-5', 'gpt-4o').
   * If omitted, falls back to the adapter's configured model.
   */
  readonly model?: string;

  /**
   * Top-level normalised system prompt.
   *
   * Accommodates provider-specific handling: Anthropic requires a top-level `system`
   * parameter, while OpenAI accepts a `system` message in the messages array.
   */
  readonly systemPrompt?: string;

  /**
   * Ordered sequence of conversation turns.
   */
  readonly messages: readonly AdapterMessage[];

  /**
   * Sampling temperature. Defaults to provider or agent configuration.
   */
  readonly temperature?: number;

  /**
   * Maximum completion tokens to generate.
   */
  readonly maxTokens?: number;

  /**
   * Arbitrary provider-specific extra parameters from `agents.model_params`
   * (e.g. `top_p`, `frequency_penalty`, `presence_penalty`, `stop_sequences`).
   * Passed through opaquely.
   */
  readonly modelParams?: Record<string, unknown>;
}

/**
 * Normalised response from a non-streaming completion.
 */
export interface CompletionResponse {
  /** Generated text content */
  readonly content: string;
  /** Optional reasoning or chain-of-thought content from reasoning models */
  readonly reasoningContent?: string;
  /** Reason why model generation finished */
  readonly finishReason: FinishReason;
  /** Token usage report */
  readonly usage: TokenUsage;
  /** The model identifier that actually served the completion */
  readonly model: string;
  /** Raw provider-specific metadata, preserved for diagnostics and telemetry */
  readonly raw?: unknown;
}
