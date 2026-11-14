import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';
import { USAGE_EVENT_TYPES } from '../usage-event.types.js';

/**
 * Whitelist of dimensions client requests may group by.
 */
export const ALLOWED_GROUP_BY_DIMENSIONS = [
  'agent',
  'provider',
  'model',
  'day',
  'week',
  'month',
] as const;

export type GroupByDimension = (typeof ALLOWED_GROUP_BY_DIMENSIONS)[number];

export const TIME_BUCKET_DIMENSIONS = ['day', 'week', 'month'] as const;
export type TimeBucketDimension = (typeof TIME_BUCKET_DIMENSIONS)[number];

/**
 * Query parameters for `GET /api/v1/analytics/usage`.
 */
export class UsageQueryDto {
  @ApiPropertyOptional({
    description:
      'Inclusive start of the queried time range over `occurred_at` as an ISO-8601 timestamp. Defaults to 30 days prior to `to`.',
    example: '2026-10-15T00:00:00.000Z',
  })
  @IsOptional()
  @IsString()
  readonly from?: string;

  @ApiPropertyOptional({
    description:
      'Inclusive end of the queried time range over `occurred_at` as an ISO-8601 timestamp. Defaults to current instant (`now`).',
    example: '2026-11-14T23:59:59.999Z',
  })
  @IsOptional()
  @IsString()
  readonly to?: string;

  @ApiPropertyOptional({
    description:
      'One or more dimensions to group by. Supported values: agent, provider, model, day, week, month. May be comma-separated or supplied multiple times.',
    example: 'agent,day',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    if (Array.isArray(value)) {
      return value
        .flatMap((v: unknown) =>
          typeof v === 'string' ? v.split(',') : String(v),
        )
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
    return value;
  })
  readonly groupBy?: string | string[];

  @ApiPropertyOptional({
    description: 'Filter events by agent identifier',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @IsOptional()
  @IsString()
  readonly agentId?: string;

  @ApiPropertyOptional({
    description: 'Filter events by provider identifier',
    example: '018f3a9e-0000-7000-8000-000000000002',
  })
  @IsOptional()
  @IsString()
  readonly providerId?: string;

  @ApiPropertyOptional({
    description: 'Filter events by model identifier',
    example: '018f3a9e-0000-7000-8000-000000000003',
  })
  @IsOptional()
  @IsString()
  readonly modelId?: string;

  @ApiPropertyOptional({
    description: 'Filter events by canonical event type',
    enum: Object.values(USAGE_EVENT_TYPES),
    example: 'chat_completion',
  })
  @IsOptional()
  @IsString()
  readonly eventType?: string;

  @ApiPropertyOptional({
    description:
      'Time zone used for time bucketing. Can be "UTC", a valid IANA timezone name (e.g. "Europe/Zurich"), or an offset (e.g. "+02:00"). Defaults to user profile timezone or UTC.',
    example: 'Europe/Zurich',
  })
  @IsOptional()
  @IsString()
  readonly timezone?: string;
}

