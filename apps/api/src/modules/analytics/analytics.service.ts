import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { newId } from '../../common/persistence/identifiers.js';
import { toIso } from '../../common/persistence/timestamps.js';
import { DatabaseService } from '../../database/database.service.js';
import { UserService } from '../user/user.service.js';
import {
  ALLOWED_GROUP_BY_DIMENSIONS,
  TIME_BUCKET_DIMENSIONS,
  type GroupByDimension,
  type TimeBucketDimension,
  type UsageQueryDto,
} from './dto/usage-query.dto.js';
import type {
  UsageGroupRowDto,
  UsageResponseDto,
  UsageTotalsDto,
} from './dto/usage-response.dto.js';
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
 * Maximum number of time buckets permitted in a single request.
 *
 * Prevents denial-of-service and unmanageably large payloads (e.g. daily bucketing
 * across several years). A request that exceeds this limit returns HTTP 400.
 */
export const MAX_TIME_BUCKETS = 366;

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
 * Rounds monetary amounts to 6 decimal places (microdollar precision).
 * Eliminates IEEE-754 binary floating-point representation noise.
 */
function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Computes week of year conforming to SQLite's `strftime('%Y-W%W', ...)`.
 * SQLite week 01 starts on the first Monday of the year; days before are W00.
 */
function formatSqliteWeek(d: Date): string {
  const year = d.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const dayOfWeekJan1 = jan1.getUTCDay();
  const daysToFirstMon = (8 - (dayOfWeekJan1 === 0 ? 7 : dayOfWeekJan1)) % 7;
  const diffDays = Math.floor((d.getTime() - jan1.getTime()) / 86_400_000);
  if (diffDays < daysToFirstMon) {
    return `${year}-W00`;
  }
  const weekNum = Math.floor((diffDays - daysToFirstMon) / 7) + 1;
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Parses an offset string (`+HH:MM` or `-HH:MM`) into milliseconds.
 */
function parseOffsetToMs(offset: string): number {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!match) {
    return 0;
  }
  const sign = match[1] === '-' ? -1 : 1;
  const hours = parseInt(match[2], 10);
  const minutes = parseInt(match[3], 10);
  return sign * (hours * 3600 + minutes * 60) * 1000;
}

/**
 * Resolves a timezone string into a canonical timeZone name and SQLite offset modifier (`+HH:MM`).
 */
function resolveTimezone(
  timeZoneInput?: string | null,
  userProfileTimezone?: string | null,
  referenceDate: Date = new Date(),
): { timeZoneName: string; offsetModifier: string } {
  const rawTz = timeZoneInput?.trim() || userProfileTimezone?.trim() || 'UTC';

  if (rawTz === 'Z' || rawTz.toUpperCase() === 'UTC') {
    return { timeZoneName: 'UTC', offsetModifier: '+00:00' };
  }

  const offsetMatch = /^([+-])(\d{2}):(\d{2})$/.exec(rawTz);
  if (offsetMatch) {
    const hours = parseInt(offsetMatch[2], 10);
    const minutes = parseInt(offsetMatch[3], 10);
    if (hours < 0 || hours > 14 || minutes < 0 || minutes > 59) {
      throw new BadRequestException(
        `Invalid timezone offset: "${rawTz}". Offset hours must be between 00 and 14, minutes between 00 and 59.`,
      );
    }
    return { timeZoneName: rawTz, offsetModifier: rawTz };
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: rawTz,
      timeZoneName: 'longOffset',
    });
    const parts = formatter.formatToParts(referenceDate);
    const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (!tzPart || tzPart === 'GMT') {
      return { timeZoneName: rawTz, offsetModifier: '+00:00' };
    }
    const offset = tzPart.replace('GMT', '');
    return { timeZoneName: rawTz, offsetModifier: offset };
  } catch {
    throw new BadRequestException(
      `Invalid timezone: "${rawTz}". Must be "UTC", a valid IANA timezone name, or an offset such as "+02:00" or "-05:00".`,
    );
  }
}

/**
 * Estimates the bucket count for a time range and interval.
 */
function countTimeBuckets(
  bucketType: TimeBucketDimension,
  fromDate: Date,
  toDate: Date,
): number {
  if (bucketType === 'day') {
    return (
      Math.ceil(
        (toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000),
      ) + 1
    );
  }
  if (bucketType === 'week') {
    return (
      Math.ceil(
        (toDate.getTime() - fromDate.getTime()) / (7 * 24 * 60 * 60 * 1000),
      ) + 1
    );
  }
  if (bucketType === 'month') {
    return (
      (toDate.getUTCFullYear() - fromDate.getUTCFullYear()) * 12 +
      (toDate.getUTCMonth() - fromDate.getUTCMonth()) +
      1
    );
  }
  return 0;
}

