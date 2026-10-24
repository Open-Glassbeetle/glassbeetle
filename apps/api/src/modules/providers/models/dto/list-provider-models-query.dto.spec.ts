import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ListProviderModelsQueryDto } from './list-provider-models-query.dto.js';

const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

async function validateDto(payload: Record<string, unknown>) {
  const instance = plainToInstance(ListProviderModelsQueryDto, payload);
  const errors = await validate(instance, VALIDATION_OPTIONS);
  return { instance, errors };
}

describe('ListProviderModelsQueryDto', () => {
  it('passes validation with default query params', async () => {
    const { errors, instance } = await validateDto({});

    expect(errors).toHaveLength(0);
    expect(instance.limit).toBe(50);
    expect(instance.offset).toBe(0);
    expect(instance.enabled).toBeUndefined();
    expect(instance.source).toBeUndefined();
  });

  it('transforms boolean query string for enabled', async () => {
    const resTrue = await validateDto({ enabled: 'true' });
    expect(resTrue.errors).toHaveLength(0);
    expect(resTrue.instance.enabled).toBe(true);

    const resFalse = await validateDto({ enabled: 'false' });
    expect(resFalse.errors).toHaveLength(0);
    expect(resFalse.instance.enabled).toBe(false);

    const resOne = await validateDto({ enabled: '1' });
    expect(resOne.errors).toHaveLength(0);
    expect(resOne.instance.enabled).toBe(true);

    const resZero = await validateDto({ enabled: '0' });
    expect(resZero.errors).toHaveLength(0);
    expect(resZero.instance.enabled).toBe(false);
  });

  it('accepts valid source values', async () => {
    const resDiscovered = await validateDto({ source: 'discovered' });
    expect(resDiscovered.errors).toHaveLength(0);
    expect(resDiscovered.instance.source).toBe('discovered');

    const resManual = await validateDto({ source: 'manual' });
    expect(resManual.errors).toHaveLength(0);
    expect(resManual.instance.source).toBe('manual');
  });

  it('rejects invalid source values', async () => {
    const { errors } = await validateDto({ source: 'custom' });
    const err = errors.find((e) => e.property === 'source');
    expect(err).toBeDefined();
  });

  it('accepts valid pagination and sort parameters', async () => {
    const { errors, instance } = await validateDto({
      limit: '20',
      offset: '40',
      sort: 'modelIdentifier',
      order: 'asc',
    });

    expect(errors).toHaveLength(0);
    expect(instance.limit).toBe(20);
    expect(instance.offset).toBe(40);
    expect(instance.sort).toBe('modelIdentifier');
    expect(instance.order).toBe('asc');
  });

  it('rejects invalid limit and offset', async () => {
    const resLimitZero = await validateDto({ limit: 0 });
    expect(resLimitZero.errors.some((e) => e.property === 'limit')).toBe(true);

    const resLimitTooHigh = await validateDto({ limit: 101 });
    expect(resLimitTooHigh.errors.some((e) => e.property === 'limit')).toBe(true);

    const resNegativeOffset = await validateDto({ offset: -1 });
    expect(resNegativeOffset.errors.some((e) => e.property === 'offset')).toBe(true);
  });

  it('rejects invalid sort order', async () => {
    const { errors } = await validateDto({ order: 'ascending' });
    const err = errors.find((e) => e.property === 'order');
    expect(err).toBeDefined();
  });
});
