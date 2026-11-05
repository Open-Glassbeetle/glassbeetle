import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  CreateProjectDto,
  MAX_PROJECT_DESCRIPTION_LENGTH,
  MAX_PROJECT_NAME_LENGTH,
} from './create-project.dto.js';

const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

async function validateDto(payload: Record<string, unknown>) {
  const instance = plainToInstance(CreateProjectDto, payload);
  return validate(instance, VALIDATION_OPTIONS);
}

describe('CreateProjectDto', () => {
  it('accepts a valid name alone', async () => {
    const errors = await validateDto({ name: 'Glassbeetle Project' });
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid name and description', async () => {
    const errors = await validateDto({
      name: 'Glassbeetle Project',
      description: 'An organizing container for work',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts description: null', async () => {
    const errors = await validateDto({
      name: 'Glassbeetle Project',
      description: null,
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

  it('fails validation when name is empty string', async () => {
    const errors = await validateDto({ name: '' });
    expect(errors.length).toBeGreaterThan(0);
    const nameError = errors.find((e) => e.property === 'name');
    expect(nameError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('fails validation when name is whitespace only', async () => {
    const errors = await validateDto({ name: '    ' });
    expect(errors.length).toBeGreaterThan(0);
    const nameError = errors.find((e) => e.property === 'name');
    expect(nameError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('trims leading and trailing whitespace from name', () => {
    const instance = plainToInstance(CreateProjectDto, {
      name: '  Project X  ',
    });
    expect(instance.name).toBe('Project X');
  });

  it('fails validation when name exceeds maximum length', async () => {
    const errors = await validateDto({
      name: 'a'.repeat(MAX_PROJECT_NAME_LENGTH + 1),
    });
    expect(errors.length).toBeGreaterThan(0);
    const nameError = errors.find((e) => e.property === 'name');
    expect(nameError?.constraints).toHaveProperty('maxLength');
  });

  it('passes validation when name is at maximum length', async () => {
    const errors = await validateDto({
      name: 'a'.repeat(MAX_PROJECT_NAME_LENGTH),
    });
    expect(errors).toHaveLength(0);
  });

  it('fails validation when description exceeds maximum length', async () => {
    const errors = await validateDto({
      name: 'Project',
      description: 'a'.repeat(MAX_PROJECT_DESCRIPTION_LENGTH + 1),
    });
    expect(errors.length).toBeGreaterThan(0);
    const descError = errors.find((e) => e.property === 'description');
    expect(descError?.constraints).toHaveProperty('maxLength');
  });

  it('rejects forbidden server-managed and storage fields', async () => {
    for (const forbidden of [
      'id',
      'createdAt',
      'updatedAt',
      'created_at',
      'updated_at',
      'image',
      'image_path',
      'hasImage',
      'chatCount',
      'artifactCount',
    ]) {
      const errors = await validateDto({
        name: 'Project',
        [forbidden]: 'unexpected',
      });
      expect(errors.some((e) => e.property === forbidden)).toBe(true);
    }
  });
});

