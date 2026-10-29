import type { FinishReason, TokenUsage } from './completion.js';
import type { ModelAdapterError } from '../errors/model-adapter-error.js';

/**
 * Incremental text token delta chunk.
 */
export interface TextDeltaEvent {
  readonly type: 'text-delta';
  /** Incremental generated text */
  readonly delta: string;
}

/**
 * Incremental reasoning / chain-of-thought token delta chunk.
 */
export interface ThoughtDeltaEvent {
  readonly type: 'thought-delta';
  /** Incremental reasoning text */
  readonly delta: string;
}

/**
 * Mid-stream or final token usage update.
 */
export interface UsageEvent {
  readonly type: 'usage';
  readonly usage: TokenUsage;
}

/**
 * Final completion event emitted when generation finishes normally.
 */
export interface CompleteEvent {
  readonly type: 'complete';
  readonly finishReason: FinishReason;
  readonly usage?: TokenUsage;
  readonly model?: string;
}

/**
 * In-band error payload emitted mid-stream over realtime transport (SSE).
 *
 * Once HTTP headers (200 OK) have been sent, the response status code cannot
 * be changed and the global exception filter cannot rewrite the body. Instead,
 * the stream yields an in-band error event containing this wire-safe payload.
 *
 * Adheres strictly to redaction rules: no causes, credentials, or raw upstream
 * bodies are ever included in this payload.
 */
export interface StreamErrorPayload {
  /** Normalised machine-readable error code */
  readonly code: string;
  /** User-safe human-readable message */
  readonly message: string;
  /** Whether the generation failure is retryable */
  readonly retryable: boolean;
  /** The provider kind encountering the error */
  readonly providerKind?: string;
  /** Model identifier involved in the generation failure */
  readonly model?: string;
  /** Suggested retry delay in seconds if provided by upstream */
  readonly retryAfterSeconds?: number;
}

/**
 * In-band error event emitted if a failure occurs during streaming.
 */
export interface ErrorEvent {
  readonly type: 'error';
  readonly error: ModelAdapterError;
  /** Wire-safe payload representation for in-band streaming transport */
  readonly payload?: StreamErrorPayload;
}

/**
 * Discriminated union of structured streaming events yielded by `ModelAdapter.stream()`.
 *
 * Aligns with the realtime transport specification (`docs/realtime-transport.md`).
 */
export type StreamEvent =
  | TextDeltaEvent
  | ThoughtDeltaEvent
  | UsageEvent
  | CompleteEvent
  | ErrorEvent;
