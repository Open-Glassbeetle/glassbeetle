import { DOCUMENT } from '@angular/common';
import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { finalize } from 'rxjs';

import { HealthService, type HealthStatus } from '../../core/api/health.service';
import { describeApiError, toApiError } from '../../core/api/api-error';

export type ConnectionState = 'checking' | 'online' | 'degraded' | 'offline';

/**
 * How often a visible window re-checks the API while it is answering.
 *
 * 30 seconds is the compromise: fast enough that stopping `npm run dev:api`
 * shows up while the user is still looking at the window, slow enough that a
 * session left open all day sends a couple of hundred tiny requests rather
 * than thousands. Anything faster would wake a laptop more often than it
 * reports something new.
 */
const POLL_INTERVAL_MS = 30_000;

/**
 * The first retry once the API is unreachable, doubled per consecutive
 * failure up to `OFFLINE_MAX_MS`.
 *
 * A port with nothing listening answers instantly, so retrying at the poll
 * interval would be the same work in less time. Backing off keeps a dead API
 * cheap to wait for; recovery still arrives within a few seconds of the first
 * failure.
 */
const OFFLINE_BASE_MS = 5_000;
const OFFLINE_MAX_MS = 60_000;

/**
 * Shared backend-reachability state.
 *
 * Kept in a root service rather than in a component because two places show it
 * ??the toolbar indicator and the dashboard ??and they must not run two
 * independent health checks that can disagree.
 *
 * The service owns the schedule as well as the state: a visible window polls
 * every `POLL_INTERVAL_MS`, a hidden one does not poll at all, and while the
 * API is down the retries back off. Requests elsewhere in the app report
 * their failures through `reportRequestFailure`, so the indicator reacts to
 * what the application already learned rather than waiting for its own check.
 */
@Injectable({ providedIn: 'root' })
export class ApiStatusService implements OnDestroy {
  private readonly healthService = inject(HealthService);
  private readonly document = inject(DOCUMENT);

  private readonly _health = signal<HealthStatus | null>(null);
  private readonly _error = signal<string | null>(null);
  private readonly _state = signal<ConnectionState>('checking');
  private readonly _lastCheckedAt = signal<Date | null>(null);

  readonly health = this._health.asReadonly();
  readonly error = this._error.asReadonly();
  readonly state = this._state.asReadonly();
  readonly lastCheckedAt = this._lastCheckedAt.asReadonly();

  readonly reachable = computed(() => this._state() === 'online' || this._state() === 'degraded');

  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private started = false;
  private consecutiveFailures = 0;

  private readonly onVisibilityChange = (): void => {
    if (this.document.visibilityState === 'hidden') {
      // A background window has no one looking at the indicator, so it has no
      // reason to keep a laptop awake asking.
      this.clearTimer();
      return;
    }

    if (!this.started) {
      return;
    }

    this.clearTimer();
    this.check();
  };

  constructor() {
    this.document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  ngOnDestroy(): void {
    this.started = false;
    this.clearTimer();
    this.document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  /**
   * Checks now and starts (or restarts) the polling schedule.
   *
   * Called by the shell at startup and by the manual refresh action, which is
   * why it announces `checking`: the user asked, so showing that something is
   * happening is the honest response. The scheduled polls do not announce, or
   * the indicator would flicker every 30 seconds.
   */
  refresh(): void {
    this.started = true;
    this.consecutiveFailures = 0;
    this.clearTimer();
    this._state.set('checking');
    this._error.set(null);
    this.check();
  }

  /**
   * Records a failure another request already hit.
   *
   * `ApiError.offline` is the signal: a status of 0 means the request never
   * reached the API, so the connection state is wrong and the indicator should
   * say so now rather than at the next scheduled check. A response the API did
   * send ??even a 500 ??proves it is reachable and must not move the state.
   */
  reportRequestFailure(error: unknown): void {
    const apiError = toApiError(error);

    if (!apiError.offline) {
      return;
    }

    const wasOffline = this._state() === 'offline';
    this.setOffline(describeApiError(apiError));

    if (wasOffline || !this.started) {
      return;
    }

    // Retry sooner than the regular poll, but only once per transition: while
    // offline the schedule is already running at the backed-off rate.
    this.consecutiveFailures = Math.max(this.consecutiveFailures, 1);
    this.scheduleNext();
  }

  private check(): void {
    // A slow API must not queue checks behind each other. The in-flight flag
    // makes a tick a no-op rather than a second request.
    if (this.inFlight) {
      return;
    }

    this.inFlight = true;

    this.healthService
      .getHealth()
      .pipe(
        finalize(() => {
          this.inFlight = false;
          this.scheduleNext();
        }),
      )
      .subscribe({
        next: (health) => {
          this.consecutiveFailures = 0;
          this._health.set(health);
          this._error.set(null);
          this._state.set(health.status === 'ok' ? 'online' : 'degraded');
          this._lastCheckedAt.set(new Date());
        },
        error: (error: unknown) => {
          this.consecutiveFailures += 1;
          this.setOffline(describeApiError(toApiError(error)));
          this._lastCheckedAt.set(new Date());
        },
      });
  }

  private setOffline(message: string): void {
    this._health.set(null);
    this._error.set(message);
    this._state.set('offline');
  }

  private scheduleNext(): void {
    this.clearTimer();

    if (!this.started || this.document.visibilityState === 'hidden') {
      return;
    }

    const delay =
      this._state() === 'offline' ? this.offlineDelay() : POLL_INTERVAL_MS;

    this.timer = setTimeout(() => {
      this.timer = null;
      this.check();
    }, delay);
  }

  /** 5s, 10s, 20s, 40s, then a steady minute. */
  private offlineDelay(): number {
    const step = Math.min(Math.max(this.consecutiveFailures - 1, 0), 4);
    return Math.min(OFFLINE_BASE_MS * 2 ** step, OFFLINE_MAX_MS);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
