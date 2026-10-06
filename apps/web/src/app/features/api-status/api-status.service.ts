import { Injectable, computed, inject, signal } from '@angular/core';

import { HealthService, type HealthStatus } from '../../core/api/health.service';
import { describeApiError, toApiError } from '../../core/api/api-error';

export type ConnectionState = 'checking' | 'online' | 'degraded' | 'offline';

/**
 * Shared backend-reachability state.
 *
 * Kept in a root service rather than in a component because two places show it
 * — the toolbar indicator and the dashboard — and they must not run two
 * independent health checks that can disagree.
 */
@Injectable({ providedIn: 'root' })
export class ApiStatusService {
  private readonly healthService = inject(HealthService);

  private readonly _health = signal<HealthStatus | null>(null);
  private readonly _error = signal<string | null>(null);
  private readonly _state = signal<ConnectionState>('checking');
  private readonly _lastCheckedAt = signal<Date | null>(null);

  readonly health = this._health.asReadonly();
  readonly error = this._error.asReadonly();
  readonly state = this._state.asReadonly();
  readonly lastCheckedAt = this._lastCheckedAt.asReadonly();

  readonly reachable = computed(() => this._state() === 'online' || this._state() === 'degraded');

  refresh(): void {
    this._state.set('checking');
    this._error.set(null);

    this.healthService.getHealth().subscribe({
      next: (health) => {
        this._health.set(health);
        this._state.set(health.status === 'ok' ? 'online' : 'degraded');
        this._lastCheckedAt.set(new Date());
      },
      error: (error: unknown) => {
        this._health.set(null);
        this._error.set(describeApiError(toApiError(error)));
        this._state.set('offline');
        this._lastCheckedAt.set(new Date());
      },
    });
  }
}
