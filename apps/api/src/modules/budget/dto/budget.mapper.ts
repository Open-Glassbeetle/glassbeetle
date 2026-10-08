import { nowIso } from '../../../common/persistence/timestamps.js';
import type { BudgetPeriod, PeriodWindow } from '../period-window.js';
import type { BudgetResponseDto } from './budget-response.dto.js';
import type { UpdateBudgetDto } from './update-budget.dto.js';

/**
 * Raw row shape for the `spend_budget` SQLite table.
 */
export interface SpendBudgetRow {
  readonly id: string;
  readonly singleton: number;
  readonly limit_usd: number | null;
  readonly period: BudgetPeriod;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * What was actually spent in a period.
 */
export interface PeriodSpend {
  readonly spentUsd: number;
  readonly callCount: number;
}

/**
 * Rounds an amount to whole micro-dollars.
 *
 * `cost_usd` is `REAL`, so summing a few hundred fractions of a cent produces
 * the usual binary-floating-point tail — `0.30000000000000004` rather than
 * `0.3`. Six decimal places is finer than any single call costs and coarse
 * enough to drop the noise, so the number a client renders is the number a
 * person would have added up.
 */
export function roundUsd(amount: number): number {
  return Math.round(amount * 1_000_000) / 1_000_000;
}

/**
 * Maps a `spend_budget` row, its period and the spend inside it to the public
 * representation.
 *
 * `singleton` is never serialised: it is how the database refuses a second
 * row, and says nothing about the budget.
 */
export function mapBudgetToResponse(
  row: SpendBudgetRow,
  window: PeriodWindow,
  spend: PeriodSpend,
): BudgetResponseDto {
  const limitUsd = row.limit_usd ?? null;
  const spentUsd = roundUsd(spend.spentUsd);

  return {
    id: row.id,
    limitUsd,
    period: row.period,
    periodStart: window.start,
    periodEnd: window.end,
    spentUsd,
    remainingUsd: limitUsd === null ? null : roundUsd(limitUsd - spentUsd),
    // Not clamped: a fraction above 1 is how a client learns the budget was
    // passed, and clamping here would make going over look like landing
    // exactly on it.
    usedFraction: limitUsd === null ? null : roundUsd(spentUsd / limitUsd),
    callCount: spend.callCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Result of evaluating an `UpdateBudgetDto` against an existing row.
 */
export interface BudgetUpdateResult {
  readonly updatedRow: SpendBudgetRow;
  readonly hasChanges: boolean;
  readonly setClauses: readonly string[];
  readonly setParams: readonly unknown[];
}

/**
 * Applies an `UpdateBudgetDto` to an existing `SpendBudgetRow`.
 *
 * Same null-vs-omitted contract as every other PATCH in the API: omitted
 * leaves the column alone, `null` clears the limit, and a field set to the
 * value it already holds is not a change, so re-saving an unedited form does
 * not bump `updated_at`.
 */
export function applyBudgetUpdates(
  existingRow: SpendBudgetRow,
  dto: UpdateBudgetDto,
  options?: { readonly now?: string },
): BudgetUpdateResult {
  const changedColumns: Record<string, unknown> = {};
  const setClauses: string[] = [];
  const setParams: unknown[] = [];

  function recordChange(column: keyof SpendBudgetRow, value: unknown): void {
    changedColumns[column] = value;
    setClauses.push(`${column} = ?`);
    setParams.push(value);
  }

  if (dto.limitUsd !== undefined) {
    const next = dto.limitUsd ?? null;
    if (next !== existingRow.limit_usd) {
      recordChange('limit_usd', next);
    }
  }

  if (dto.period !== undefined && dto.period !== existingRow.period) {
    recordChange('period', dto.period);
  }

  const hasChanges = setClauses.length > 0;
  const updatedAt = hasChanges
    ? (options?.now ?? nowIso())
    : existingRow.updated_at;

  if (hasChanges) {
    changedColumns.updated_at = updatedAt;
    setClauses.push('updated_at = ?');
    setParams.push(updatedAt);
  }

  const updatedRow: SpendBudgetRow = {
    ...existingRow,
    ...(changedColumns as Partial<SpendBudgetRow>),
    updated_at: updatedAt,
  };

  return { updatedRow, hasChanges, setClauses, setParams };
}
