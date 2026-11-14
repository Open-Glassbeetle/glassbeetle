import { ApiProperty } from '@nestjs/swagger';

/**
 * Bounds of the effective time range over `occurred_at`.
 */
export class ActivityTimeRangeDto {
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
 * Aggregated overall activity totals across the entire queried period.
 */
export class ActivityTotalsDto {
  @ApiProperty({
    type: 'integer',
    description:
      'Total number of events matching the time range and filter parameters.',
    example: 42,
  })
  readonly totalCount!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'integer' },
    description:
      'Breakdown of event counts by event type across the entire queried period.',
    example: {
      chat_completion: 35,
      chat_compaction: 2,
      agent_created: 1,
      artifact_created: 4,
    },
  })
  readonly byEventType!: Record<string, number>;
}

/**
 * Activity counts for a single time bucket in the time series.
 */
export class ActivityBucketDto {
  @ApiProperty({
    description:
      'Identifier of the time bucket: YYYY-MM-DDTHH:00 for hour, YYYY-MM-DD for day, YYYY-Www for week, YYYY-MM for month.',
    example: '2026-11-14',
  })
  readonly bucket!: string;

  @ApiProperty({
    type: 'integer',
    description:
      'Total number of events recorded inside this time bucket. Zero for inactive intervals.',
    example: 7,
  })
  readonly totalCount!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'integer' },
    description:
      'Breakdown of event counts by event type for this time bucket. Every known canonical event type is present with a count (zero if inactive).',
    example: {
      chat_completion: 5,
      chat_compaction: 0,
      agent_created: 1,
      artifact_created: 1,
    },
  })
  readonly byEventType!: Record<string, number>;
}

/**
 * Response payload for `GET /api/v1/analytics/activity`.
 *
 * ## Key Contract Principles & Design Decisions:
 *
 * 1. **Time Series vs Feed Decision**:
 *    This endpoint implements a **Time Series of Aggregated Counts** rather than
 *    an individual event feed.
 *    *Justification*: The motivation of the activity endpoint is answering
 *    "what has been going on" over time — powering dashboard charts, usage trends,
 *    and activity histograms. Aggregating into time buckets with `COUNT` and
 *    `GROUP BY` scales efficiently over large event logs and matches the requested
 *    `interval` parameter (`hour`, `day`, `week`, `month`). A feed of individual events
 *    cannot power a trend chart without transferring unbounded rows to the client.
 *
 * 2. **Event Type Breakdown (`byEventType`)**:
 *    Within each bucket, counts are broken down by event type. All canonical types
 *    from `USAGE_EVENT_TYPES` (`chat_completion`, `chat_compaction`, `agent_created`,
 *    `artifact_created`) are pre-populated with at least `0`, alongside any additional
 *    types discovered in the data. This allows frontend visualization libraries to reliably
 *    map series without null-checking missing keys.
 *
 * 3. **Overall Totals**:
 *    The top-level `totals` property provides the global event count and event type
 *    breakdown across the full time range. The sum of bucket counts in `series` reconciles
 *    identically to `totals`.
 *
 * 4. **Zero-Activity Time Buckets**:
 *    All time intervals between `from` and `to` appear in `series` in chronological order.
 *    Intervals with no recorded events are generated with `totalCount: 0` and all event type
 *    counts at 0. This ensures that time-series line, bar, and area charts have continuous
 *    time axes without artificial gaps.
 */
export class ActivityResponseDto {
  @ApiProperty({
    description: 'Effective time range bounds for the activity aggregation.',
    type: ActivityTimeRangeDto,
  })
  readonly timeRange!: ActivityTimeRangeDto;

  @ApiProperty({
    description:
      'Resolved time zone used for time bucketing (e.g. "UTC" or "Europe/Zurich").',
    example: 'UTC',
  })
  readonly timeZone!: string;

  @ApiProperty({
    description:
      'Time bucket granularity applied to the series: hour, day, week, or month.',
    example: 'day',
  })
  readonly interval!: string;

  @ApiProperty({
    description:
      'Overall aggregated event totals across the entire matching range and filter set.',
    type: ActivityTotalsDto,
  })
  readonly totals!: ActivityTotalsDto;

  @ApiProperty({
    description:
      'Chronological sequence of time buckets containing event counts broken down by event type. Zero-activity intervals are included.',
    type: [ActivityBucketDto],
  })
  readonly series!: ActivityBucketDto[];
}
