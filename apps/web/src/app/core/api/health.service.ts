import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, catchError, of, throwError } from 'rxjs';

import { ApiClient } from './api-base';

export type HealthState = 'ok' | 'degraded';
export type ComponentStatus = 'up' | 'down' | 'not_configured';

export interface DatabaseHealth {
  readonly status: ComponentStatus;
  readonly error?: string;
}

export interface HealthChecks {
  readonly database: DatabaseHealth;
}

export interface HealthStatus {
  readonly status: HealthState;
  readonly service: string;
  readonly uptimeSeconds: number;
  readonly timestamp: string;
  readonly checks: HealthChecks;
}

function isHealthStatus(value: unknown): value is HealthStatus {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as HealthStatus).status === 'string' &&
    typeof (value as HealthStatus).service === 'string'
  );
}

@Injectable({ providedIn: 'root' })
export class HealthService extends ApiClient {
  /**
   * Reads `GET /api/v1/health`.
   *
   * The endpoint answers `503` when a dependency check fails, but the body is
   * still a complete `HealthStatus` describing *which* check failed. That is
   * the most useful thing the UI can show, so a 503 carrying a valid body is
   * recovered into a normal emission; only a request that never produced one
   * (API down, CORS) is surfaced as an error.
   */
  getHealth(): Observable<HealthStatus> {
    return this.http.get<HealthStatus>(this.url('/health')).pipe(
      catchError((error: unknown) => {
        if (
          error instanceof HttpErrorResponse &&
          error.status === 503 &&
          isHealthStatus(error.error)
        ) {
          return of(error.error);
        }

        return throwError(() => error);
      }),
    );
  }
}
