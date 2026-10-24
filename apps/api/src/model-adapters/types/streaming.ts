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
 * In-band error event emitted if a failure occurs during streaming.
 */
export interface ErrorEvent {
  readonly type: 'error';
  readonly error: ModelAdapterError;
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
