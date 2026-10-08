/** Periods a budget can run on. */
export const BUDGET_PERIODS = ['daily', 'weekly', 'monthly'] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

/** How each period reads in a sentence about what is left. */
export const BUDGET_PERIOD_LABEL: Record<BudgetPeriod, string> = {
  daily: 'today',
  weekly: 'this week',
  monthly: 'this month',
};

/**
 * The budget and the spend against it (`GET /api/v1/budget`).
 *
 * One response rather than two, because the window the spend is summed over is
 * a property of the budget: computing it on the client would mean a second
 * answer to the same question, in the browser's time zone rather than the
 * profile's.
 *
 * Amounts are US dollars, because `usage_events.cost_usd` is. There is no
 * currency field — one would promise a conversion nothing offline can perform.
 */
export interface Budget {
  readonly id: string;
  /** The ceiling for one period, or null when no budget is set. */
  readonly limitUsd: number | null;
  readonly period: BudgetPeriod;
  /** First instant of the current period; local midnight in the profile's zone. */
  readonly periodStart: string;
  /** First instant of the next period. Exclusive. */
  readonly periodEnd: string;
  readonly spentUsd: number;
  /** Negative once the limit is passed, and null when there is no limit. */
  readonly remainingUsd: number | null;
  /** Above 1 once the limit is passed. Not clamped, and null without a limit. */
  readonly usedFraction: number | null;
  /**
   * Usage events in this period that carry a cost.
   *
   * Zero means nothing chargeable has been recorded. That is the case for
   * every installation today, because completions do not run yet — so the UI
   * says which of the two it is rather than presenting a full budget as a
   * measurement.
   */
  readonly callCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Body for `PATCH /api/v1/budget`.
 *
 * An omitted key leaves the field alone. `limitUsd: null` removes the budget;
 * `period` has no null, because a budget always runs on some period.
 */
export interface UpdateBudgetInput {
  limitUsd?: number | null;
  period?: BudgetPeriod;
}

/** The largest limit the API accepts, in US dollars. */
export const MAX_LIMIT_USD = 1_000_000;
