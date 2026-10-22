import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  MAX_SYSTEM_PROMPT_CONTENT_LENGTH,
  MAX_SYSTEM_PROMPT_NAME_LENGTH,
} from './create-system-prompt.dto.js';
import { UpdateSystemPromptDto } from './update-system-prompt.dto.js';

const VALIDATION_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

async function validateDto(payload: Record<string, unknown>) {
  const instance = plainToInstance(UpdateSystemPromptDto, payload);
  return validate(instance, VALIDATION_OPTIONS);
}

describe('UpdateSystemPromptDto', () => {
  it('passes validation with an empty object (no-op patch)', async () => {
    const errors = await validateDto({});
    expect(errors).toHaveLength(0);
  });

  it('passes validation when updating name only', async () => {
    const errors = await validateDto({
      name: 'Updated Name',
    });
    expect(errors).toHaveLength(0);
  });

  it('passes validation when updating content only', async () => {
    const errors = await validateDto({
      content: 'Updated content instructions.',
    });
    expect(errors).toHaveLength(0);
  });

  it('passes validation when updating both name and content', async () => {
    const errors = await validateDto({
      name: 'Updated Name',
      content: 'Updated content instructions.',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects setting name to null (name column is NOT NULL)', async () => {
    const errors = await validateDto({ name: null });
    expect(errors.length).toBeGreaterThan(0);
    const nameError = errors.find((e) => e.property === 'name');
    expect(nameError).toBeDefined();
  });

  it('rejects setting name to empty string', async () => {
    const errors = await validateDto({ name: '' });
    expect(errors.length).toBeGreaterThan(0);
    const nameError = errors.find((e) => e.property === 'name');
    expect(nameError).toBeDefined();
    expect(nameError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('rejects setting content to null (content column is NOT NULL)', async () => {
    const errors = await validateDto({ content: null });
    expect(errors.length).toBeGreaterThan(0);
    const contentError = errors.find((e) => e.property === 'content');
    expect(contentError).toBeDefined();
  });

  it('rejects setting content to empty string', async () => {
    const errors = await validateDto({ content: '' });
    expect(errors.length).toBeGreaterThan(0);
    const contentError = errors.find((e) => e.property === 'content');
    expect(contentError).toBeDefined();
    expect(contentError?.constraints).toHaveProperty('isNotEmpty');
  });

  it('rejects client-supplied server-managed fields (id, createdAt, updatedAt)', async () => {
    const errors = await validateDto({
      name: 'Valid Name',
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

  describe('text field length bounds in updates', () => {
    it('accepts name and content at their limits and rejects just over', async () => {
      expect(
        await validateDto({ name: 'a'.repeat(MAX_SYSTEM_PROMPT_NAME_LENGTH) }),
      ).toHaveLength(0);
      expect(
        await validateDto({
          content: 'a'.repeat(MAX_SYSTEM_PROMPT_CONTENT_LENGTH),
        }),
      ).toHaveLength(0);

      const overName = await validateDto({
        name: 'a'.repeat(MAX_SYSTEM_PROMPT_NAME_LENGTH + 1),
      });
      expect(overName.find((e) => e.property === 'name')?.constraints).toEqual({
        maxLength: `name must not exceed ${MAX_SYSTEM_PROMPT_NAME_LENGTH} characters`,
      });

      const overContent = await validateDto({
        content: 'a'.repeat(MAX_SYSTEM_PROMPT_CONTENT_LENGTH + 1),
      });
      expect(
        overContent.find((e) => e.property === 'content')?.constraints,
      ).toEqual({
        maxLength: `content must not exceed ${MAX_SYSTEM_PROMPT_CONTENT_LENGTH} characters`,
      });
    });

    it('counts characters, not bytes, for a non-ASCII name at the limit', async () => {
      expect(
        await validateDto({
          name: '記'.repeat(MAX_SYSTEM_PROMPT_NAME_LENGTH),
        }),
      ).toHaveLength(0);
      expect(
        (
          await validateDto({
            name: '記'.repeat(MAX_SYSTEM_PROMPT_NAME_LENGTH + 1),
          })
        ).find((e) => e.property === 'name')?.constraints,
      ).toHaveProperty('maxLength');
    });
  });
});
