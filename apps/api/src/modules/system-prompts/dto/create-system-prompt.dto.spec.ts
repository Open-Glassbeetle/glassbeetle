import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  CreateSystemPromptDto,
  MAX_SYSTEM_PROMPT_CONTENT_LENGTH,
  MAX_SYSTEM_PROMPT_NAME_LENGTH,
} from './create-system-prompt.dto.js';

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

  describe('text field length bounds', () => {
    it('accepts name at, just under, and rejects just over the limit', async () => {
      expect(
        await validateDto({
          name: 'a'.repeat(MAX_SYSTEM_PROMPT_NAME_LENGTH - 1),
          content: 'ok',
        }),
      ).toHaveLength(0);
      expect(
        await validateDto({
          name: 'a'.repeat(MAX_SYSTEM_PROMPT_NAME_LENGTH),
          content: 'ok',
        }),
      ).toHaveLength(0);

      const over = await validateDto({
        name: 'a'.repeat(MAX_SYSTEM_PROMPT_NAME_LENGTH + 1),
        content: 'ok',
      });
      expect(over.find((e) => e.property === 'name')?.constraints).toEqual({
        maxLength: `name must not exceed ${MAX_SYSTEM_PROMPT_NAME_LENGTH} characters`,
      });
    });

    it('accepts content at, just under, and rejects just over the limit', async () => {
      expect(
        await validateDto({
          name: 'Prompt',
          content: 'a'.repeat(MAX_SYSTEM_PROMPT_CONTENT_LENGTH - 1),
        }),
      ).toHaveLength(0);
      expect(
        await validateDto({
          name: 'Prompt',
          content: 'a'.repeat(MAX_SYSTEM_PROMPT_CONTENT_LENGTH),
        }),
      ).toHaveLength(0);

      const over = await validateDto({
        name: 'Prompt',
        content: 'a'.repeat(MAX_SYSTEM_PROMPT_CONTENT_LENGTH + 1),
      });
      expect(over.find((e) => e.property === 'content')?.constraints).toEqual({
        maxLength: `content must not exceed ${MAX_SYSTEM_PROMPT_CONTENT_LENGTH} characters`,
      });
    });

    it('counts characters, not bytes, for non-ASCII content at the limit', async () => {
      expect(
        await validateDto({
          name: 'Prompt',
          content: '記'.repeat(MAX_SYSTEM_PROMPT_CONTENT_LENGTH),
        }),
      ).toHaveLength(0);
      expect(
        (
          await validateDto({
            name: 'Prompt',
            content: '記'.repeat(MAX_SYSTEM_PROMPT_CONTENT_LENGTH + 1),
          })
        ).find((e) => e.property === 'content')?.constraints,
      ).toHaveProperty('maxLength');
    });
  });
});
