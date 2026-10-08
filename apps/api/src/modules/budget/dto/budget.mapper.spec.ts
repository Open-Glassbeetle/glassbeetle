import { describe, expect, it } from 'vitest';
import type { PeriodWindow } from '../period-window.js';
import {
  applyBudgetUpdates,
  mapBudgetToResponse,
  roundUsd,
  type SpendBudgetRow,
} from './budget.mapper.js';

const ROW: SpendBudgetRow = {
  id: '018f3a9e-0000-7000-8000-000000000001',
  singleton: 1,
  limit_usd: 20,
  period: 'monthly',
  created_at: '2026-10-01T08:00:00.000Z',
  updated_at: '2026-10-01T08:00:00.000Z',
};

const WINDOW: PeriodWindow = {
  start: '2026-10-01T00:00:00.000Z',
  end: '2026-11-01T00:00:00.000Z',
};

describe('roundUsd', () => {
  it('drops the floating-point tail a sum of REAL costs leaves behind', () => {
    expect(roundUsd(0.1 + 0.2)).toBe(0.3);
  });

  it('keeps precision finer than a cent, because a single call costs less', () => {
    expect(roundUsd(0.000123)).toBe(0.000123);
  });

  it('leaves a whole amount alone', () => {
    expect(roundUsd(20)).toBe(20);
  });
});

describe('mapBudgetToResponse', () => {
  it('reports the budget, the window and the spend as one answer', () => {
    expect(
      mapBudgetToResponse(ROW, WINDOW, { spentUsd: 4.12, callCount: 37 }),
    ).toEqual({
      id: ROW.id,
      limitUsd: 20,
      period: 'monthly',
      periodStart: WINDOW.start,
      periodEnd: WINDOW.end,
      spentUsd: 4.12,
      remainingUsd: 15.88,
      usedFraction: 0.206,
      callCount: 37,
      createdAt: ROW.created_at,
      updatedAt: ROW.updated_at,
    });
  });

  it('never leaks the singleton constraint column', () => {
    const response = mapBudgetToResponse(ROW, WINDOW, {
      spentUsd: 0,
      callCount: 0,
    }) as Record<string, unknown>;

    expect(response.singleton).toBeUndefined();
  });

  it('reports no remaining and no fraction when no limit is set', () => {
    const response = mapBudgetToResponse({ ...ROW, limit_usd: null }, WINDOW, {
      spentUsd: 4.12,
      callCount: 37,
    });

    expect(response).toMatchObject({
      limitUsd: null,
      spentUsd: 4.12,
      remainingUsd: null,
      usedFraction: null,
    });
  });

  it('reports a negative remainder rather than clamping at zero', () => {
    const response = mapBudgetToResponse(ROW, WINDOW, {
      spentUsd: 25,
      callCount: 90,
    });

    expect(response.remainingUsd).toBe(-5);
  });

  it('reports a fraction above 1, which is how a client learns the budget was passed', () => {
    const response = mapBudgetToResponse(ROW, WINDOW, {
      spentUsd: 25,
      callCount: 90,
    });

    expect(response.usedFraction).toBe(1.25);
  });

  it('rounds the sum before subtracting, so the parts add up for a reader', () => {
    const response = mapBudgetToResponse({ ...ROW, limit_usd: 1 }, WINDOW, {
      spentUsd: 0.1 + 0.2,
      callCount: 2,
    });

    expect(response.spentUsd).toBe(0.3);
    expect(response.remainingUsd).toBe(0.7);
  });

  it('reports an untouched period as zero rather than as unknown', () => {
    const response = mapBudgetToResponse(ROW, WINDOW, {
      spentUsd: 0,
      callCount: 0,
    });

    expect(response).toMatchObject({
      spentUsd: 0,
      callCount: 0,
      remainingUsd: 20,
      usedFraction: 0,
    });
  });
});

describe('applyBudgetUpdates', () => {
  const NOW = '2026-11-01T10:00:00.000Z';

  it('reports no changes for an empty payload and leaves updated_at alone', () => {
    const result = applyBudgetUpdates(ROW, {}, { now: NOW });

    expect(result.hasChanges).toBe(false);
    expect(result.updatedRow.updated_at).toBe(ROW.updated_at);
  });

  it('reports no change when the limit is set to what it already is', () => {
    const result = applyBudgetUpdates(ROW, { limitUsd: 20 }, { now: NOW });

    expect(result.hasChanges).toBe(false);
  });

  it('changes the limit and bumps updated_at', () => {
    const result = applyBudgetUpdates(ROW, { limitUsd: 50 }, { now: NOW });

    expect(result.setClauses).toEqual(['limit_usd = ?', 'updated_at = ?']);
    expect(result.setParams).toEqual([50, NOW]);
    expect(result.updatedRow.limit_usd).toBe(50);
  });

  it('removes the budget on an explicit null', () => {
    const result = applyBudgetUpdates(ROW, { limitUsd: null }, { now: NOW });

    expect(result.setParams).toEqual([null, NOW]);
    expect(result.updatedRow.limit_usd).toBeNull();
  });

  it('changes the period', () => {
    const result = applyBudgetUpdates(ROW, { period: 'daily' }, { now: NOW });

    expect(result.setClauses).toEqual(['period = ?', 'updated_at = ?']);
    expect(result.updatedRow.period).toBe('daily');
  });

  it('collects both fields into one statement', () => {
    const result = applyBudgetUpdates(
      ROW,
      { limitUsd: 5, period: 'weekly' },
      { now: NOW },
    );

    expect(result.setClauses).toEqual([
      'limit_usd = ?',
      'period = ?',
      'updated_at = ?',
    ]);
    expect(result.setParams).toEqual([5, 'weekly', NOW]);
  });
});