/**
 * Generates an ordered array of time bucket keys across `[fromDate, toDate]`
 * taking into account the civil time shift from `offsetModifier`.
 */
function generateTimeBuckets(
  bucketType: TimeBucketDimension,
  fromDate: Date,
  toDate: Date,
  offsetModifier: string,
): string[] {
  const offsetMs = parseOffsetToMs(offsetModifier);
  const fromShifted = new Date(fromDate.getTime() + offsetMs);
  const toShifted = new Date(toDate.getTime() + offsetMs);

  if (bucketType === 'day') {
    const cur = new Date(
      Date.UTC(
        fromShifted.getUTCFullYear(),
        fromShifted.getUTCMonth(),
        fromShifted.getUTCDate(),
      ),
    );
    const end = new Date(
      Date.UTC(
        toShifted.getUTCFullYear(),
        toShifted.getUTCMonth(),
        toShifted.getUTCDate(),
      ),
    );
    const buckets: string[] = [];
    while (cur <= end) {
      buckets.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return buckets;
  }

  if (bucketType === 'month') {
    const buckets: string[] = [];
    let curYear = fromShifted.getUTCFullYear();
    let curMonth = fromShifted.getUTCMonth();
    const endYear = toShifted.getUTCFullYear();
    const endMonth = toShifted.getUTCMonth();
    while (curYear < endYear || (curYear === endYear && curMonth <= endMonth)) {
      const mStr = String(curMonth + 1).padStart(2, '0');
      buckets.push(`${curYear}-${mStr}`);
      curMonth++;
      if (curMonth > 11) {
        curMonth = 0;
        curYear++;
      }
    }
    return buckets;
  }

  // week
  const bucketsSet = new Set<string>();
  const cur = new Date(
    Date.UTC(
      fromShifted.getUTCFullYear(),
      fromShifted.getUTCMonth(),
      fromShifted.getUTCDate(),
    ),
  );
  const end = new Date(
    Date.UTC(
      toShifted.getUTCFullYear(),
      toShifted.getUTCMonth(),
      toShifted.getUTCDate(),
    ),
  );
  while (cur <= end) {
    bucketsSet.add(formatSqliteWeek(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return Array.from(bucketsSet);
}

/**
 * Service providing analytics persistence and SQL aggregations over `usage_events`.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly userService?: UserService,
  ) {}

  /**
   * Aggregates token consumption, costs, and event counts over `usage_events`.
   *
   * @param query - Filtering, grouping, and time range options.
   * @returns Aggregated totals and breakdown groups.
   */
  public async getUsage(query: UsageQueryDto): Promise<UsageResponseDto> {
    // 1. Time range validation & defaulting
    let toDate: Date;
    let effectiveTo: string;
    if (query.to !== undefined && query.to !== null && query.to !== '') {
      toDate = new Date(query.to);
      if (Number.isNaN(toDate.getTime())) {
        throw new BadRequestException(
          'Invalid "to" timestamp: must be a valid ISO-8601 date string',
        );
      }
      effectiveTo = query.to;
    } else {
      toDate = new Date();
      effectiveTo = toIso(toDate);
    }

    let fromDate: Date;
    let effectiveFrom: string;
    if (query.from !== undefined && query.from !== null && query.from !== '') {
      fromDate = new Date(query.from);
      if (Number.isNaN(fromDate.getTime())) {
        throw new BadRequestException(
          'Invalid "from" timestamp: must be a valid ISO-8601 date string',
        );
      }
      effectiveFrom = query.from;
    } else {
      fromDate = new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      effectiveFrom = toIso(fromDate);
    }

    if (fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException(
        'Inverted time range: "from" must be earlier than or equal to "to"',
      );
    }

    // 2. Timezone resolution
    const userZone = this.userService?.timezone();
    const { timeZoneName, offsetModifier } = resolveTimezone(
      query.timezone,
      userZone,
      toDate,
    );

    // 3. GroupBy parsing & validation
    const requestedGroupBy = this.parseGroupBy(query.groupBy);
    const timeBucketDims = requestedGroupBy.filter((dim) =>
      (TIME_BUCKET_DIMENSIONS as readonly string[]).includes(dim),
    ) as TimeBucketDimension[];

    if (timeBucketDims.length > 1) {
      throw new BadRequestException(
        `Cannot group by multiple time bucket intervals simultaneously (received: ${timeBucketDims.join(', ')}). Choose at most one of: day, week, month.`,
      );
    }

    const timeBucket = timeBucketDims[0];
    if (timeBucket) {
      const bucketCount = countTimeBuckets(timeBucket, fromDate, toDate);
      if (bucketCount > MAX_TIME_BUCKETS) {
        throw new BadRequestException(
          `Requested time range produces ${bucketCount} ${timeBucket} buckets, which exceeds the maximum allowed limit of ${MAX_TIME_BUCKETS}. Narrow the time range or use a coarser grouping (e.g. week or month).`,
        );
      }
    }

    // 4. Validate filter eventType
    if (
      query.eventType !== undefined &&
      query.eventType !== null &&
      query.eventType !== ''
    ) {
      const validEventTypes = Object.values(USAGE_EVENT_TYPES);
      if (!validEventTypes.includes(query.eventType as UsageEventType)) {
        throw new BadRequestException(
          `Invalid eventType: "${query.eventType}". Allowed values are: ${validEventTypes.join(', ')}.`,
        );
      }
    }

    // 5. Build WHERE clause with bound parameters
    const whereConditions: string[] = ['occurred_at >= ?', 'occurred_at <= ?'];
    const whereParams: any[] = [effectiveFrom, effectiveTo];

    if (query.agentId) {
      whereConditions.push('agent_id = ?');
      whereParams.push(query.agentId);
    }
    if (query.providerId) {
      whereConditions.push('provider_id = ?');
      whereParams.push(query.providerId);
    }
    if (query.modelId) {
      whereConditions.push('model_id = ?');
      whereParams.push(query.modelId);
    }
    if (query.eventType) {
      whereConditions.push('event_type = ?');
      whereParams.push(query.eventType);
    }

    const whereSql = `WHERE ${whereConditions.join(' AND ')}`;

    // 6. Query Totals in SQL
    const totalsRow = this.db.get<{
      input_tokens: number | null;
      output_tokens: number | null;
      cost_usd: number | null;
      event_count: number;
      unknown_tokens_count: number;
      unknown_cost_count: number;
    }>(
      `SELECT
         COALESCE(SUM(input_tokens), 0)                                            AS input_tokens,
         COALESCE(SUM(output_tokens), 0)                                           AS output_tokens,
         COALESCE(SUM(cost_usd), 0.0)                                              AS cost_usd,
         COUNT(*)                                                                  AS event_count,
         COUNT(CASE WHEN input_tokens IS NULL OR output_tokens IS NULL THEN 1 END) AS unknown_tokens_count,
         COUNT(CASE WHEN cost_usd IS NULL THEN 1 END)                              AS unknown_cost_count
       FROM usage_events
       ${whereSql}`,
      whereParams,
    );

    const inputTokensTotal = Math.round(Number(totalsRow?.input_tokens ?? 0));
    const outputTokensTotal = Math.round(Number(totalsRow?.output_tokens ?? 0));
    const totals: UsageTotalsDto = {
      inputTokens: inputTokensTotal,
      outputTokens: outputTokensTotal,
      totalTokens: inputTokensTotal + outputTokensTotal,
      costUsd: roundCost(Number(totalsRow?.cost_usd ?? 0)),
      eventCount: Number(totalsRow?.event_count ?? 0),
      unknownTokensEventCount: Number(totalsRow?.unknown_tokens_count ?? 0),
      unknownCostEventCount: Number(totalsRow?.unknown_cost_count ?? 0),
    };

    // 7. If no grouping requested, return empty breakdown
    if (requestedGroupBy.length === 0) {
      return {
        timeRange: { from: effectiveFrom, to: effectiveTo },
        timeZone: timeZoneName,
        totals,
        groups: [],
      };
    }

    // 8. Build SQL for GROUP BY
    const selectCols: string[] = [];
    const groupByCols: string[] = [];
    const orderByCols: string[] = [];
    const groupQueryParams: any[] = [];

    const hasBucket = !!timeBucket;
    const hasAgent = requestedGroupBy.includes('agent');
    const hasProvider = requestedGroupBy.includes('provider');
    const hasModel = requestedGroupBy.includes('model');

    if (hasBucket) {
      let formatStr: string;
      if (timeBucket === 'day') {
        formatStr = '%Y-%m-%d';
      } else if (timeBucket === 'week') {
        formatStr = '%Y-W%W';
      } else {
        formatStr = '%Y-%m';
      }
      selectCols.push(`strftime('${formatStr}', occurred_at, ?) AS bucket`);
      groupByCols.push('bucket');
      orderByCols.push('bucket ASC');
      groupQueryParams.push(offsetModifier);
    }

    if (hasAgent) {
      selectCols.push('agent_id');
      groupByCols.push('agent_id');
      orderByCols.push('agent_id ASC');
    }
    if (hasProvider) {
      selectCols.push('provider_id');
      groupByCols.push('provider_id');
      orderByCols.push('provider_id ASC');
    }
    if (hasModel) {
      selectCols.push('model_id');
      groupByCols.push('model_id');
      orderByCols.push('model_id ASC');
    }

    groupQueryParams.push(...whereParams);

    const groupSql = `
      SELECT
        ${selectCols.join(', ')},
        COALESCE(SUM(input_tokens), 0)                                            AS input_tokens,
        COALESCE(SUM(output_tokens), 0)                                           AS output_tokens,
        COALESCE(SUM(cost_usd), 0.0)                                              AS cost_usd,
        COUNT(*)                                                                  AS event_count,
        COUNT(CASE WHEN input_tokens IS NULL OR output_tokens IS NULL THEN 1 END) AS unknown_tokens_count,
        COUNT(CASE WHEN cost_usd IS NULL THEN 1 END)                              AS unknown_cost_count
      FROM usage_events
      ${whereSql}
      GROUP BY ${groupByCols.join(', ')}
      ORDER BY ${orderByCols.join(', ')}
    `;

    const rawRows = this.db.all<{
      bucket?: string;
      agent_id?: string | null;
      provider_id?: string | null;
      model_id?: string | null;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
      event_count: number;
      unknown_tokens_count: number;
      unknown_cost_count: number;
    }>(groupSql, groupQueryParams);

    const isOnlyTimeBucket =
      hasBucket && !hasAgent && !hasProvider && !hasModel;

    let groups: UsageGroupRowDto[];

    if (isOnlyTimeBucket) {
      // Generate full sequence of zero-activity buckets
      const generatedBuckets = generateTimeBuckets(
        timeBucket,
        fromDate,
        toDate,
        offsetModifier,
      );

      const dbMap = new Map<string, UsageGroupRowDto>();
      for (const row of rawRows) {
        if (row.bucket) {
          const inTokens = Math.round(Number(row.input_tokens));
          const outTokens = Math.round(Number(row.output_tokens));
          dbMap.set(row.bucket, {
            bucket: row.bucket,
            inputTokens: inTokens,
            outputTokens: outTokens,
            totalTokens: inTokens + outTokens,
            costUsd: roundCost(Number(row.cost_usd)),
            eventCount: Number(row.event_count),
            unknownTokensEventCount: Number(row.unknown_tokens_count),
            unknownCostEventCount: Number(row.unknown_cost_count),
          });
        }
      }

      groups = generatedBuckets.map((b) => {
        const found = dbMap.get(b);
        if (found) {
          return found;
        }
        return {
          bucket: b,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          eventCount: 0,
          unknownTokensEventCount: 0,
          unknownCostEventCount: 0,
        };
      });

      // Append any bucket returned by SQL outside the generated range
      for (const [k, v] of dbMap.entries()) {
        if (!generatedBuckets.includes(k)) {
          groups.push(v);
        }
      }
      groups.sort((a, b) => (a.bucket ?? '').localeCompare(b.bucket ?? ''));
    } else {
      groups = rawRows.map((row) => {
        const inTokens = Math.round(Number(row.input_tokens));
        const outTokens = Math.round(Number(row.output_tokens));
        const item: UsageGroupRowDto = {
          ...(hasBucket && { bucket: row.bucket }),
          ...(hasAgent && { agentId: row.agent_id ?? null }),
          ...(hasProvider && { providerId: row.provider_id ?? null }),
          ...(hasModel && { modelId: row.model_id ?? null }),
          inputTokens: inTokens,
          outputTokens: outTokens,
          totalTokens: inTokens + outTokens,
          costUsd: roundCost(Number(row.cost_usd)),
          eventCount: Number(row.event_count),
          unknownTokensEventCount: Number(row.unknown_tokens_count),
          unknownCostEventCount: Number(row.unknown_cost_count),
        };
        return item;
      });
    }

    return {
      timeRange: { from: effectiveFrom, to: effectiveTo },
      timeZone: timeZoneName,
      totals,
      groups,
    };
  }

  /**
   * Parses and validates client-supplied groupBy parameters against the whitelist.
   */
  private parseGroupBy(raw?: string | string[] | null): GroupByDimension[] {
    if (!raw) {
      return [];
    }
    const items: string[] = [];
    if (typeof raw === 'string') {
      items.push(...raw.split(',').map((s) => s.trim()));
    } else if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === 'string') {
          items.push(...item.split(',').map((s) => s.trim()));
        } else {
          items.push(String(item).trim());
        }
      }
    }

    const unique = Array.from(new Set(items.filter(Boolean)));
    const allowed = ALLOWED_GROUP_BY_DIMENSIONS as readonly string[];

    for (const dim of unique) {
      if (!allowed.includes(dim)) {
        throw new BadRequestException(
          `Unknown groupBy value: "${dim}". Allowed values are: ${ALLOWED_GROUP_BY_DIMENSIONS.join(', ')}.`,
        );
      }
    }

    return unique as GroupByDimension[];
  }

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
