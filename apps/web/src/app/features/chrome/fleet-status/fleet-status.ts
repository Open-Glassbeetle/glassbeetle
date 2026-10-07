import { Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';

import { readinessOf } from '../../../core/agents/agent-readiness';
import { CapabilitiesService } from '../../../core/platform/capabilities.service';
import { AgentRosterService } from '../../../core/workspace/agent-roster.service';
import { AgentAvatar } from '../../agents/agent-avatar/agent-avatar';

/** How many agents needing attention are shown before collapsing to a count. */
const SHOWN = 3;

/** Circumference of the progress ring, for the dash offset below. */
const RING = 2 * Math.PI * 7;

/**
 * The fleet, in the window chrome.
 *
 * The rail already lists the agents, but the rail collapses and the chrome
 * never does — so this is what remains when the window is narrow or the rail
 * is closed. It is not a second roster: it answers one question, *is the fleet
 * ready*, and surfaces only the agents that are not.
 *
 * Everything here is derived from the roster that is already loaded, so it
 * costs no extra request.
 */
@Component({
  selector: 'app-fleet-status',
  imports: [AgentAvatar, MatTooltipModule],
  template: `
    <div class="fleet" [class.fleet--settled]="settled()">
      <button
        class="fleet__gauge"
        type="button"
        [matTooltip]="summary()"
        matTooltipPosition="below"
        (click)="openRoster()"
      >
        <svg class="ring" viewBox="0 0 18 18" aria-hidden="true">
          <circle class="ring__track" cx="9" cy="9" r="7" />
          <circle
            class="ring__value"
            cx="9"
            cy="9"
            r="7"
            [style.stroke-dasharray]="circumference"
            [style.stroke-dashoffset]="dashOffset()"
          />
        </svg>
        <span class="fleet__count mono">
          {{ roster.readyCount() }}<span class="fleet__of">/{{ roster.total() }}</span>
        </span>
        <span class="sr-only">{{ summary() }}</span>
      </button>

      @if (attention().length) {
        <span class="fleet__divider" aria-hidden="true"></span>

        <div class="fleet__agents">
          @for (entry of shown(); track entry.agent.id) {
            <button
              class="fleet__agent"
              type="button"
              [matTooltip]="entry.agent.name + ' · ' + entry.readiness.label"
              matTooltipPosition="below"
              (click)="open(entry.agent.id)"
            >
              <app-agent-avatar
                [name]="entry.agent.name"
                [hasPicture]="entry.agent.hasPicture"
                size="small"
              />
            </button>
          }

          @if (overflow() > 0) {
            <button
              class="fleet__more mono"
              type="button"
              [matTooltip]="overflow() + ' more need attention'"
              matTooltipPosition="below"
              (click)="openRoster()"
            >
              +{{ overflow() }}
            </button>
          }
        </div>
      }
    </div>
  `,
  styleUrl: './fleet-status.scss',
})
export class FleetStatus {
  private readonly router = inject(Router);
  private readonly capabilities = inject(CapabilitiesService);

  protected readonly roster = inject(AgentRosterService);
  protected readonly circumference = RING;

  private readonly entries = computed(() => {
    const context = { modelsAvailable: this.capabilities.modelsAvailable() };

    return this.roster.agents().map((agent) => ({
      agent,
      readiness: readinessOf(agent, context),
    }));
  });

  /** Agents with something still to fix, worst first. */
  protected readonly attention = computed(() =>
    this.entries()
      .filter((entry) => entry.readiness.level !== 'ready')
      .sort((a, b) => (a.readiness.level === 'blocked' ? -1 : 1)),
  );

  protected readonly shown = computed(() => this.attention().slice(0, SHOWN));
  protected readonly overflow = computed(() => Math.max(this.attention().length - SHOWN, 0));

  /** True when there is nothing to act on, which the ring renders calmly. */
  protected readonly settled = computed(
    () => this.roster.loaded() && this.attention().length === 0,
  );

  private readonly fraction = computed(() => {
    const total = this.roster.total();
    return total === 0 ? 0 : this.roster.readyCount() / total;
  });

  protected readonly dashOffset = computed(() => RING * (1 - this.fraction()));

  protected readonly summary = computed(() => {
    if (!this.roster.loaded()) {
      return 'Loading the fleet…';
    }

    const total = this.roster.total();
    if (total === 0) {
      return 'No agents in this workspace yet';
    }

    const outstanding = this.attention().length;
    return outstanding === 0
      ? `All ${total} agents configured`
      : `${this.roster.readyCount()} of ${total} configured · ${outstanding} need attention`;
  });

  protected open(agentId: string): void {
    void this.router.navigate(['/agents', agentId]);
  }

  protected openRoster(): void {
    void this.router.navigate(['/agents']);
  }
}
