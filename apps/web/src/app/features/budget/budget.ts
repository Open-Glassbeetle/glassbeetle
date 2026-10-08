import { TitleCasePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';

import { toApiError, type ApiError } from '../../core/api/api-error';
import {
  BUDGET_PERIODS,
  BUDGET_PERIOD_LABEL,
  MAX_LIMIT_USD,
  type UpdateBudgetInput,
} from '../../core/api/budget.models';
import { BudgetService } from '../../core/api/budget.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { SpendService } from '../../core/workspace/spend.service';
import { UserProfileService } from '../../core/workspace/user-profile.service';
import { Panel } from '../../shared/ui/panel';
import { Skeleton } from '../../shared/ui/skeleton';

/**
 * Spending: the budget, and what has gone against it this period.
 *
 * The screen is honest about the half of this that does not work yet. Costs
 * are read from `usage_events`, which only the inference module writes — and
 * that module is an empty controller, so every installation reads zero. The
 * budget is stored and the arithmetic is real; what is missing is anything
 * that spends money. Saying so is better than a meter the user slowly works
 * out is decorative.
 */
@Component({
  selector: 'app-budget',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTooltipModule,
    Panel,
    ReactiveFormsModule,
    Skeleton,
    TitleCasePipe,
  ],
  templateUrl: './budget.html',
  styleUrl: './budget.scss',
})
export class Budget {
  private readonly api = inject(BudgetService);
  private readonly notify = inject(NotificationService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly profile = inject(UserProfileService);

  protected readonly spend = inject(SpendService);
  protected readonly budget = this.spend.budget;

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<ApiError | null>(null);

  protected readonly periods = BUDGET_PERIODS;
  protected readonly periodLabel = BUDGET_PERIOD_LABEL;
  protected readonly maxLimit = MAX_LIMIT_USD;

  protected readonly form = this.formBuilder.nonNullable.group({
    limitUsd: this.formBuilder.control<number | null>(null, [
      Validators.min(0.01),
      Validators.max(MAX_LIMIT_USD),
    ]),
    period: this.formBuilder.nonNullable.control<(typeof BUDGET_PERIODS)[number]>('monthly'),
  });

  /** The period, written out for the current setting. */
  protected readonly periodPhrase = computed(() => {
    const period = this.budget()?.period;
    return period ? BUDGET_PERIOD_LABEL[period] : 'this period';
  });

  /** When the current period rolls over, in the user's own words. */
  protected readonly renewsAt = computed(() => {
    const end = this.budget()?.periodEnd;
    if (!end) {
      return null;
    }

    try {
      return new Intl.DateTimeFormat(this.profile.profile()?.locale ?? undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: this.profile.profile()?.timezone ?? undefined,
      }).format(new Date(end));
    } catch {
      return new Date(end).toISOString();
    }
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.api.get().subscribe({
      next: (budget) => {
        this.spend.set(budget);
        this.reset();
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(toApiError(error));
        this.loading.set(false);
      },
    });
  }

  /** Refills the form from the stored budget, discarding unsaved edits. */
  protected reset(): void {
    const budget = this.budget();
    if (!budget) {
      return;
    }

    this.form.reset({ limitUsd: budget.limitUsd, period: budget.period });
  }

  protected save(): void {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    const patch = this.buildPatch();

    if (Object.keys(patch).length === 0) {
      this.notify.success('Nothing to save.');
      return;
    }

    this.saving.set(true);

    this.api.update(patch).subscribe({
      next: (budget) => {
        this.saving.set(false);
        this.spend.set(budget);
        this.form.markAsPristine();
        this.reset();
        this.notify.success('Budget saved.');
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notify.error(error, 'Could not save the budget.');
      },
    });
  }

  /** Removes the budget, leaving spending reported but unbounded. */
  protected removeLimit(): void {
    this.saving.set(true);

    this.api.update({ limitUsd: null }).subscribe({
      next: (budget) => {
        this.saving.set(false);
        this.spend.set(budget);
        this.form.markAsPristine();
        this.reset();
        this.notify.success('Budget removed. Spending is still reported.');
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notify.error(error, 'Could not remove the budget.');
      },
    });
  }

  /**
   * Builds the PATCH body.
   *
   * A field left as it was is omitted, so the API's "empty body is a no-op"
   * rule keeps `updatedAt` honest. An emptied limit field is sent as `null`,
   * which is what removes the budget.
   */
  private buildPatch(): UpdateBudgetInput {
    const value = this.form.getRawValue();
    const budget = this.budget();
    const patch: UpdateBudgetInput = {};

    if (!budget) {
      return patch;
    }

    // An empty number input reads as null, and so does a cleared one: both
    // mean "no budget", which is exactly what null stores.
    const limitUsd = value.limitUsd === null ? null : Number(value.limitUsd);

    if (limitUsd !== budget.limitUsd) {
      patch.limitUsd = limitUsd;
    }

    if (value.period !== budget.period) {
      patch.period = value.period;
    }

    return patch;
  }
}
