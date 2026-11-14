import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ActivityQueryDto } from './activity-query.dto.js';

const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

async function validateDto(payload: Record<string, unknown>) {
  const instance = plainToInstance(ActivityQueryDto, payload);
  return {
    instance,
    errors: await validate(instance, VALIDATION_OPTIONS),
  };
}

describe('ActivityQueryDto', () => {
  it('accepts an empty query object', async () => {
    const { errors } = await validateDto({});
    expect(errors).toHaveLength(0);
  });

  it('accepts valid query parameters', async () => {
    const { errors } = await validateDto({
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-31T23:59:59.999Z',
      interval: 'day',
      eventType: 'chat_completion',
      agentId: '018f3a9e-0000-7000-8000-000000000001',
      providerId: '018f3a9e-0000-7000-8000-000000000002',
      modelId: '018f3a9e-0000-7000-8000-000000000003',
      timezone: 'Europe/Zurich',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects unexpected non-whitelisted properties', async () => {
    const { errors } = await validateDto({
      forbiddenField: 'unexpected',
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'forbiddenField')).toBe(true);
  });

  it('rejects non-string values for string properties', async () => {
    const { errors } = await validateDto({
      from: 12345,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'from')).toBe(true);
  });
});

