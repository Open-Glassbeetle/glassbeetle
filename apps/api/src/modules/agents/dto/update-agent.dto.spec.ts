import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateAgentDto } from './update-agent.dto.js';

const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

async function validateDto(payload: Record<string, unknown>) {
  const instance = plainToInstance(UpdateAgentDto, payload);
  return validate(instance, VALIDATION_OPTIONS);
}

describe('UpdateAgentDto', () => {
  it('passes validation with an empty object (no-op patch)', async () => {
    const errors = await validateDto({});
    expect(errors).toHaveLength(0);
  });

  it('passes validation with a valid partial update', async () => {
    const errors = await validateDto({
      name: 'Updated Name',
      temperature: 1.2,
    });
    expect(errors).toHaveLength(0);
  });

  describe('null-versus-omitted handling for nullable columns', () => {
    it('allows explicitly setting systemPromptId to null to unlink template', async () => {
      const errors = await validateDto({ systemPromptId: null });
      expect(errors).toHaveLength(0);
    });

    it('allows explicitly setting modelId to null to unlink model', async () => {
      const errors = await validateDto({ modelId: null });
      expect(errors).toHaveLength(0);
    });

    it('allows explicitly clearing personality, instructions, temperature, maxTokens, and modelParams', async () => {
      const errors = await validateDto({
        personality: null,
        instructions: null,
        temperature: null,
        maxTokens: null,
        modelParams: null,
      });
      expect(errors).toHaveLength(0);
    });
  });

  describe('name validation in updates', () => {
    it('rejects setting name to null (name column is NOT NULL)', async () => {
      const errors = await validateDto({ name: null });
      const nameError = errors.find((e) => e.property === 'name');
      expect(nameError).toBeDefined();
    });

    it('rejects setting name to an empty string', async () => {
      const errors = await validateDto({ name: '' });
      const nameError = errors.find((e) => e.property === 'name');
      expect(nameError).toBeDefined();
      expect(nameError?.constraints).toHaveProperty('isNotEmpty');
    });

    it('rejects setting name to a non-string value', async () => {
      const errors = await validateDto({ name: 42 });
      const nameError = errors.find((e) => e.property === 'name');
      expect(nameError).toBeDefined();
      expect(nameError?.constraints).toHaveProperty('isString');
    });
  });

  describe('bounds and type checks in updates', () => {
    it('fails when temperature is out of range', async () => {
      const errorsMin = await validateDto({ temperature: -0.5 });
      expect(errorsMin.find((e) => e.property === 'temperature')).toBeDefined();

      const errorsMax = await validateDto({ temperature: 3.0 });
      expect(errorsMax.find((e) => e.property === 'temperature')).toBeDefined();
    });

    it('fails when maxTokens is zero or negative', async () => {
      const errorsZero = await validateDto({ maxTokens: 0 });
      expect(errorsZero.find((e) => e.property === 'maxTokens')).toBeDefined();

      const errorsNeg = await validateDto({ maxTokens: -1 });
      expect(errorsNeg.find((e) => e.property === 'maxTokens')).toBeDefined();
    });

    it('fails when modelParams is not an object', async () => {
      const errors = await validateDto({ modelParams: 'invalid' });
      expect(errors.find((e) => e.property === 'modelParams')).toBeDefined();
    });
  });

  describe('unknown properties rejection', () => {
    it('rejects forbidden picturePath and picture fields in updates', async () => {
      const errors = await validateDto({
        picturePath: 'pictures/new.jpg',
        picture: 'pictures/new.jpg',
      });
      expect(errors.find((e) => e.property === 'picturePath')).toBeDefined();
      expect(errors.find((e) => e.property === 'picture')).toBeDefined();
    });

    it('rejects forbidden id and timestamp fields in updates', async () => {
      const errors = await validateDto({
        id: 'new-id',
        createdAt: '2026-10-04T00:00:00.000Z',
        updatedAt: '2026-10-04T00:00:00.000Z',
      });
      expect(errors).toHaveLength(3);
      for (const err of errors) {
        expect(err.constraints).toHaveProperty('whitelistValidation');
      }
    });
  });
});
