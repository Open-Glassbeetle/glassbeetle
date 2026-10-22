import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';

/**
 * Will wire the `/analytics` resource.
 *
 * A placeholder: no routes and no service implementation. `usage_events`,
 * the table it reports on, is read today only by `BudgetService` and is
 * written by nothing.
 */
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService]
})
export class AnalyticsModule {}
