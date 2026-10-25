import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { DiscoverModelsDto } from './discover-models.dto.js';

const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

async function validateDto(payload: Record<string, unknown>) {
  const instance = plainToInstance(DiscoverModelsDto, payload);
  const errors = await validate(instance, VALIDATION_OPTIONS);
  return { instance, errors };
}

describe('DiscoverModelsDto', () => {
  it('passes validation when empty', async () => {
    const { errors, instance } = await validateDto({});
    expect(errors).toHaveLength(0);
    expect(instance.timeoutMs).toBeUndefined();
  });

  it('accepts valid positive integer timeoutMs', async () => {
    const { errors, instance } = await validateDto({ timeoutMs: 5000 });
    expect(errors).toHaveLength(0);
    expect(instance.timeoutMs).toBe(5000);
  });

  it('transforms string integer to number for timeoutMs', async () => {
    const { errors, instance } = await validateDto({ timeoutMs: '10000' });
    expect(errors).toHaveLength(0);
    expect(instance.timeoutMs).toBe(10000);
  });

  it('rejects non-positive timeoutMs', async () => {
    const resZero = await validateDto({ timeoutMs: 0 });
    expect(resZero.errors.some((e) => e.property === 'timeoutMs')).toBe(true);

    const resNeg = await validateDto({ timeoutMs: -100 });
    expect(resNeg.errors.some((e) => e.property === 'timeoutMs')).toBe(true);
  });

  it('rejects unknown properties when forbidNonWhitelisted is active', async () => {
    const { errors } = await validateDto({ unknownProp: 123 });
    expect(errors.some((e) => e.property === 'unknownProp')).toBe(true);
  });
});
