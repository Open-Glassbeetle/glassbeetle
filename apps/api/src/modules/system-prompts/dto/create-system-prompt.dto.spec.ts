import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateSystemPromptDto } from './create-system-prompt.dto.js';

const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

async function validateDto(payload: Record<string, unknown>) {
  const instance = plainToInstance(CreateSystemPromptDto, payload);
  return validate(instance, VALIDATION_OPTIONS);
}

describe('CreateSystemPromptDto', () => {
  it('passes validation with a valid name and content', async () => {
    const errors = await validateDto({
      name: 'Default Assistant',
      content: 'You are a helpful assistant.',
    });
    expect(errors).toHaveLength(0);
  });

  it('fails validation when name is missing', async () => {
    const errors = await validateDto({
      content: 'You are a helpful assistant.',
    });
    expect(errors.length).toBeGreaterThan(0);
    const nameError = errors.find((e) => e.property === 'name');
    expect(nameError).toBeDefined();
    expect(nameError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('fails validation when name is empty string', async () => {
    const errors = await validateDto({
      name: '',
      content: 'You are a helpful assistant.',
    });
    expect(errors.length).toBeGreaterThan(0);
    const nameError = errors.find((e) => e.property === 'name');
    expect(nameError).toBeDefined();
    expect(nameError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('fails validation when name is not a string', async () => {
    const errors = await validateDto({
      name: 12345,
      content: 'You are a helpful assistant.',
    });
    expect(errors.length).toBeGreaterThan(0);
    const nameError = errors.find((e) => e.property === 'name');
    expect(nameError).toBeDefined();
    expect(nameError?.constraints).toHaveProperty('isString');
  });

  it('fails validation when content is missing', async () => {
    const errors = await validateDto({
      name: 'Default Assistant',
    });
    expect(errors.length).toBeGreaterThan(0);
    const contentError = errors.find((e) => e.property === 'content');
    expect(contentError).toBeDefined();
    expect(contentError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('fails validation when content is empty string', async () => {
    const errors = await validateDto({
      name: 'Default Assistant',
      content: '',
    });
    expect(errors.length).toBeGreaterThan(0);
    const contentError = errors.find((e) => e.property === 'content');
    expect(contentError).toBeDefined();
    expect(contentError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('fails validation when content is not a string', async () => {
    const errors = await validateDto({
      name: 'Default Assistant',
      content: { text: 'You are a helpful assistant.' },
    });
    expect(errors.length).toBeGreaterThan(0);
    const contentError = errors.find((e) => e.property === 'content');
    expect(contentError).toBeDefined();
    expect(contentError?.constraints).toHaveProperty('isString');
  });

  it('rejects client-supplied server-managed fields (id, createdAt, updatedAt)', async () => {
    const errors = await validateDto({
      name: 'Default Assistant',
      content: 'You are a helpful assistant.',
      id: '018f3a9e-0000-7000-8000-000000000001',
      createdAt: '2026-10-04T00:00:00.000Z',
      updatedAt: '2026-10-04T00:00:00.000Z',
    });
    expect(errors.length).toBeGreaterThan(0);
    const properties = errors.map((e) => e.property);
    expect(properties).toContain('id');
    expect(properties).toContain('createdAt');
    expect(properties).toContain('updatedAt');
  });
});
