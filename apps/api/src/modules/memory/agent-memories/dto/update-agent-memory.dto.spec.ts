import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateAgentMemoryDto } from './update-agent-memory.dto.js';

const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

async function validateDto(payload: Record<string, unknown>) {
  const instance = plainToInstance(UpdateAgentMemoryDto, payload);
  return validate(instance, VALIDATION_OPTIONS);
}

describe('UpdateAgentMemoryDto', () => {
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

  describe('tag size limits', () => {
    const withTags = (tags: unknown[]) => validateDto({ tags });
    const tagsError = (errors: Awaited<ReturnType<typeof validateDto>>) =>
      errors.find((e) => e.property === 'tags');

    it('accepts exactly 50 tags', async () => {
      const tags = Array.from({ length: 50 }, (_, i) => `tag-${i}`);
      expect(await withTags(tags)).toHaveLength(0);
    });

    it('accepts 49 tags', async () => {
      const tags = Array.from({ length: 49 }, (_, i) => `tag-${i}`);
      expect(await withTags(tags)).toHaveLength(0);
    });

    it('rejects 51 tags', async () => {
      const tags = Array.from({ length: 51 }, (_, i) => `tag-${i}`);
      const error = tagsError(await withTags(tags));
      expect(error?.constraints).toEqual({
        arrayMaxSize: 'tags must not contain more than 50 items',
      });
    });

    it('accepts a tag of exactly 50 characters', async () => {
      expect(await withTags(['a'.repeat(50)])).toHaveLength(0);
    });

    it('accepts a tag of 49 characters', async () => {
      expect(await withTags(['a'.repeat(49)])).toHaveLength(0);
    });

    it('rejects a tag of 51 characters', async () => {
      const error = tagsError(await withTags(['ok', 'a'.repeat(51)]));
      expect(error?.constraints).toEqual({
        maxLength: 'each tag must not exceed 50 characters',
      });
    });

    it('counts characters, not bytes, for non-ASCII tags', async () => {
      // 50 characters, 150 bytes in UTF-8; 50 emoji are 100 UTF-16 code units.
      expect(await withTags(['記'.repeat(50)])).toHaveLength(0);
      expect(await withTags(['🧠'.repeat(50)])).toHaveLength(0);
      expect(
        tagsError(await withTags(['記'.repeat(51)]))?.constraints,
      ).toHaveProperty('maxLength');
    });
  });
});
