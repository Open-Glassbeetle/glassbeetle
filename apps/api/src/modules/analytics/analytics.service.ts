import { Injectable } from '@nestjs/common';

/**
 * Will aggregate `usage_events` into usage and activity reports.
 *
 * Not implemented, and nothing writes `usage_events` yet, so any report
 * today would be empty. The frontend states this on screen rather than
 * showing invented figures.
 */
@Injectable()
export class AnalyticsService {}
