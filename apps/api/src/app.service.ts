import { Injectable } from '@nestjs/common';

export interface HealthStatus {
  status: 'ok';
  service: string;
  uptimeSeconds: number;
  timestamp: string;
}

@Injectable()
export class AppService {
  private readonly startedAt = Date.now();

  getHello(): string {
    return 'Glassbeetle API';
  }

  getHealth(): HealthStatus {
    return {
      status: 'ok',
      service: 'glassbeetle-api',
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    };
  }
}
