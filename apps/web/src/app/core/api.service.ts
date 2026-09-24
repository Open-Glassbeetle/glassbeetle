import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';

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

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl;

  getHealth(): Observable<HealthStatus> {
    return this.http.get<HealthStatus>(`${this.baseUrl}/health`);
  }
}
