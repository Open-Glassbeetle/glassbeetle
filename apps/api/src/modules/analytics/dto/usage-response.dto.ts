import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Bounds of the effective time range over `occurred_at`.
 */
export class UsageTimeRangeDto {
  @ApiProperty({
    description: 'Inclusive start of the queried time range in ISO-8601 format',
    example: '2026-10-15T00:00:00.000Z',
  })
  readonly from!: string;

  @ApiProperty({
    description: 'Inclusive end of the queried time range in ISO-8601 format',
    example: '2026-11-14T23:59:59.999Z',
  })
  readonly to!: string;
}

/**
 * Aggregated usage totals across events matching the query criteria.
 */
export class UsageTotalsDto {
  @ApiProperty({
    type: 'integer',
    description:
      'Total number of input/prompt tokens consumed across matching events. Null token counts are excluded from this sum and counted in `unknownTokensEventCount`.',
    example: 12500,
  })
  readonly inputTokens!: number;

  @ApiProperty({
    type: 'integer',
    description:
      'Total number of output/completion tokens consumed across matching events. Null token counts are excluded from this sum and counted in `unknownTokensEventCount`.',
    example: 4200,
  })
  readonly outputTokens!: number;

  @ApiProperty({
    type: 'integer',
    description: 'Combined sum of all input and output tokens consumed.',
    example: 16700,
  })
  readonly totalTokens!: number;

  @ApiProperty({
    type: Number,
    description:
      'Total cost in US dollars, summed from `usage_events.cost_usd`. Null costs are excluded from this sum and counted in `unknownCostEventCount`.',
    example: 0.2541,
  })
  readonly costUsd!: number;

  @ApiProperty({
    type: 'integer',
    description:
      'Total number of usage events matching the time range and filter parameters.',
    example: 48,
  })
  readonly eventCount!: number;

  @ApiProperty({
    type: 'integer',
    description:
      'Count of matching events whose provider did not report token usage (input_tokens or output_tokens was null). Distinguishes unmeasured usage from zero-token operations.',
    example: 2,
  })
  readonly unknownTokensEventCount!: number;

  @ApiProperty({
    type: 'integer',
    description:
      'Count of matching events whose monetary cost was not recorded (cost_usd was null).',
    example: 3,
  })
  readonly unknownCostEventCount!: number;
}

/**
 * Aggregated metrics for a single group in the breakdown.
 */
export class UsageGroupRowDto {
  @ApiPropertyOptional({
    description:
      'Time bucket identifier when grouped by a time bucket: YYYY-MM-DD for day, YYYY-Www for week, YYYY-MM for month.',
    example: '2026-11-14',
  })
  readonly bucket?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Identifier of the agent associated with this group. Set to null when the agent was deleted or never assigned.',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  readonly agentId?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Identifier of the provider associated with this group. Set to null when the provider was deleted or never assigned.',
    example: '018f3a9e-0000-7000-8000-000000000002',
  })
  readonly providerId?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Identifier of the model associated with this group. Set to null when the model was deleted or never assigned.',
    example: '018f3a9e-0000-7000-8000-000000000003',
  })
  readonly modelId?: string | null;

  @ApiProperty({
    type: 'integer',
    description: 'Total number of input tokens consumed in this group.',
    example: 1250,
  })
  readonly inputTokens!: number;

  @ApiProperty({
    type: 'integer',
    description: 'Total number of output tokens consumed in this group.',
    example: 420,
  })
  readonly outputTokens!: number;

  @ApiProperty({
    type: 'integer',
    description: 'Combined total tokens consumed in this group.',
    example: 1670,
  })
  readonly totalTokens!: number;

  @ApiProperty({
    type: Number,
    description: 'Total cost in US dollars for this group.',
    example: 0.025,
  })
  readonly costUsd!: number;

  @ApiProperty({
    type: 'integer',
    description: 'Total number of usage events in this group.',
    example: 5,
  })
  readonly eventCount!: number;

  @ApiProperty({
    type: 'integer',
    description:
      'Number of events in this group with unmeasured tokens (null input_tokens or output_tokens).',
    example: 0,
  })
  readonly unknownTokensEventCount!: number;

  @ApiProperty({
    type: 'integer',
    description:
      'Number of events in this group with unrecorded cost (null cost_usd).',
    example: 0,
  })
  readonly unknownCostEventCount!: number;
}

/**
 * Response payload for `GET /api/v1/analytics/usage`.
 *
 * ## Key Contract Principles:
 * 1. **Flat Breakdown List**:
 *    Multi-dimension grouping produces a flat list of `groups`, with group keys
 *    present for each requested dimension. This simplifies frontend consumption
 *    and graphing.
 * 2. **Accompanying Overall Totals**:
 *    Overall totals across the entire filtered range are always supplied in `totals`,
 *    providing immediate answers to "what did I spend in total" and reconciling
 *    with the sum of all `groups`.
 * 3. **Null Foreign Key Accounting (Deleted Entities)**:
 *    When a referenced entity (agent, provider, model) is deleted, SQLite's foreign
 *    key action (`ON DELETE SET NULL`) preserves historical events with a null reference.
 *    Grouping by that entity preserves the row with key `null` (e.g. `agentId: null`).
 *    This ensures that past spend is never dropped and group totals strictly reconcile
 *    to the overall totals.
 * 4. **Zero-Activity Time Buckets**:
 *    When grouping solely by a time bucket (`day`, `week`, `month`), all intervals in
 *    the queried range `[from, to]` appear in `groups` in chronological order. Intervals
 *    with no recorded events return with zeroes for counts, tokens, and costs,
 *    ensuring that time-series charts display a continuous timeline without gaps.
 */
export class UsageResponseDto {
  @ApiProperty({
    description: 'Effective time range bounds for the aggregation.',
    type: UsageTimeRangeDto,
  })
  readonly timeRange!: UsageTimeRangeDto;

  @ApiProperty({
    description:
      'Resolved time zone used for time bucketing (e.g. "UTC" or "Europe/Zurich").',
    example: 'UTC',
  })
  readonly timeZone!: string;

  @ApiProperty({
    description:
      'Overall aggregated totals across the entire matching range and filter set.',
    type: UsageTotalsDto,
  })
  readonly totals!: UsageTotalsDto;

  @ApiProperty({
    description:
      'Breakdown rows grouped by the requested `groupBy` dimensions, or empty array if no grouping was requested.',
    type: [UsageGroupRowDto],
  })
  readonly groups!: UsageGroupRowDto[];
}
