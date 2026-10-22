import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

/**
 * Wires the `/health` endpoint.
 *
 * Imports `DatabaseModule` explicitly even though it is global, because the
 * health check's whole purpose is to report on that dependency and the
 * relationship should be visible in the module graph.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
