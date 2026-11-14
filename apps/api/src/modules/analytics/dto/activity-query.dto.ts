import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { USAGE_EVENT_TYPES } from '../usage-event.types.js';

/**
 * Whitelist of time bucket intervals accepted by the activity endpoint.
 */
export const ALLOWED_ACTIVITY_INTERVALS = [
  'hour',
  'day',
  'week',
  'month',
] as const;

export type ActivityInterval = (typeof ALLOWED_ACTIVITY_INTERVALS)[number];

/**
 * Query parameters for `GET /api/v1/analytics/activity`.
 */
export class ActivityQueryDto {
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
      'Inclusive end of the queried time range over `occurred_at` as an ISO-8601 timestamp. Defaults to the current instant (`now`).',
    example: '2026-11-14T23:59:59.999Z',
  })
  @IsOptional()
  @IsString()
  readonly to?: string;

  @ApiPropertyOptional({
    description:
      'Time bucket interval: hour, day, week, or month. Defaults to "day".',
    enum: ALLOWED_ACTIVITY_INTERVALS,
    example: 'day',
    default: 'day',
  })
  @IsOptional()
  @IsString()
  readonly interval?: string;

  @ApiPropertyOptional({
    description: 'Filter events by canonical event type',
    enum: Object.values(USAGE_EVENT_TYPES),
    example: 'chat_completion',
  })
  @IsOptional()
  @IsString()
  readonly eventType?: string;

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
    description:
      'Time zone used for time bucketing. Can be "UTC", a valid IANA timezone name (e.g. "Europe/Zurich"), or an offset (e.g. "+02:00"). Defaults to user profile timezone or UTC.',
    example: 'Europe/Zurich',
  })
  @IsOptional()
  @IsString()
  readonly timezone?: string;
}

