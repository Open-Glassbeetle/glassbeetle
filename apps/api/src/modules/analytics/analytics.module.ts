import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';

/**
 * Wires the `/analytics` resource and usage telemetry aggregation path.
 *
 * Exposes {@link AnalyticsController} and exports {@link AnalyticsService}.
 * Imports {@link UserModule} to resolve the user-configured time zone for
 * time-bucketing aggregations.
 */
@Module({
  imports: [UserModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
