/**
 * Vocabulary and type definitions for usage analytics events.
 *
 * Glassbeetle records local-first analytics to the `usage_events` table.
 * All types and constants here define the write-path schema and ensure
 * that callers use a consistent, typed vocabulary rather than assembling
 * raw database rows.
 */

/**
 * Canonical vocabulary of usage event types.
 *
 * `usage_events.event_type` is an unconstrained string in SQLite, but callers must
 * use these constants to prevent typos and ensure analytics read endpoints can group
 * events reliably. Adding a new event type must be a deliberate act.
 */
export const USAGE_EVENT_TYPES = Object.freeze({
  /**
   * Execution of an LLM chat completion (streaming or non-streaming).
   * Typically carries `agent_id`, `provider_id`, `model_id`, `chat_id`, and token metrics.
   */
  CHAT_COMPLETION: 'chat_completion',

  /**
   * Summarisation and compaction of a conversation history.
   * Carries compaction token metrics and links to chat, agent, provider, and model.
   */
  CHAT_COMPACTION: 'chat_compaction',

  /**
   * Creation of a new agent persona.
   * Recorded for activity analytics; carries `agent_id` and optional `model_id`.
   */
  AGENT_CREATED: 'agent_created',

  /**
   * Creation of a new artifact.
   * Recorded for activity analytics; carries optional `agent_id` and `chat_id`.
   */
  ARTIFACT_CREATED: 'artifact_created',
} as const);

/**
 * String union of all valid usage event types.
 */
export type UsageEventType =
  (typeof USAGE_EVENT_TYPES)[keyof typeof USAGE_EVENT_TYPES];

/**
 * Base properties required or optional across all usage events.
 */
export interface BaseUsageEventParams {
  /**
   * Timestamp when the event actually occurred (ISO-8601 string or Date).
   * Supplied by the caller rather than defaulted to insert time, which is
   * critical for operations with duration (e.g. streaming completions).
   */
  readonly occurredAt: string | Date;

  /** Optional agent identifier associated with the event. */
  readonly agentId?: string | null;

  /** Optional provider identifier associated with the event. */
  readonly providerId?: string | null;

  /** Optional model identifier associated with the event. */
  readonly modelId?: string | null;

  /** Optional chat identifier associated with the event. */
  readonly chatId?: string | null;

  /**
   * Optional number of input/prompt tokens (null if unknown or unmeasured).
   */
  readonly inputTokens?: number | null;

  /**
   * Optional number of output/completion tokens (null if unknown or unmeasured).
   */
  readonly outputTokens?: number | null;

  /**
   * Monetary cost in USD if known.
   *
   * By default this is `null`: local providers incur no marginal cost, and
   * hosted providers require per-model pricing tables not bundled in this codebase.
   * Writing `null` honestly denotes the absence of a verified cost calculation,
   * whereas writing zero would falsely assert that hosted API usage was free.
   */
  readonly costUsd?: number | null;

  /**
   * Optional structured metadata serialised to JSON.
   * Must never contain prompt or completion text (user content privacy).
   */
  readonly metadata?: Record<string, unknown> | null;
}

/**
 * Parameters for recording a chat completion event.
 */
export interface RecordChatCompletionParams extends BaseUsageEventParams {
  /** Number of input/prompt tokens reported by the provider (null if unknown). */
  readonly inputTokens?: number | null;
  /** Number of output/completion tokens reported by the provider (null if unknown). */
  readonly outputTokens?: number | null;
}

/**
 * Parameters for recording a conversation history compaction event.
 */
export interface RecordChatCompactionParams extends BaseUsageEventParams {
  /** Number of input tokens consumed during compaction (null if unknown). */
  readonly inputTokens?: number | null;
  /** Number of output tokens generated in summary (null if unknown). */
  readonly outputTokens?: number | null;
}

/**
 * Parameters for recording an agent creation event.
 */
export interface RecordAgentCreatedParams extends BaseUsageEventParams {
  /** Identifier of the newly created agent. */
  readonly agentId: string;
}

/**
 * Parameters for recording an artifact creation event.
 */
export interface RecordArtifactCreatedParams extends BaseUsageEventParams {
  /** Identifier of the newly created artifact, if recorded. */
  readonly artifactId?: string | null;
}

/**
 * Discriminated union of all recordable usage events by eventType.
 */
export type DiscriminatedUsageEvent =
  | ({
      readonly eventType: (typeof USAGE_EVENT_TYPES)['CHAT_COMPLETION'];
    } & RecordChatCompletionParams)
  | ({
      readonly eventType: (typeof USAGE_EVENT_TYPES)['CHAT_COMPACTION'];
    } & RecordChatCompactionParams)
  | ({
      readonly eventType: (typeof USAGE_EVENT_TYPES)['AGENT_CREATED'];
    } & RecordAgentCreatedParams)
  | ({
      readonly eventType: (typeof USAGE_EVENT_TYPES)['ARTIFACT_CREATED'];
    } & RecordArtifactCreatedParams);

/**
 * Represents a row in the `usage_events` table.
 */
export interface UsageEventRow {
  readonly id: string;
  readonly occurred_at: string;
  readonly event_type: string;
  readonly agent_id: string | null;
  readonly provider_id: string | null;
  readonly model_id: string | null;
  readonly chat_id: string | null;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly cost_usd: number | null;
  readonly metadata: string | null;
}
