import { Controller } from '@nestjs/common';

/**
 * Will expose the `/analytics` endpoints.
 *
 * No routes yet. The intended source is `usage_events`, an activity log of
 * what happened and what it cost — event type, the agent, provider, model
 * and chat involved, token counts and `cost_usd`.
 */
@Controller('analytics')
export class AnalyticsController {}
