import { Injectable, Optional } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';

export type HealthState = 'ok' | 'degraded';
export type ComponentStatus = 'up' | 'down' | 'not_configured';

export interface DatabaseHealth {
  status: ComponentStatus;
  error?: string;
}

export interface HealthChecks {
  database: DatabaseHealth;
}

export interface HealthStatus {
  status: HealthState;
  service: string;
  uptimeSeconds: number;
  timestamp: string;
  checks: HealthChecks;
}

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  constructor(
    @Optional() private readonly databaseService?: DatabaseService,
  ) {}

  getHealth(): HealthStatus {
    const dbHealth = this.checkDatabase();
    const isHealthy = dbHealth.status === 'up';

    return {
      status: isHealthy ? 'ok' : 'degraded',
      service: 'glassbeetle-api',
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      checks: {
        database: dbHealth,
      },
    };
  }

  private checkDatabase(): DatabaseHealth {
    if (
      !this.databaseService ||
      typeof this.databaseService.get !== 'function'
    ) {
      return { status: 'not_configured' };
    }

    try {
      this.databaseService.get('SELECT 1');
      return { status: 'up' };
    } catch (error) {
      return {
        status: 'down',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
