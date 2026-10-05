import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateSharedMemoryDto } from './update-shared-memory.dto.js';

const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

async function validateDto(payload: Record<string, unknown>) {
  const instance = plainToInstance(UpdateSharedMemoryDto, payload);
  return validate(instance, VALIDATION_OPTIONS);
}

describe('UpdateSharedMemoryDto', () => {
  it('passes validation with an empty payload (no fields modified)', async () => {
    const errors = await validateDto({});
    expect(errors).toHaveLength(0);
  });

  it('passes validation with valid content only', async () => {
    const errors = await validateDto({
      content: 'Updated content text.',
    });
    expect(errors).toHaveLength(0);
  });

  it('passes validation with valid tags only', async () => {
    const errors = await validateDto({
      tags: ['new-tag-1', 'new-tag-2'],
    });
    expect(errors).toHaveLength(0);
  });

  it('passes validation with empty tags array (clears tags)', async () => {
    const errors = await validateDto({
      tags: [],
    });
    expect(errors).toHaveLength(0);
  });

  it('passes validation with tags set to null (clears tags)', async () => {
    const errors = await validateDto({
      tags: null,
    });
    expect(errors).toHaveLength(0);
  });

  it('fails validation when content is explicitly null', async () => {
    const errors = await validateDto({
      content: null,
    });
    expect(errors.length).toBeGreaterThan(0);
    const contentError = errors.find((e) => e.property === 'content');
    expect(contentError).toBeDefined();
    expect(contentError?.constraints).toHaveProperty('isString');
  });

  it('fails validation when content is an empty string', async () => {
    const errors = await validateDto({
      content: '',
    });
    expect(errors.length).toBeGreaterThan(0);
    const contentError = errors.find((e) => e.property === 'content');
    expect(contentError).toBeDefined();
    expect(contentError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('fails validation when content is not a string', async () => {
    const errors = await validateDto({
      content: 12345,
    });
    expect(errors.length).toBeGreaterThan(0);
    const contentError = errors.find((e) => e.property === 'content');
    expect(contentError).toBeDefined();
    expect(contentError?.constraints).toHaveProperty('isString');
  });

  it('fails validation when tags is not an array', async () => {
    const errors = await validateDto({
      tags: 'not-an-array',
    });
    expect(errors.length).toBeGreaterThan(0);
    const tagsError = errors.find((e) => e.property === 'tags');
    expect(tagsError).toBeDefined();
    expect(tagsError?.constraints).toHaveProperty('isArray');
  });

  it('fails validation when tags contains non-string items', async () => {
    const errors = await validateDto({
      tags: ['valid', 999],
    });
    expect(errors.length).toBeGreaterThan(0);
    const tagsError = errors.find((e) => e.property === 'tags');
    expect(tagsError).toBeDefined();
    expect(tagsError?.constraints).toHaveProperty('isString');
  });

  it('fails validation when tags contains empty strings', async () => {
    const errors = await validateDto({
      tags: ['valid', ''],
    });
    expect(errors.length).toBeGreaterThan(0);
    const tagsError = errors.find((e) => e.property === 'tags');
    expect(tagsError).toBeDefined();
    expect(tagsError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('rejects agentId in request body', async () => {
    const errors = await validateDto({
      agentId: '018f3a9e-0000-7000-8000-000000000001',
    });
    expect(errors.length).toBeGreaterThan(0);
    const properties = errors.map((e) => e.property);
    expect(properties).toContain('agentId');
  });

  it('rejects client-supplied id, createdAt, or updatedAt', async () => {
    const errors = await validateDto({
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
