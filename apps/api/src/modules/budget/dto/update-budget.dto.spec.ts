import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { MAX_LIMIT_USD, UpdateBudgetDto } from './update-budget.dto.js';

const VALIDATION_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

async function validateDto(payload: Record<string, unknown>) {
  return validate(
    plainToInstance(UpdateBudgetDto, payload),
    VALIDATION_OPTIONS,
  );
}

describe('UpdateBudgetDto', () => {
  it('accepts an empty payload, which the service treats as a no-op', async () => {
    expect(await validateDto({})).toHaveLength(0);
  });

  it('accepts a limit and a period', async () => {
    expect(await validateDto({ limitUsd: 20, period: 'monthly' })).toHaveLength(
      0,
    );
  });

  it('accepts null, which removes the budget', async () => {
    expect(await validateDto({ limitUsd: null })).toHaveLength(0);
  });

  it('rejects unknown and server-managed fields', async () => {
    for (const property of [
      'id',
      'createdAt',
      'spentUsd',
      'remainingUsd',
      'periodStart',
    ]) {
      const errors = await validateDto({ [property]: 1 });
      expect(errors.map((error) => error.property)).toContain(property);
    }
  });

  describe('limitUsd', () => {
    it('accepts the smallest amount worth setting', async () => {
      expect(await validateDto({ limitUsd: 0.01 })).toHaveLength(0);
    });

    it('rejects zero, which is a removed budget written the confusing way', async () => {
      expect(await validateDto({ limitUsd: 0 })).toHaveLength(1);
    });

    it('rejects a negative limit', async () => {
      expect(await validateDto({ limitUsd: -5 })).toHaveLength(1);
    });

    it('rejects more precision than money has', async () => {
      const errors = await validateDto({ limitUsd: 20.123 });

      expect(Object.values(errors[0].constraints ?? {})).toContain(
        'limitUsd must be an amount with at most two decimal places',
      );
    });

    it('accepts the ceiling and rejects one above it', async () => {
      expect(await validateDto({ limitUsd: MAX_LIMIT_USD })).toHaveLength(0);
      expect(await validateDto({ limitUsd: MAX_LIMIT_USD + 1 })).toHaveLength(
        1,
      );
    });

    it('rejects a string, since implicit conversion is off', async () => {
      expect(await validateDto({ limitUsd: '20' })).toHaveLength(1);
    });
  });

  describe('period', () => {
    it.each(['daily', 'weekly', 'monthly'])('accepts %s', async (period) => {
      expect(await validateDto({ period })).toHaveLength(0);
    });

    it('rejects a period the window calculation cannot produce', async () => {
      const errors = await validateDto({ period: 'fortnightly' });

      expect(Object.values(errors[0].constraints ?? {})[0]).toContain(
        'period must be one of',
      );
    });

    it('rejects null: a budget always runs on some period', async () => {
      expect(await validateDto({ period: null })).toHaveLength(1);
    });
  });
});
