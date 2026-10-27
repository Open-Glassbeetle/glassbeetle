import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ListModelsQueryDto } from './list-models-query.dto.js';

const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

async function validateDto(payload: Record<string, unknown>) {
  const instance = plainToInstance(ListModelsQueryDto, payload);
  const errors = await validate(instance, VALIDATION_OPTIONS);
  return { instance, errors };
}

describe('ListModelsQueryDto', () => {
  it('passes validation with default query params', async () => {
    const { errors, instance } = await validateDto({});

    expect(errors).toHaveLength(0);
    expect(instance.limit).toBe(50);
    expect(instance.offset).toBe(0);
    expect(instance.providerId).toBeUndefined();
    expect(instance.enabled).toBeUndefined();
    expect(instance.source).toBeUndefined();
  });

  it('accepts valid providerId', async () => {
    const providerId = '018f3a9e-0000-7000-8000-000000000001';
    const { errors, instance } = await validateDto({ providerId });

    expect(errors).toHaveLength(0);
    expect(instance.providerId).toBe(providerId);
  });

  it('transforms boolean query strings for enabled', async () => {
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
    const { errors } = await validateDto({ source: 'unknown-source' });
    const err = errors.find((e) => e.property === 'source');
    expect(err).toBeDefined();
  });

  it('rejects non-whitelisted properties', async () => {
    const { errors } = await validateDto({ extraParam: 'not-allowed' });
    const err = errors.find((e) => e.property === 'extraParam');
    expect(err).toBeDefined();
    expect(err?.constraints).toHaveProperty('whitelistValidation');
  });
});
