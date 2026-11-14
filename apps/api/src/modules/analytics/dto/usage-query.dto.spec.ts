import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UsageQueryDto } from './usage-query.dto.js';

const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

async function validateDto(payload: Record<string, unknown>) {
  const instance = plainToInstance(UsageQueryDto, payload);
  return {
    instance,
    errors: await validate(instance, VALIDATION_OPTIONS),
  };
}

describe('UsageQueryDto', () => {
  it('accepts an empty query object', async () => {
    const { errors } = await validateDto({});
    expect(errors).toHaveLength(0);
  });

  it('accepts valid query parameters', async () => {
    const { errors } = await validateDto({
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-31T23:59:59.999Z',
      groupBy: 'agent,day',
      agentId: '018f3a9e-0000-7000-8000-000000000001',
      providerId: '018f3a9e-0000-7000-8000-000000000002',
      modelId: '018f3a9e-0000-7000-8000-000000000003',
      eventType: 'chat_completion',
      timezone: 'Europe/Zurich',
    });
    expect(errors).toHaveLength(0);
  });

  it('transforms comma-separated groupBy string into string array', async () => {
    const { instance, errors } = await validateDto({
      groupBy: 'agent, day, model',
    });
    expect(errors).toHaveLength(0);
    expect(instance.groupBy).toEqual(['agent', 'day', 'model']);
  });

  it('transforms array of groupBy values into flattened string array', async () => {
    const { instance, errors } = await validateDto({
      groupBy: ['agent,model', 'day'],
    });
    expect(errors).toHaveLength(0);
    expect(instance.groupBy).toEqual(['agent', 'model', 'day']);
  });

  it('rejects non-whitelisted unexpected query properties', async () => {
    const { errors } = await validateDto({
      unknownProperty: 'malicious_value',
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'unknownProperty')).toBe(true);
  });

  it('rejects non-string types for string fields', async () => {
    const { errors } = await validateDto({
      from: 12345,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'from')).toBe(true);
  });
});

