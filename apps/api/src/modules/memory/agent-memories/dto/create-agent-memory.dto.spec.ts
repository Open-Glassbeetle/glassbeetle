import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateAgentMemoryDto } from './create-agent-memory.dto.js';

const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

async function validateDto(payload: Record<string, unknown>) {
  const instance = plainToInstance(CreateAgentMemoryDto, payload);
  return validate(instance, VALIDATION_OPTIONS);
}

describe('CreateAgentMemoryDto', () => {
  it('passes validation with valid content and tags', async () => {
    const errors = await validateDto({
      content: 'Prefers TypeScript over Python.',
      tags: ['preference', 'backend'],
    });
    expect(errors).toHaveLength(0);
  });

  it('passes validation when tags is omitted', async () => {
    const errors = await validateDto({
      content: 'Prefers TypeScript over Python.',
    });
    expect(errors).toHaveLength(0);
  });

  it('passes validation when tags is an empty array', async () => {
    const errors = await validateDto({
      content: 'Prefers TypeScript over Python.',
      tags: [],
    });
    expect(errors).toHaveLength(0);
  });

  it('fails validation when content is missing', async () => {
    const errors = await validateDto({
      tags: ['preference'],
    });
    expect(errors.length).toBeGreaterThan(0);
    const contentError = errors.find((e) => e.property === 'content');
    expect(contentError).toBeDefined();
    expect(contentError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('fails validation when content is an empty string', async () => {
    const errors = await validateDto({
      content: '',
      tags: ['preference'],
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
      content: 'Valid content',
      tags: 'not-an-array',
    });
    expect(errors.length).toBeGreaterThan(0);
    const tagsError = errors.find((e) => e.property === 'tags');
    expect(tagsError).toBeDefined();
    expect(tagsError?.constraints).toHaveProperty('isArray');
  });

  it('fails validation when tags contains non-string elements', async () => {
    const errors = await validateDto({
      content: 'Valid content',
      tags: ['valid', 123, true],
    });
    expect(errors.length).toBeGreaterThan(0);
    const tagsError = errors.find((e) => e.property === 'tags');
    expect(tagsError).toBeDefined();
    expect(tagsError?.constraints).toHaveProperty('isString');
  });

  it('fails validation when tags contains an empty string element', async () => {
    const errors = await validateDto({
      content: 'Valid content',
      tags: ['valid', ''],
    });
    expect(errors.length).toBeGreaterThan(0);
    const tagsError = errors.find((e) => e.property === 'tags');
    expect(tagsError).toBeDefined();
    expect(tagsError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('rejects agentId in request body (must come from path parameter)', async () => {
    const errors = await validateDto({
      content: 'Valid content',
      agentId: '018f3a9e-0000-7000-8000-000000000001',
    });
    expect(errors.length).toBeGreaterThan(0);
    const properties = errors.map((e) => e.property);
    expect(properties).toContain('agentId');
  });

  it('rejects client-supplied id, createdAt, or updatedAt', async () => {
    const errors = await validateDto({
      content: 'Valid content',
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
