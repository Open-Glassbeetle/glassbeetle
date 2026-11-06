import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  BOTH_OWNERS_ERROR_MESSAGE,
  CONTEXT_SUMMARY_READONLY_ERROR_MESSAGE,
  NEITHER_OWNER_ERROR_MESSAGE,
  OWNER_IMMUTABLE_ERROR_MESSAGE,
} from './chat-validators.js';
import { CreateChatDto, MAX_CHAT_TITLE_LENGTH } from './create-chat.dto.js';
import { UpdateChatDto } from './update-chat.dto.js';

const VALIDATION_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

async function validateCreate(payload: Record<string, unknown>) {
  return validate(plainToInstance(CreateChatDto, payload), VALIDATION_OPTIONS);
}

async function validateUpdate(payload: Record<string, unknown>) {
  return validate(plainToInstance(UpdateChatDto, payload), VALIDATION_OPTIONS);
}

describe('CreateChatDto', () => {
  it('accepts an agent-owned chat', async () => {
    const errors = await validateCreate({
      agentId: '018f3a9e-0000-7000-8000-000000000001',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts a team-owned chat', async () => {
    const errors = await validateCreate({
      teamId: '018f3a9e-0000-7000-8000-000000000002',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts chat with title and projectId', async () => {
    const errors = await validateCreate({
      agentId: '018f3a9e-0000-7000-8000-000000000001',
      title: 'Sprint Planning',
      projectId: '018f3a9e-0000-7000-8000-000000000003',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects a chat with both agentId and teamId', async () => {
    const errors = await validateCreate({
      agentId: '018f3a9e-0000-7000-8000-000000000001',
      teamId: '018f3a9e-0000-7000-8000-000000000002',
    });
    expect(errors.length).toBeGreaterThan(0);
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages).toContain(BOTH_OWNERS_ERROR_MESSAGE);
  });

  it('rejects a chat with neither agentId nor teamId', async () => {
    const errors = await validateCreate({
      title: 'Orphan Chat',
    });
    expect(errors.length).toBeGreaterThan(0);
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages).toContain(NEITHER_OWNER_ERROR_MESSAGE);
  });


  it('rejects malformed UUIDv7 ids on create', async () => {
    const badAgent = await validateCreate({ agentId: 'not-a-uuid' });
    expect(
      badAgent.flatMap((e) => Object.values(e.constraints ?? {})).join(' '),
    ).toContain('agentId must be a UUIDv7');

    const badProject = await validateCreate({
      agentId: '018f3a9e-0000-7000-8000-000000000001',
      projectId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(
      badProject.flatMap((e) => Object.values(e.constraints ?? {})).join(' '),
    ).toContain('projectId must be a UUIDv7');
  });

  it('rejects empty object payload', async () => {
    const errors = await validateCreate({});
    expect(errors.length).toBeGreaterThan(0);
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages).toContain(NEITHER_OWNER_ERROR_MESSAGE);
  });

  it('rejects attempts to set contextSummary or context_summary', async () => {
    const errorsCamel = await validateCreate({
      agentId: '018f3a9e-0000-7000-8000-000000000001',
      contextSummary: 'Client provided summary',
    });
    expect(errorsCamel.length).toBeGreaterThan(0);
    const messagesCamel = errorsCamel.flatMap((e) =>
      Object.values(e.constraints ?? {}),
    );
    expect(messagesCamel).toContain(CONTEXT_SUMMARY_READONLY_ERROR_MESSAGE);

    const errorsSnake = await validateCreate({
      agentId: '018f3a9e-0000-7000-8000-000000000001',
      context_summary: 'Client provided summary',
    });
    expect(errorsSnake.length).toBeGreaterThan(0);
    const messagesSnake = errorsSnake.flatMap((e) =>
      Object.values(e.constraints ?? {}),
    );
    expect(messagesSnake).toContain(CONTEXT_SUMMARY_READONLY_ERROR_MESSAGE);
  });

  it('rejects server-managed fields', async () => {
    for (const property of ['id', 'createdAt', 'created_at', 'updatedAt', 'updated_at']) {
      const errors = await validateCreate({
        agentId: '018f3a9e-0000-7000-8000-000000000001',
        [property]: 'client-value',
      });
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it('enforces maximum title length', async () => {
    const valid = await validateCreate({
      agentId: '018f3a9e-0000-7000-8000-000000000001',
      title: 'a'.repeat(MAX_CHAT_TITLE_LENGTH),
    });
    expect(valid).toHaveLength(0);

    const overLong = await validateCreate({
      agentId: '018f3a9e-0000-7000-8000-000000000001',
      title: 'a'.repeat(MAX_CHAT_TITLE_LENGTH + 1),
    });
    expect(overLong.length).toBeGreaterThan(0);
  });

  it('trims title', () => {
    const dto = plainToInstance(CreateChatDto, {
      agentId: '018f3a9e-0000-7000-8000-000000000001',
      title: '  My Discussion  ',
    });
    expect(dto.title).toBe('My Discussion');
  });
});

describe('UpdateChatDto', () => {
  it('accepts an empty payload, which the service treats as a no-op', async () => {
    expect(await validateUpdate({})).toHaveLength(0);
  });

  it('accepts updated title and projectId', async () => {
    const errors = await validateUpdate({
      title: 'New Title',
      projectId: '018f3a9e-0000-7000-8000-000000000005',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts explicit null for title and projectId to clear them', async () => {
    const errors = await validateUpdate({
      title: null,
      projectId: null,
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects attempts to change the owner via agentId', async () => {
    const errors = await validateUpdate({
      agentId: '018f3a9e-0000-7000-8000-000000000002',
    });
    expect(errors.length).toBeGreaterThan(0);
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages).toContain(OWNER_IMMUTABLE_ERROR_MESSAGE);
  });

  it('rejects attempts to change the owner via teamId', async () => {
    const errors = await validateUpdate({
      teamId: '018f3a9e-0000-7000-8000-000000000004',
    });
    expect(errors.length).toBeGreaterThan(0);
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages).toContain(OWNER_IMMUTABLE_ERROR_MESSAGE);
  });

  it('rejects attempts to set contextSummary or context_summary', async () => {
    const errorsCamel = await validateUpdate({
      contextSummary: 'New summary',
    });
    expect(errorsCamel.length).toBeGreaterThan(0);
    const messagesCamel = errorsCamel.flatMap((e) =>
      Object.values(e.constraints ?? {}),
    );
    expect(messagesCamel).toContain(CONTEXT_SUMMARY_READONLY_ERROR_MESSAGE);

    const errorsSnake = await validateUpdate({
      context_summary: 'New summary',
    });
    expect(errorsSnake.length).toBeGreaterThan(0);
    const messagesSnake = errorsSnake.flatMap((e) =>
      Object.values(e.constraints ?? {}),
    );
    expect(messagesSnake).toContain(CONTEXT_SUMMARY_READONLY_ERROR_MESSAGE);
  });

  it('rejects server-managed fields in update', async () => {
    for (const property of ['id', 'createdAt', 'created_at', 'updatedAt', 'updated_at']) {
      const errors = await validateUpdate({
        [property]: 'client-value',
      });
      expect(errors.length).toBeGreaterThan(0);
    }
  });
});
