import { Injectable, computed, inject, signal } from '@angular/core';

import { BudgetService } from '../api/budget.service';
import type { Budget } from '../api/budget.models';
import { UserProfileService } from './user-profile.service';

/** Fraction of the budget at which the meter stops being reassuring. */
const WARN_AT = 0.8;

/** How the meter reads: nothing set, comfortable, close to the limit, past it. */
export type SpendLevel = 'unset' | 'within' | 'warning' | 'over';

/**
 * The spending budget, in the window chrome.
 *
 * Held in a root service because the meter is in the deck on every route, and
 * because the budget screen and the deck must not disagree about what is left.
 * Refreshed on demand rather than polled: nothing in this application spends
 * money on its own, so the number cannot change without a request this app
 * made.
 */
@Injectable({ providedIn: 'root' })
export class SpendService {
  private readonly api = inject(BudgetService);
  private readonly profile = inject(UserProfileService);

  private readonly _budget = signal<Budget | null>(null);
  private readonly _loaded = signal(false);

  readonly budget = this._budget.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  /**
   * Whether a limit is set at all, which is what puts the meter in the deck.
   *
   * Undefined has to be excluded as well as null: before the budget loads, and
   * after a failed load, there is no budget at all — and optional chaining
   * yields `undefined`, which is not `null` and would have put an empty meter
   * in the chrome.
   */
  readonly hasLimit = computed(() => {
    const limit = this._budget()?.limitUsd;
    return limit !== null && limit !== undefined;
  });

  readonly level = computed<SpendLevel>(() => {
    const budget = this._budget();
    const used = budget?.usedFraction;

    if (!budget || used === null || used === undefined) {
      return 'unset';
    }

    if (used >= 1) {
      return 'over';
    }

    return used >= WARN_AT ? 'warning' : 'within';
  });

  /**
   * How much of the ring to fill, clamped to the ring.
   *
   * The ring is clamped where the numbers are not: a ring cannot show 125%, so
   * it fills completely and the colour and the figure carry the overage.
   */
  readonly fraction = computed(() => {
    const used = this._budget()?.usedFraction ?? 0;
    return Math.min(Math.max(used, 0), 1);
  });

  /**
   * Whether anything chargeable has been recorded in this period.
   *
   * False is the honest state of every installation today — completions do not
   * run, so nothing writes to `usage_events` — and it stays the right question
   * afterwards, when it will mean "you have not used it yet this period".
   */
  readonly hasRecordedSpend = computed(() => (this._budget()?.callCount ?? 0) > 0);

  /** The remaining amount, formatted in the profile's locale. */
  readonly remainingLabel = computed(() => {
    const remaining = this._budget()?.remainingUsd;
    return remaining === null || remaining === undefined ? null : this.money(remaining);
  });

  /**
   * Formats an amount as US dollars in the user's locale.
   *
   * The currency is USD because the stored costs are; the locale only decides
   * how the number is punctuated, which is the part that should follow the
   * person rather than the provider.
   */
  money(amountUsd: number): string {
    try {
      return new Intl.NumberFormat(this.profile.profile()?.locale ?? undefined, {
        style: 'currency',
        currency: 'USD',
        // Sub-cent amounts are real here: a single completion can cost a
        // fraction of a cent, and rounding them all to $0.00 would make a
        // meter that never moves.
        minimumFractionDigits: 2,
        maximumFractionDigits: Math.abs(amountUsd) < 0.01 && amountUsd !== 0 ? 4 : 2,
      }).format(amountUsd);
    } catch {
      return `$${amountUsd.toFixed(2)}`;
    }
  }

  refresh(): void {
    this.api.get().subscribe({
      next: (budget) => {
        this._budget.set(budget);
        this._loaded.set(true);
      },
      // The deck simply shows no meter; the budget screen reports the failure.
      error: () => this._loaded.set(true),
    });
  }

  /** Records a budget the user just saved, so the deck follows immediately. */
  set(budget: Budget): void {
    this._budget.set(budget);
    this._loaded.set(true);
  }
}
