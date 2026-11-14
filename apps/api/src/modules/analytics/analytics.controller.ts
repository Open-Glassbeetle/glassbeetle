import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../common/http/api-error.js';
import { AnalyticsService } from './analytics.service.js';
import { ActivityQueryDto } from './dto/activity-query.dto.js';
import { ActivityResponseDto } from './dto/activity-response.dto.js';
import { UsageQueryDto } from './dto/usage-query.dto.js';
import { UsageResponseDto } from './dto/usage-response.dto.js';

/**
 * Controller exposing the `/analytics` endpoints.
 *
 * Provides query access to `usage_events`, the append-only log of domain
 * events and LLM token and cost telemetry.
 */
@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * `GET /api/v1/analytics/usage` — aggregated token and cost totals over `usage_events`.
   *
   * Aggregates input tokens, output tokens, monetary cost in USD, and event counts.
   * Supports filtering by time range (`from`, `to`), `agentId`, `providerId`, `modelId`,
   * and `eventType`.
   *
   * Grouping can be requested across `agent`, `provider`, `model`, and time buckets
   * (`day`, `week`, `month`).
   */
  @Get('usage')
  @ApiOperation({
    summary: 'Retrieve aggregated usage metrics (tokens, costs, and events)',
    description: `Returns aggregated token usage, cost in USD, and event counts over \`usage_events\`.

Supports filtering by time range (\`from\`, \`to\`), \`agentId\`, \`providerId\`, \`modelId\`, and \`eventType\`.
Supports grouping by \`agent\`, \`provider\`, \`model\`, and time buckets (\`day\`, \`week\`, \`month\`).

Overall totals accompany the response in the \`totals\` object.
Groups where the referenced agent, provider, or model was deleted are represented with a null reference key (e.g. \`agentId: null\`), preserving complete spend accounting so grouped totals reconcile exactly to overall totals.
When grouping solely by a time bucket, zero-activity intervals are included with zero totals to maintain contiguous chart axes.`,
  })
  @ApiOkResponse({
    description: 'Aggregated usage totals and optional grouped breakdown',
    type: UsageResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid query parameters, unknown groupBy dimension, inverted time range, or bucket limit exceeded',
    type: ApiErrorResponseDto,
  })
  public async getUsage(
    @Query() query: UsageQueryDto,
  ): Promise<UsageResponseDto> {
    return this.analyticsService.getUsage(query);
  }

  /**
   * `GET /api/v1/analytics/activity` — aggregated activity timeline over `usage_events`.
   *
   * Aggregates event counts over time buckets (hour, day, week, month), broken down
   * by event type. Supports filtering by time range (`from`, `to`), `eventType`,
   * `agentId`, `providerId`, and `modelId`.
   *
   * Zero-activity time buckets are included with zero counts to provide a contiguous
   * timeline for frontend charting.
   */
  @Get('activity')
  @ApiOperation({
    summary:
      'Retrieve aggregated activity time series (event counts over time)',
    description: `Returns an aggregated time series of event counts over time buckets (hour, day, week, month), broken down by event type.

Supports filtering by time range (\`from\`, \`to\`), \`eventType\`, \`agentId\`, \`providerId\`, and \`modelId\`.
Zero-activity time buckets are included with zero counts to preserve chart continuity.
Overall summary totals accompany the series in the \`totals\` object.`,
  })
  @ApiOkResponse({
    description: 'Aggregated activity time series and summary totals',
    type: ActivityResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid query parameters, unknown interval, inverted time range, or bucket limit exceeded',
    type: ApiErrorResponseDto,
  })
  public async getActivity(
    @Query() query: ActivityQueryDto,
  ): Promise<ActivityResponseDto> {
    return this.analyticsService.getActivity(query);
  }
}
