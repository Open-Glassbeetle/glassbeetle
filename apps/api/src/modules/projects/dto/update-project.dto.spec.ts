import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { MAX_PROJECT_NAME_LENGTH } from './create-project.dto.js';
import { UpdateProjectDto } from './update-project.dto.js';

const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

async function validateDto(payload: Record<string, unknown>) {
  const instance = plainToInstance(UpdateProjectDto, payload);
  return validate(instance, VALIDATION_OPTIONS);
}

describe('UpdateProjectDto', () => {
  it('accepts an empty payload (no-op)', async () => {
    const errors = await validateDto({});
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid updated name', async () => {
    const errors = await validateDto({ name: 'New Project Name' });
    expect(errors).toHaveLength(0);
  });

  it('accepts description: null (to clear description)', async () => {
    const errors = await validateDto({ description: null });
    expect(errors).toHaveLength(0);
  });

  it('accepts description string', async () => {
    const errors = await validateDto({ description: 'New description' });
    expect(errors).toHaveLength(0);
  });

  it('rejects name: null', async () => {
    const errors = await validateDto({ name: null });
    expect(errors.length).toBeGreaterThan(0);
    const nameError = errors.find((e) => e.property === 'name');
    expect(nameError).toBeDefined();
  });

  it('rejects name: empty string', async () => {
    const errors = await validateDto({ name: '' });
    expect(errors.length).toBeGreaterThan(0);
    const nameError = errors.find((e) => e.property === 'name');
    expect(nameError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('rejects name: whitespace only', async () => {
    const errors = await validateDto({ name: '   ' });
    expect(errors.length).toBeGreaterThan(0);
    const nameError = errors.find((e) => e.property === 'name');
    expect(nameError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('rejects name exceeding maximum length', async () => {
    const errors = await validateDto({
      name: 'a'.repeat(MAX_PROJECT_NAME_LENGTH + 1),
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects forbidden and server-managed fields', async () => {
    for (const forbidden of [
      'id',
      'createdAt',
      'updatedAt',
      'image',
      'image_path',
      'hasImage',
    ]) {
      const errors = await validateDto({ [forbidden]: 'value' });
      expect(errors.some((e) => e.property === forbidden)).toBe(true);
    }
  });
});

