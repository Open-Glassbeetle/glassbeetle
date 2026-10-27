import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateModelDto } from './update-model.dto.js';

const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

async function validateDto(payload: Record<string, unknown>) {
  const instance = plainToInstance(UpdateModelDto, payload);
  const errors = await validate(instance, VALIDATION_OPTIONS);
  return { instance, errors };
}

describe('UpdateModelDto', () => {
  it('passes validation with empty body ({})', async () => {
    const { errors } = await validateDto({});
    expect(errors).toHaveLength(0);
  });

  it('passes validation with all mutable fields provided', async () => {
    const { errors, instance } = await validateDto({
      displayName: 'Claude 3.5 Sonnet (Upgraded)',
      contextWindow: 128000,
      defaultTemperature: 0.5,
      defaultMaxTokens: 4096,
      enabled: false,
    });

    expect(errors).toHaveLength(0);
    expect(instance.displayName).toBe('Claude 3.5 Sonnet (Upgraded)');
    expect(instance.contextWindow).toBe(128000);
    expect(instance.defaultTemperature).toBe(0.5);
    expect(instance.defaultMaxTokens).toBe(4096);
    expect(instance.enabled).toBe(false);
  });

  describe('displayName validation', () => {
    it('trims whitespace', async () => {
      const { errors, instance } = await validateDto({
        displayName: '  Updated Model  ',
      });

      expect(errors).toHaveLength(0);
      expect(instance.displayName).toBe('Updated Model');
    });

    it('rejects empty string', async () => {
      const { errors } = await validateDto({ displayName: '' });
      const err = errors.find((e) => e.property === 'displayName');
      expect(err).toBeDefined();
    });

    it('rejects whitespace-only string', async () => {
      const { errors } = await validateDto({ displayName: '   ' });
      const err = errors.find((e) => e.property === 'displayName');
      expect(err).toBeDefined();
    });

    it('rejects displayName exceeding 255 characters', async () => {
      const { errors } = await validateDto({
        displayName: 'a'.repeat(256),
      });
      const err = errors.find((e) => e.property === 'displayName');
      expect(err).toBeDefined();
    });
  });

  describe('nullable numeric fields', () => {
    it('accepts null for contextWindow, defaultTemperature, defaultMaxTokens', async () => {
      const { errors, instance } = await validateDto({
        contextWindow: null,
        defaultTemperature: null,
        defaultMaxTokens: null,
      });

      expect(errors).toHaveLength(0);
      expect(instance.contextWindow).toBeNull();
      expect(instance.defaultTemperature).toBeNull();
      expect(instance.defaultMaxTokens).toBeNull();
    });

    it('rejects negative or zero contextWindow', async () => {
      const resZero = await validateDto({ contextWindow: 0 });
      expect(resZero.errors.some((e) => e.property === 'contextWindow')).toBe(true);

      const resNeg = await validateDto({ contextWindow: -100 });
      expect(resNeg.errors.some((e) => e.property === 'contextWindow')).toBe(true);
    });

    it('accepts 0 for defaultTemperature but rejects negative', async () => {
      const resZero = await validateDto({ defaultTemperature: 0 });
      expect(resZero.errors).toHaveLength(0);

      const resNeg = await validateDto({ defaultTemperature: -0.1 });
      expect(resNeg.errors.some((e) => e.property === 'defaultTemperature')).toBe(true);
    });

    it('rejects negative or zero defaultMaxTokens', async () => {
      const resZero = await validateDto({ defaultMaxTokens: 0 });
      expect(resZero.errors.some((e) => e.property === 'defaultMaxTokens')).toBe(true);

      const resNeg = await validateDto({ defaultMaxTokens: -50 });
      expect(resNeg.errors.some((e) => e.property === 'defaultMaxTokens')).toBe(true);
    });
  });

  describe('enabled validation', () => {
    it('accepts true and false', async () => {
      const resTrue = await validateDto({ enabled: true });
      expect(resTrue.errors).toHaveLength(0);

      const resFalse = await validateDto({ enabled: false });
      expect(resFalse.errors).toHaveLength(0);
    });

    it('rejects non-boolean value', async () => {
      const { errors } = await validateDto({ enabled: 'true' as unknown as boolean });
      const err = errors.find((e) => e.property === 'enabled');
      expect(err).toBeDefined();
    });
  });

  describe('immutable and server-managed fields rejection', () => {
    it('rejects providerId', async () => {
      const { errors } = await validateDto({
        providerId: '018f3a9e-0000-7000-8000-000000000001',
      });
      const err = errors.find((e) => e.property === 'providerId');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('whitelistValidation');
    });

    it('rejects modelIdentifier', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'gpt-4o',
      });
      const err = errors.find((e) => e.property === 'modelIdentifier');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('whitelistValidation');
    });

    it('rejects source', async () => {
      const { errors } = await validateDto({
        source: 'manual',
      });
      const err = errors.find((e) => e.property === 'source');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('whitelistValidation');
    });

    it('rejects server-managed fields id, createdAt, updatedAt', async () => {
      const { errors } = await validateDto({
        id: '018f3a9e-0000-7000-8000-000000000001',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      expect(errors.some((e) => e.property === 'id')).toBe(true);
      expect(errors.some((e) => e.property === 'createdAt')).toBe(true);
      expect(errors.some((e) => e.property === 'updatedAt')).toBe(true);
    });
  });
});
