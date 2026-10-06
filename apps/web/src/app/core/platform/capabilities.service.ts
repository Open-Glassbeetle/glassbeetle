import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';

import { ApiClient } from '../api/api-base';

/**
 * Which parts of the platform the running API actually serves.
 *
 * Several NestJS modules exist with empty controllers, so their routes return
 * 404. That matters beyond hiding a nav entry: `agents.model_id` is a foreign
 * key into `models`, and the agents endpoint rejects any value that is not a
 * real model row with a 422 `MODEL_NOT_FOUND`. With no models endpoint there
 * is no way to create a model, so *no agent can be given one*.
 *
 * Without probing for this the UI would show every agent as misconfigured and
 * offer a field that can only ever fail — blaming the user for a capability
 * the backend has not shipped. The probe lets the UI say the true thing
 * instead.
 */
@Injectable({ providedIn: 'root' })
export class CapabilitiesService extends ApiClient {
  private readonly _modelsAvailable = signal(false);
  private readonly _probed = signal(false);

  /** True once a models endpoint answers, so agents can be given a model. */
  readonly modelsAvailable = this._modelsAvailable.asReadonly();
  readonly probed = this._probed.asReadonly();

  /**
   * Probes once at startup.
   *
   * A 404 means the module is not wired up yet. Any other failure — the API
   * being down, a network error — says nothing about the capability, so it is
   * treated as "unknown" and left unavailable rather than being reported as a
   * missing feature.
   */
  probe(): void {
    this.http.get(this.url('/models'), { params: { limit: 1 } }).subscribe({
      next: () => {
        this._modelsAvailable.set(true);
        this._probed.set(true);
      },
      error: (error: unknown) => {
        const status = error instanceof HttpErrorResponse ? error.status : undefined;

        this._modelsAvailable.set(false);
        // Only a definitive 404 counts as a completed probe; anything else may
        // simply mean the API was not reachable at that moment.
        this._probed.set(status === 404);
      },
    });
  }
}
