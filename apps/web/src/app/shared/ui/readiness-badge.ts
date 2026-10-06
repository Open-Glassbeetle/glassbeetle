import { Component, booleanAttribute, computed, input } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';

import type { Readiness } from '../../core/agents/agent-readiness';

/**
 * An agent's readiness, as a dot and a label.
 *
 * The dot animates only for `ready`, and slowly. A workspace that is open all
 * day should not have several things pulsing at once competing for attention;
 * the motion is there to say "this one is live", not to decorate.
 */
@Component({
  selector: 'gb-readiness-badge',
  imports: [MatTooltipModule],
  template: `
    <span
      class="badge"
      [class]="'badge--' + readiness().level"
      [class.badge--dot-only]="compact()"
      [matTooltip]="tooltip()"
    >
      <span class="badge__dot" aria-hidden="true"></span>
      @if (!compact()) {
        <span class="badge__label">{{ readiness().label }}</span>
      }
      <span class="sr-only">{{ readiness().detail }}</span>
    </span>
  `,
  styles: `
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.0625rem 0.4375rem 0.0625rem 0.375rem;
      border: 1px solid transparent;
      border-radius: 999px;
      font-size: 0.6875rem;
      font-weight: 500;
      line-height: 1.5;
      white-space: nowrap;
    }

    .badge--dot-only {
      padding: 0;
      border: 0;
      background: none !important;
    }

    .badge__dot {
      position: relative;
      flex: none;
      width: 0.4375rem;
      height: 0.4375rem;
      border-radius: 50%;
      background: currentColor;
    }

    .badge--ready {
      border-color: color-mix(in srgb, var(--gb-ready) 30%, transparent);
      background: var(--gb-ready-bg);
      color: var(--gb-ready);
    }

    // A single slow halo marks the agents that could actually be given work.
    .badge--ready .badge__dot::after {
      content: '';
      position: absolute;
      inset: -3px;
      border-radius: 50%;
      border: 1px solid currentColor;
      opacity: 0;
      animation: halo 2.8s var(--gb-ease) infinite;
    }

    .badge--unguided {
      border-color: color-mix(in srgb, var(--gb-attention) 30%, transparent);
      background: var(--gb-attention-bg);
      color: var(--gb-attention);
    }

    .badge--blocked {
      border-color: color-mix(in srgb, var(--mat-sys-error) 30%, transparent);
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-error);
    }

    @keyframes halo {
      0% {
        opacity: 0.7;
        transform: scale(0.7);
      }
      70%,
      100% {
        opacity: 0;
        transform: scale(1.7);
      }
    }
  `,
})
export class ReadinessBadge {
  readonly readiness = input.required<Readiness>();
  /** Shows only the dot, for dense rows where the label would not fit. */
  readonly compact = input(false, { transform: booleanAttribute });

  protected readonly tooltip = computed(() => {
    const readiness = this.readiness();
    return readiness.remedy ? `${readiness.detail} ${readiness.remedy}.` : readiness.detail;
  });
}
