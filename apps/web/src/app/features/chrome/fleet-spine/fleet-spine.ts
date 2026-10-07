import { Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';

import { readinessOf } from '../../../core/agents/agent-readiness';
import { CapabilitiesService } from '../../../core/platform/capabilities.service';
import { AgentRosterService } from '../../../core/workspace/agent-roster.service';
import { ApiStatusService } from '../../api-status/api-status.service';

interface Band {
  readonly level: 'ready' | 'unguided' | 'blocked';
  readonly share: number;
}

/**
 * The deck's bottom edge, carrying the state of the workspace.
 *
 * It occupies the two pixels a border would have taken anyway, so it costs no
 * height and adds no control — but it means the chrome is never merely
 * decorative: at a glance, across every screen, the line says how much of the
 * fleet is configured and whether the backend is answering.
 *
 * Proportional rather than one segment per agent, so it reads the same with
 * three agents as with ninety.
 */
@Component({
  selector: 'app-fleet-spine',
  imports: [MatTooltipModule],
  template: `
    <div
      class="spine"
      [class.spine--offline]="offline()"
      [class.spine--waiting]="waiting()"
      [matTooltip]="summary()"
      matTooltipPosition="below"
      role="img"
      [attr.aria-label]="summary()"
    >
      @for (band of bands(); track band.level) {
        <span class="band" [class]="'band--' + band.level" [style.flex-grow]="band.share"></span>
      }
    </div>
  `,
  styleUrl: './fleet-spine.scss',
})
export class FleetSpine {
  private readonly capabilities = inject(CapabilitiesService);
  private readonly roster = inject(AgentRosterService);
  private readonly status = inject(ApiStatusService);

  /** A backend that cannot be reached makes every other reading meaningless. */
  protected readonly offline = computed(() => this.status.state() === 'offline');

  protected readonly waiting = computed(
    () => this.status.state() === 'checking' || !this.roster.loaded(),
  );

  protected readonly bands = computed<readonly Band[]>(() => {
    const context = { modelsAvailable: this.capabilities.modelsAvailable() };
    const levels = this.roster.agents().map((agent) => readinessOf(agent, context).level);

    if (levels.length === 0) {
      return [{ level: 'unguided', share: 1 }];
    }

    const count = (level: Band['level']) => levels.filter((entry) => entry === level).length;

    return (['ready', 'unguided', 'blocked'] as const)
      .map((level) => ({ level, share: count(level) }))
      .filter((band) => band.share > 0);
  });

  protected readonly summary = computed(() => {
    if (this.offline()) {
      return 'The API cannot be reached';
    }

    if (!this.roster.loaded()) {
      return 'Reading the workspace…';
    }

    const total = this.roster.total();
    if (total === 0) {
      return 'No agents in this workspace yet';
    }

    return `${this.roster.readyCount()} of ${total} agents configured`;
  });
}
