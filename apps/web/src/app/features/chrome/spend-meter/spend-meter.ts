import { Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';

import { BUDGET_PERIOD_LABEL } from '../../../core/api/budget.models';
import { SpendService } from '../../../core/workspace/spend.service';

/** Circumference of the progress ring, for the dash offset below. */
const RING = 2 * Math.PI * 7;

/**
 * What is left of the spending budget, in the window chrome.
 *
 * Present as soon as the budget has been read, with or without a limit. It was
 * hidden until a limit was set, on the reasoning that an empty meter is a
 * standing reminder of a declined feature — which got it backwards: nobody can
 * decline something they never saw, and the deck was the only place the budget
 * was asked to appear. Without a limit it invites one; with a limit it reports.
 *
 * It stays out of the chrome while the budget has not loaded, and after a
 * failed read, rather than flashing an invitation it cannot act on.
 *
 * Everything here comes from the budget the shell already loaded, so it costs
 * no extra request.
 */
@Component({
  selector: 'app-spend-meter',
  imports: [MatTooltipModule],
  template: `
    @if (spend.budget()) {
      <button
        class="meter"
        type="button"
        [class]="'meter--' + spend.level()"
        [matTooltip]="summary()"
        matTooltipPosition="below"
        (click)="open()"
      >
        <svg class="ring" viewBox="0 0 18 18" aria-hidden="true">
          <circle class="ring__track" cx="9" cy="9" r="7" />
          @if (spend.hasLimit()) {
            <circle
              class="ring__value"
              cx="9"
              cy="9"
              r="7"
              [style.stroke-dasharray]="circumference"
              [style.stroke-dashoffset]="dashOffset()"
            />
          }
        </svg>

        @if (spend.hasLimit()) {
          <span class="meter__amount mono">{{ amount() }}</span>
        } @else {
          <span class="meter__amount meter__amount--invite">Budget</span>
        }

        <span class="sr-only">{{ summary() }}</span>
      </button>
    }
  `,
  styleUrl: './spend-meter.scss',
})
export class SpendMeter {
  private readonly router = inject(Router);

  protected readonly spend = inject(SpendService);
  protected readonly circumference = RING;

  protected readonly dashOffset = computed(() => RING * (1 - this.spend.fraction()));

  /**
   * The figure on the deck: what is left, or what the overspend is.
   *
   * Past the limit it switches to the amount over, because "−$2.50 left" is a
   * sentence nobody parses at a glance and the overage is the number that
   * matters by then.
   */
  protected readonly amount = computed(() => {
    const budget = this.spend.budget();
    const remaining = budget?.remainingUsd;

    if (remaining === null || remaining === undefined) {
      return '—';
    }

    return remaining < 0
      ? `+${this.spend.money(Math.abs(remaining))}`
      : this.spend.money(remaining);
  });

  protected readonly summary = computed(() => {
    const budget = this.spend.budget();

    if (!budget || budget.limitUsd === null) {
      return 'No spending budget set — choose what completions may cost';
    }

    const period = BUDGET_PERIOD_LABEL[budget.period];
    const of = `of ${this.spend.money(budget.limitUsd)} ${period}`;

    if (!this.spend.hasRecordedSpend()) {
      // Saying "all of it is left" would present an unmeasured budget as a
      // measurement. Nothing has been charged, and that is the fact.
      return `${this.spend.money(budget.limitUsd)} budgeted ${period} · nothing charged yet`;
    }

    return budget.remainingUsd !== null && budget.remainingUsd < 0
      ? `${this.spend.money(Math.abs(budget.remainingUsd))} over the budget ${of.slice(3)}`
      : `${this.amount()} left ${of} · ${this.spend.money(budget.spentUsd)} spent`;
  });

  protected open(): void {
    void this.router.navigate(['/budget']);
  }
}
