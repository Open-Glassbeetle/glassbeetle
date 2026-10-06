import { Injectable, computed, inject, signal } from '@angular/core';

import { AgentsService } from '../api/agents.service';
import type { Agent } from '../api/agents.models';
import { readinessOf } from '../agents/agent-readiness';
import { CapabilitiesService } from '../platform/capabilities.service';

/**
 * The agents shown in the navigation rail.
 *
 * Held in a root service rather than fetched per screen because the roster is
 * part of the shell: it is on screen on every route, and refetching it on each
 * navigation would make the rail flicker. Screens that change an agent call
 * `refresh()` so the rail does not go stale.
 */
@Injectable({ providedIn: 'root' })
export class AgentRosterService {
  private readonly api = inject(AgentsService);
  private readonly capabilities = inject(CapabilitiesService);

  private readonly _agents = signal<readonly Agent[]>([]);
  private readonly _loading = signal(false);
  private readonly _loaded = signal(false);

  readonly agents = this._agents.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  readonly total = computed(() => this._agents().length);

  readonly readyCount = computed(
    () => this._agents().filter((agent) => readinessOf(agent).level === 'ready').length,
  );

  /** Agents that cannot run as configured, which the rail surfaces. */
  readonly blockedCount = computed(
    () => this._agents().filter((agent) => readinessOf(agent).level === 'blocked').length,
  );

  refresh(): void {
    this._loading.set(true);

    // The rail is a roster, not a paginated list: it shows who is in the
    // workspace. 100 is the API's ceiling for a single page and well past the
    // point where a rail stops being the right way to navigate anyway.
    this.api.list({ limit: 100, sort: 'name', order: 'asc' }).subscribe({
      next: (page) => {
        this._agents.set(page.items);
        this._loading.set(false);
        this._loaded.set(true);
      },
      error: () => {
        // The rail degrades to its navigation links; the screen the user is on
        // reports the failure in its own right.
        this._agents.set([]);
        this._loading.set(false);
        this._loaded.set(true);
      },
    });
  }
}
