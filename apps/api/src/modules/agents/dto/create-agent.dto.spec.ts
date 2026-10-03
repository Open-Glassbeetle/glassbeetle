import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateAgentDto } from './create-agent.dto.js';

const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

async function validateDto(payload: Record<string, unknown>) {
  const instance = plainToInstance(CreateAgentDto, payload);
  return validate(instance, VALIDATION_OPTIONS);
}

describe('CreateAgentDto', () => {
  it('passes validation with minimal valid payload (name only)', async () => {
    const errors = await validateDto({ name: 'Research Assistant' });
    expect(errors).toHaveLength(0);
  });

  it('passes validation with a complete valid payload', async () => {
    const errors = await validateDto({
      name: 'Senior Developer',
      personality: 'Pragmatic, focused on clean architecture and test coverage',
      instructions: 'Always write tests first and format code with prettier',
      systemPromptId: '018f3a9e-0000-7000-8000-000000000001',
      modelId: '018f3a9e-0000-7000-8000-000000000002',
      temperature: 0.7,
      maxTokens: 2048,
      modelParams: {
        top_p: 0.9,
        frequency_penalty: 0.5,
        presence_penalty: 0.2,
      },
    });

    expect(errors).toHaveLength(0);
  });

  it('fails validation when name is missing', async () => {
    const errors = await validateDto({});

    expect(errors.length).toBeGreaterThan(0);
    const nameError = errors.find((e) => e.property === 'name');
    expect(nameError).toBeDefined();
    expect(nameError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('fails validation when name is empty', async () => {
    const errors = await validateDto({ name: '' });

    expect(errors.length).toBeGreaterThan(0);
    const nameError = errors.find((e) => e.property === 'name');
    expect(nameError).toBeDefined();
    expect(nameError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('fails validation when name is not a string', async () => {
    const errors = await validateDto({ name: 12345 });

    const nameError = errors.find((e) => e.property === 'name');
    expect(nameError).toBeDefined();
    expect(nameError?.constraints).toHaveProperty('isString');
  });

  describe('wrong property types', () => {
    it('fails when personality is not a string', async () => {
      const errors = await validateDto({ name: 'Agent', personality: 123 });
      const err = errors.find((e) => e.property === 'personality');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('isString');
    });

    it('fails when instructions is not a string', async () => {
      const errors = await validateDto({ name: 'Agent', instructions: false });
      const err = errors.find((e) => e.property === 'instructions');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('isString');
    });

    it('fails when systemPromptId is not a string', async () => {
      const errors = await validateDto({ name: 'Agent', systemPromptId: 100 });
      const err = errors.find((e) => e.property === 'systemPromptId');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('isString');
    });

    it('fails when modelId is not a string', async () => {
      const errors = await validateDto({ name: 'Agent', modelId: true });
      const err = errors.find((e) => e.property === 'modelId');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('isString');
    });

    it('fails when temperature is not a number', async () => {
      const errors = await validateDto({ name: 'Agent', temperature: 'high' });
      const err = errors.find((e) => e.property === 'temperature');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('isNumber');
    });

    it('fails when maxTokens is not an integer', async () => {
      const errors = await validateDto({ name: 'Agent', maxTokens: 'large' });
      const err = errors.find((e) => e.property === 'maxTokens');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('isInt');
    });

    it('fails when modelParams is not an object', async () => {
      const errors = await validateDto({
        name: 'Agent',
        modelParams: 'invalid-json-string',
      });
      const err = errors.find((e) => e.property === 'modelParams');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('isObject');
    });
  });

  describe('out-of-range bounds', () => {
    it('fails when temperature is negative', async () => {
      const errors = await validateDto({ name: 'Agent', temperature: -0.1 });
      const err = errors.find((e) => e.property === 'temperature');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('min');
    });

    it('fails when temperature exceeds 2.0', async () => {
      const errors = await validateDto({ name: 'Agent', temperature: 2.1 });
      const err = errors.find((e) => e.property === 'temperature');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('max');
    });

    it('passes for boundary temperatures 0 and 2.0', async () => {
      const errors0 = await validateDto({ name: 'Agent', temperature: 0 });
      expect(errors0).toHaveLength(0);

      const errors2 = await validateDto({ name: 'Agent', temperature: 2 });
      expect(errors2).toHaveLength(0);
    });

    it('fails when maxTokens is zero', async () => {
      const errors = await validateDto({ name: 'Agent', maxTokens: 0 });
      const err = errors.find((e) => e.property === 'maxTokens');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('min');
    });

    it('fails when maxTokens is negative', async () => {
      const errors = await validateDto({ name: 'Agent', maxTokens: -100 });
      const err = errors.find((e) => e.property === 'maxTokens');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('min');
    });

    it('fails when maxTokens is a float', async () => {
      const errors = await validateDto({ name: 'Agent', maxTokens: 100.5 });
      const err = errors.find((e) => e.property === 'maxTokens');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('isInt');
    });

    it('passes for boundary maxTokens = 1', async () => {
      const errors = await validateDto({ name: 'Agent', maxTokens: 1 });
      expect(errors).toHaveLength(0);
    });
  });

  describe('unknown properties rejection', () => {
    it('rejects client attempts to supply server-managed id', async () => {
      const errors = await validateDto({
        name: 'Agent',
        id: '018f3a9e-0000-7000-8000-000000000001',
      });
      const err = errors.find((e) => e.property === 'id');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('whitelistValidation');
    });

    it('rejects client attempts to supply server-managed timestamps', async () => {
      const errors = await validateDto({
        name: 'Agent',
        createdAt: '2026-10-04T00:00:00.000Z',
      });
      const err = errors.find((e) => e.property === 'createdAt');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('whitelistValidation');
    });

    it('rejects client attempts to supply picturePath', async () => {
      const errors = await validateDto({
        name: 'Agent',
        picturePath: 'pictures/local-avatar.png',
      });
      const err = errors.find((e) => e.property === 'picturePath');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('whitelistValidation');
    });

    it('rejects random undeclared properties', async () => {
      const errors = await validateDto({
        name: 'Agent',
        arbitraryKey: 'malicious-data',
      });
      const err = errors.find((e) => e.property === 'arbitraryKey');
      expect(err).toBeDefined();
      expect(err?.constraints).toHaveProperty('whitelistValidation');
    });
  });
});
