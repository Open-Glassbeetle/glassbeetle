import { Injectable, Logger } from '@nestjs/common';
import { newId } from '../../common/persistence/identifiers.js';
import { toIso } from '../../common/persistence/timestamps.js';
import { DatabaseService } from '../../database/database.service.js';
import {
  USAGE_EVENT_TYPES,
  type DiscriminatedUsageEvent,
  type RecordAgentCreatedParams,
  type RecordArtifactCreatedParams,
  type RecordChatCompactionParams,
  type RecordChatCompletionParams,
  type UsageEventRow,
  type UsageEventType,
} from './usage-event.types.js';

export {
  USAGE_EVENT_TYPES,
  type DiscriminatedUsageEvent,
  type RecordAgentCreatedParams,
  type RecordArtifactCreatedParams,
  type RecordChatCompactionParams,
  type RecordChatCompletionParams,
  type UsageEventRow,
  type UsageEventType,
};

/**
 * Sensitive user data keys that must never be recorded in `usage_events.metadata`.
 *
 * Analytics is bookkeeping for operational telemetry, token metrics, and event
 * counts. User prompts and assistant responses belong strictly in chat messages
 * and artifacts, not in the unbounded analytics log.
 */
const FORBIDDEN_METADATA_KEYS = new Set([
  'prompt',
  'completion',
  'content',
  'message',
  'messages',
  'systemprompt',
  'system_prompt',
]);

/**
 * Recursively strips user content and forbidden fields from analytics metadata.
 */
function sanitizeMetadata(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeMetadata);
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (FORBIDDEN_METADATA_KEYS.has(key.toLowerCase())) {
      continue;
    }
    result[key] = sanitizeMetadata(val);
  }
  return result;
}

