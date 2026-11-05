import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { MAX_ARTIFACT_TITLE_LENGTH } from './artifact-validators.js';
import { UpdateArtifactDto } from './update-artifact.dto.js';

const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

async function validateDto(payload: Record<string, unknown>) {
  const instance = plainToInstance(UpdateArtifactDto, payload);
  return validate(instance, VALIDATION_OPTIONS);
}

describe('UpdateArtifactDto', () => {
  it('accepts an empty payload (no-op update)', async () => {
    const errors = await validateDto({});
    expect(errors).toHaveLength(0);
  });

  it('accepts updating title alone', async () => {
    const errors = await validateDto({ title: 'New Artifact Title' });
    expect(errors).toHaveLength(0);
  });

  it('accepts updating type to another valid type', async () => {
    const errors = await validateDto({ type: 'structured' });
    expect(errors).toHaveLength(0);
  });

  it('accepts explicit null for nullable parent references and mimeType', async () => {
    const errors = await validateDto({
      mimeType: null,
      projectId: null,
      chatId: null,
      agentId: null,
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects empty title string', async () => {
    const errors = await validateDto({ title: '' });
    expect(errors.length).toBeGreaterThan(0);
    const titleError = errors.find((e) => e.property === 'title');
    expect(titleError).toBeDefined();
    expect(titleError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('rejects title exceeding maximum length', async () => {
    const errors = await validateDto({
      title: 'a'.repeat(MAX_ARTIFACT_TITLE_LENGTH + 1),
    });
    expect(errors.length).toBeGreaterThan(0);
    const titleError = errors.find((e) => e.property === 'title');
    expect(titleError).toBeDefined();
    expect(titleError?.constraints).toHaveProperty('maxLength');
  });

  it('rejects invalid type', async () => {
    const errors = await validateDto({ type: 'audio_snippet' });
    expect(errors.length).toBeGreaterThan(0);
    const typeError = errors.find((e) => e.property === 'type');
    expect(typeError).toBeDefined();
    expect(typeError?.constraints).toHaveProperty('isIn');
  });

  it('rejects server-managed fields', async () => {
    for (const forbidden of [
      'id',
      'version',
      'hasFile',
      'createdAt',
      'updatedAt',
      'created_at',
      'updated_at',
    ]) {
      const errors = await validateDto({ [forbidden]: 'disallowed' });
      expect(errors.some((e) => e.property === forbidden)).toBe(true);
    }
  });
});

