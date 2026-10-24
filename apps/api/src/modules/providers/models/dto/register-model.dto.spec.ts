import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { RegisterModelDto } from './register-model.dto.js';

const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

async function validateDto(payload: Record<string, unknown>) {
  const instance = plainToInstance(RegisterModelDto, payload);
  const errors = await validate(instance, VALIDATION_OPTIONS);
  return { instance, errors };
}

describe('RegisterModelDto', () => {
  it('passes validation with minimal valid payload (modelIdentifier + displayName)', async () => {
    const { errors, instance } = await validateDto({
      modelIdentifier: 'claude-sonnet-5',
      displayName: 'Claude Sonnet 3.5',
    });

    expect(errors).toHaveLength(0);
    expect(instance.modelIdentifier).toBe('claude-sonnet-5');
    expect(instance.displayName).toBe('Claude Sonnet 3.5');
  });

  it('passes validation with a complete valid payload', async () => {
    const { errors, instance } = await validateDto({
      modelIdentifier: 'qwen2.5:14b',
      displayName: 'Qwen 2.5 14B',
      contextWindow: 32768,
      defaultTemperature: 0.7,
      defaultMaxTokens: 4096,
      enabled: false,
    });

    expect(errors).toHaveLength(0);
    expect(instance.modelIdentifier).toBe('qwen2.5:14b');
    expect(instance.displayName).toBe('Qwen 2.5 14B');
    expect(instance.contextWindow).toBe(32768);
    expect(instance.defaultTemperature).toBe(0.7);
    expect(instance.defaultMaxTokens).toBe(4096);
    expect(instance.enabled).toBe(false);
  });

  it('trims surrounding whitespace while preserving exact casing', async () => {
    const { errors, instance } = await validateDto({
      modelIdentifier: '  Claude-Sonnet-5  ',
      displayName: '  Claude Sonnet 3.5  ',
    });

    expect(errors).toHaveLength(0);
    expect(instance.modelIdentifier).toBe('Claude-Sonnet-5');
    expect(instance.displayName).toBe('Claude Sonnet 3.5');
  });

  describe('modelIdentifier validation', () => {
    it('rejects missing modelIdentifier', async () => {
      const { errors } = await validateDto({
        displayName: 'Model Without ID',
      });

      const err = errors.find((e) => e.property === 'modelIdentifier');
      expect(err).toBeDefined();
    });

    it('rejects empty string modelIdentifier', async () => {
      const { errors } = await validateDto({
        modelIdentifier: '',
        displayName: 'Model',
      });

      const err = errors.find((e) => e.property === 'modelIdentifier');
      expect(err).toBeDefined();
    });

    it('rejects whitespace-only modelIdentifier', async () => {
      const { errors } = await validateDto({
        modelIdentifier: '   ',
        displayName: 'Model',
      });

      const err = errors.find((e) => e.property === 'modelIdentifier');
      expect(err).toBeDefined();
    });

    it('rejects non-string modelIdentifier', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 12345,
        displayName: 'Model',
      });

      const err = errors.find((e) => e.property === 'modelIdentifier');
      expect(err).toBeDefined();
    });

    it('rejects modelIdentifier exceeding 255 characters', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'a'.repeat(256),
        displayName: 'Model',
      });

      const err = errors.find((e) => e.property === 'modelIdentifier');
      expect(err).toBeDefined();
    });
  });

  describe('displayName validation', () => {
    it('rejects missing displayName', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'claude-sonnet-5',
      });

      const err = errors.find((e) => e.property === 'displayName');
      expect(err).toBeDefined();
    });

    it('rejects empty string displayName', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'claude-sonnet-5',
        displayName: '',
      });

      const err = errors.find((e) => e.property === 'displayName');
      expect(err).toBeDefined();
    });

    it('rejects whitespace-only displayName', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'claude-sonnet-5',
        displayName: '   ',
      });

      const err = errors.find((e) => e.property === 'displayName');
      expect(err).toBeDefined();
    });

    it('rejects non-string displayName', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'claude-sonnet-5',
        displayName: { name: 'Claude' },
      });

      const err = errors.find((e) => e.property === 'displayName');
      expect(err).toBeDefined();
    });

    it('rejects displayName exceeding 255 characters', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'claude-sonnet-5',
        displayName: 'a'.repeat(256),
      });

      const err = errors.find((e) => e.property === 'displayName');
      expect(err).toBeDefined();
    });
  });

  describe('contextWindow bounds', () => {
    it('accepts positive integer contextWindow', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'm',
        displayName: 'M',
        contextWindow: 1,
      });

      expect(errors).toHaveLength(0);
    });

    it('accepts null contextWindow', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'm',
        displayName: 'M',
        contextWindow: null,
      });

      expect(errors).toHaveLength(0);
    });

    it('rejects zero contextWindow', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'm',
        displayName: 'M',
        contextWindow: 0,
      });

      const err = errors.find((e) => e.property === 'contextWindow');
      expect(err).toBeDefined();
    });

    it('rejects negative contextWindow', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'm',
        displayName: 'M',
        contextWindow: -100,
      });

      const err = errors.find((e) => e.property === 'contextWindow');
      expect(err).toBeDefined();
    });

    it('rejects non-integer contextWindow', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'm',
        displayName: 'M',
        contextWindow: 128.5,
      });

      const err = errors.find((e) => e.property === 'contextWindow');
      expect(err).toBeDefined();
    });
  });

  describe('defaultTemperature bounds', () => {
    it('accepts zero defaultTemperature', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'm',
        displayName: 'M',
        defaultTemperature: 0,
      });

      expect(errors).toHaveLength(0);
    });

    it('accepts positive defaultTemperature', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'm',
        displayName: 'M',
        defaultTemperature: 1.5,
      });

      expect(errors).toHaveLength(0);
    });

    it('accepts null defaultTemperature', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'm',
        displayName: 'M',
        defaultTemperature: null,
      });

      expect(errors).toHaveLength(0);
    });

    it('rejects negative defaultTemperature', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'm',
        displayName: 'M',
        defaultTemperature: -0.1,
      });

      const err = errors.find((e) => e.property === 'defaultTemperature');
      expect(err).toBeDefined();
    });

    it('rejects non-numeric defaultTemperature', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'm',
        displayName: 'M',
        defaultTemperature: 'warm',
      });

      const err = errors.find((e) => e.property === 'defaultTemperature');
      expect(err).toBeDefined();
    });
  });

  describe('defaultMaxTokens bounds', () => {
    it('accepts positive integer defaultMaxTokens', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'm',
        displayName: 'M',
        defaultMaxTokens: 4096,
      });

      expect(errors).toHaveLength(0);
    });

    it('accepts null defaultMaxTokens', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'm',
        displayName: 'M',
        defaultMaxTokens: null,
      });

      expect(errors).toHaveLength(0);
    });

    it('rejects zero defaultMaxTokens', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'm',
        displayName: 'M',
        defaultMaxTokens: 0,
      });

      const err = errors.find((e) => e.property === 'defaultMaxTokens');
      expect(err).toBeDefined();
    });

    it('rejects negative defaultMaxTokens', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'm',
        displayName: 'M',
        defaultMaxTokens: -500,
      });

      const err = errors.find((e) => e.property === 'defaultMaxTokens');
      expect(err).toBeDefined();
    });

    it('rejects non-integer defaultMaxTokens', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'm',
        displayName: 'M',
        defaultMaxTokens: 2048.5,
      });

      const err = errors.find((e) => e.property === 'defaultMaxTokens');
      expect(err).toBeDefined();
    });
  });

  describe('enabled field', () => {
    it('accepts boolean enabled', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'm',
        displayName: 'M',
        enabled: true,
      });

      expect(errors).toHaveLength(0);
    });

    it('rejects non-boolean enabled', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'm',
        displayName: 'M',
        enabled: 'true',
      });

      const err = errors.find((e) => e.property === 'enabled');
      expect(err).toBeDefined();
    });
  });

  describe('unknown properties rejection (forbidNonWhitelisted)', () => {
    it('rejects client attempt to supply source', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'claude-sonnet-5',
        displayName: 'Claude Sonnet 3.5',
        source: 'manual',
      });

      const err = errors.find((e) => e.property === 'source');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('whitelistValidation');
    });

    it('rejects client attempt to supply providerId', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'claude-sonnet-5',
        displayName: 'Claude Sonnet 3.5',
        providerId: '018f3a9e-0000-7000-8000-000000000001',
      });

      const err = errors.find((e) => e.property === 'providerId');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('whitelistValidation');
    });

    it('rejects client attempt to supply id', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'claude-sonnet-5',
        displayName: 'Claude Sonnet 3.5',
        id: '018f3a9e-0000-7000-8000-000000000001',
      });

      const err = errors.find((e) => e.property === 'id');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('whitelistValidation');
    });

    it('rejects client attempt to supply createdAt/updatedAt', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'claude-sonnet-5',
        displayName: 'Claude Sonnet 3.5',
        createdAt: '2026-10-24T00:00:00.000Z',
        updatedAt: '2026-10-24T00:00:00.000Z',
      });

      expect(errors.some((e) => e.property === 'createdAt')).toBe(true);
      expect(errors.some((e) => e.property === 'updatedAt')).toBe(true);
    });

    it('rejects arbitrary unknown properties', async () => {
      const { errors } = await validateDto({
        modelIdentifier: 'claude-sonnet-5',
        displayName: 'Claude Sonnet 3.5',
        capabilities: ['vision'],
      });

      const err = errors.find((e) => e.property === 'capabilities');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('whitelistValidation');
    });
  });
});