/**
 * Service providing the write path for domain and operational analytics.
 *
 * Persists structured event rows into the SQLite `usage_events` table.
 *
 * ## Key Design Decisions:
 * 1. **Non-blocking & Non-fatal**:
 *    Analytics is bookkeeping. A failure to record a usage event must never fail
 *    the completion or operation that produced it. Any error during persistence
 *    is caught, logged at `ERROR` level, and swallowed so the caller continues safely.
 * 2. **Caller-Supplied Event Time**:
 *    `occurred_at` represents the instant the event occurred (e.g. when a streaming
 *    completion began), not when the row was inserted minutes later. Callers must
 *    supply the event time.
 * 3. **Null vs. Zero Token Counts**:
 *    When a model provider does not report token usage, `input_tokens` and
 *    `output_tokens` are written as `null` rather than zero. Zero is a measured count,
 *    whereas `null` denotes an unmeasured absence.
 * 4. **Cost Policy**:
 *    `cost_usd` is stored as `null` by default. Local models incur no marginal cost,
 *    and hosted providers require rate cards and pricing models not bundled here.
 *    Storing `null` honestly denotes the lack of verified pricing data, rather than
 *    asserting a false cost of zero.
 * 5. **Local-First & Zero Telemetry**:
 *    All data is stored exclusively in the user's local SQLite database. No analytics,
 *    telemetry, or events are ever transmitted off the machine.
 * 6. **Foreign Key Resilience**:
 *    Foreign keys on `agent_id`, `provider_id`, `model_id`, and `chat_id` are configured
 *    with `ON DELETE SET NULL` in the schema. When a referenced entity is deleted,
 *    the historical event remains intact with a null foreign key.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Records a usage event into `usage_events`.
   *
   * Guaranteed to be non-fatal: any SQLite error is caught and logged, returning
   * `null` rather than propagating an exception to the caller.
   *
   * @param event - Strongly typed event descriptor.
   * @returns The persisted event row, or `null` if recording failed.
   */
  public record(event: DiscriminatedUsageEvent): UsageEventRow | null {
    try {
      const id = newId();

      let occurredAt: string;
      if (event.occurredAt instanceof Date) {
        occurredAt = toIso(event.occurredAt);
      } else if (
        typeof event.occurredAt === 'string' &&
        event.occurredAt.trim()
      ) {
        occurredAt = event.occurredAt;
      } else {
        occurredAt = toIso(new Date());
      }

      const inputTokens =
        typeof event.inputTokens === 'number' &&
        Number.isFinite(event.inputTokens)
          ? Math.round(event.inputTokens)
          : null;

      const outputTokens =
        typeof event.outputTokens === 'number' &&
        Number.isFinite(event.outputTokens)
          ? Math.round(event.outputTokens)
          : null;

      const costUsd =
        typeof event.costUsd === 'number' && Number.isFinite(event.costUsd)
          ? event.costUsd
          : null;

      const metadataJson = this.serializeMetadata(event.metadata);

      this.db.run(
        `INSERT INTO usage_events (
          id, occurred_at, event_type, agent_id, provider_id, model_id, chat_id,
          input_tokens, output_tokens, cost_usd, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          occurredAt,
          event.eventType,
          event.agentId ?? null,
          event.providerId ?? null,
          event.modelId ?? null,
          event.chatId ?? null,
          inputTokens,
          outputTokens,
          costUsd,
          metadataJson,
        ],
      );

      return {
        id,
        occurred_at: occurredAt,
        event_type: event.eventType,
        agent_id: event.agentId ?? null,
        provider_id: event.providerId ?? null,
        model_id: event.modelId ?? null,
        chat_id: event.chatId ?? null,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: costUsd,
        metadata: metadataJson,
      };
    } catch (error) {
      this.logger.error(
        `Failed to record usage event "${event?.eventType}": ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return null;
    }
  }

  /**
   * Convenience method to record a chat completion event.
   */
  public recordChatCompletion(
    params: RecordChatCompletionParams,
  ): UsageEventRow | null {
    return this.record({
      ...params,
      eventType: USAGE_EVENT_TYPES.CHAT_COMPLETION,
    });
  }

  /**
   * Convenience method to record a chat compaction/summarisation event.
   */
  public recordChatCompaction(
    params: RecordChatCompactionParams,
  ): UsageEventRow | null {
    return this.record({
      ...params,
      eventType: USAGE_EVENT_TYPES.CHAT_COMPACTION,
    });
  }

  /**
   * Convenience method to record an agent creation event.
   */
  public recordAgentCreated(
    params: RecordAgentCreatedParams,
  ): UsageEventRow | null {
    return this.record({
      ...params,
      eventType: USAGE_EVENT_TYPES.AGENT_CREATED,
    });
  }

  /**
   * Convenience method to record an artifact creation event.
   */
  public recordArtifactCreated(
    params: RecordArtifactCreatedParams,
  ): UsageEventRow | null {
    return this.record({
      ...params,
      eventType: USAGE_EVENT_TYPES.ARTIFACT_CREATED,
    });
  }

  /**
   * Retrieves a single recorded usage event by its ID.
   *
   * @param id - Event row identifier.
   * @returns Persisted row or `undefined` if not found.
   */
  public findById(id: string): UsageEventRow | undefined {
    return this.db.get<UsageEventRow>(
      'SELECT * FROM usage_events WHERE id = ?',
      [id],
    );
  }

  /**
   * Serialises optional metadata to a clean JSON string while omitting forbidden user content.
   */
  private serializeMetadata(
    metadata?: Record<string, unknown> | null,
  ): string | null {
    if (!metadata || typeof metadata !== 'object') {
      return null;
    }

    const sanitized = sanitizeMetadata(metadata) as Record<string, unknown>;
    if (
      !sanitized ||
      typeof sanitized !== 'object' ||
      Object.keys(sanitized).length === 0
    ) {
      return null;
    }

    try {
      return JSON.stringify(sanitized);
    } catch {
      return null;
    }
  }
}
