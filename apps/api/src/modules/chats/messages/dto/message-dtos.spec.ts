import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  CreateMessageDto,
  ListMessagesQueryDto,
  mapMessageRowToResponse,
  type MessageRow,
} from './index.js';

const VALIDATION_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

async function validateDto(cls: any, payload: Record<string, unknown>) {
  return validate(plainToInstance(cls, payload), VALIDATION_OPTIONS);
}

describe('ListMessagesQueryDto', () => {
  it('accepts empty query and applies defaults', async () => {
    const dto = plainToInstance(ListMessagesQueryDto, {});
    const errors = await validate(dto, VALIDATION_OPTIONS);

    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(50);
    expect(dto.offset).toBe(0);
  });

  it('accepts valid roles', async () => {
    for (const role of ['user', 'assistant', 'system', 'tool'] as const) {
      const errors = await validateDto(ListMessagesQueryDto, { role });
      expect(errors).toHaveLength(0);
    }
  });

  it('rejects invalid role', async () => {
    const errors = await validateDto(ListMessagesQueryDto, { role: 'superuser' });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('role');
  });

  it('accepts valid statuses', async () => {
    for (const status of ['pending', 'streaming', 'complete', 'error'] as const) {
      const errors = await validateDto(ListMessagesQueryDto, { status });
      expect(errors).toHaveLength(0);
    }
  });

  it('rejects invalid status', async () => {
    const errors = await validateDto(ListMessagesQueryDto, { status: 'cancelled' });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('status');
  });

  it('accepts agentId string and "null"', async () => {
    expect(
      await validateDto(ListMessagesQueryDto, { agentId: '018f3a9e-0000-7000-8000-000000000001' }),
    ).toHaveLength(0);
    expect(await validateDto(ListMessagesQueryDto, { agentId: 'null' })).toHaveLength(0);
  });

  it('accepts valid cursor parameters', async () => {
    expect(await validateDto(ListMessagesQueryDto, { before: 10, after: 5 })).toHaveLength(0);
    expect(await validateDto(ListMessagesQueryDto, { after: 0 })).toHaveLength(0);
    expect(await validateDto(ListMessagesQueryDto, { before: 1 })).toHaveLength(0);
  });

  it('rejects invalid cursor parameters', async () => {
    // before must be >= 1
    const beforeZero = await validateDto(ListMessagesQueryDto, { before: 0 });
    expect(beforeZero).toHaveLength(1);
    expect(beforeZero[0].property).toBe('before');

    // after must be >= 0
    const afterNeg = await validateDto(ListMessagesQueryDto, { after: -1 });
    expect(afterNeg).toHaveLength(1);
    expect(afterNeg[0].property).toBe('after');

    // float is not an integer
    const floatCursor = await validateDto(ListMessagesQueryDto, { before: 1.5 });
    expect(floatCursor).toHaveLength(1);
    expect(floatCursor[0].property).toBe('before');
  });

  it('enforces limit and offset bounds', async () => {
    expect(await validateDto(ListMessagesQueryDto, { limit: 100 })).toHaveLength(0);
    expect(await validateDto(ListMessagesQueryDto, { limit: 1 })).toHaveLength(0);

    const limitTooHigh = await validateDto(ListMessagesQueryDto, { limit: 101 });
    expect(limitTooHigh).toHaveLength(1);
    expect(limitTooHigh[0].property).toBe('limit');

    const limitTooLow = await validateDto(ListMessagesQueryDto, { limit: 0 });
    expect(limitTooLow).toHaveLength(1);
    expect(limitTooLow[0].property).toBe('limit');

    const offsetNegative = await validateDto(ListMessagesQueryDto, { offset: -1 });
    expect(offsetNegative).toHaveLength(1);
    expect(offsetNegative[0].property).toBe('offset');
  });

  it('rejects non-whitelisted parameters', async () => {
    const errors = await validateDto(ListMessagesQueryDto, { unknownProp: 'value' });
    expect(errors).toHaveLength(1);
  });
});

describe('mapMessageRowToResponse', () => {
  it('maps snake_case to camelCase and preserves fields', () => {
    const row: MessageRow = {
      id: 'msg-1',
      chat_id: 'chat-1',
      sequence: 1,
      role: 'assistant',
      agent_id: 'agent-1',
      content: 'Here is your answer',
      status: 'complete',
      token_count: 55,
      created_at: '2026-10-18T00:00:00.000Z',
    };

    const res = mapMessageRowToResponse(row);
    expect(res).toEqual({
      id: 'msg-1',
      chatId: 'chat-1',
      sequence: 1,
      role: 'assistant',
      agentId: 'agent-1',
      content: 'Here is your answer',
      status: 'complete',
      tokenCount: 55,
      createdAt: '2026-10-18T00:00:00.000Z',
    });
  });

  it('preserves null for nullable columns (agent_id and token_count)', () => {
    const row: MessageRow = {
      id: 'msg-2',
      chat_id: 'chat-1',
      sequence: 2,
      role: 'user',
      agent_id: null,
      content: 'Hello',
      status: 'pending',
      token_count: null,
      created_at: '2026-10-18T00:00:01.000Z',
    };

    const res = mapMessageRowToResponse(row);
    expect(res.agentId).toBeNull();
    expect(res.tokenCount).toBeNull();
    expect(res.status).toBe('pending');
    expect(res.content).toBe('Hello');
  });

  it('returns empty content and streaming status verbatim', () => {
    const row: MessageRow = {
      id: 'msg-3',
      chat_id: 'chat-1',
      sequence: 3,
      role: 'assistant',
      agent_id: 'agent-1',
      content: '',
      status: 'streaming',
      token_count: null,
      created_at: '2026-10-18T00:00:02.000Z',
    };

    const res = mapMessageRowToResponse(row);
    expect(res.content).toBe('');
    expect(res.status).toBe('streaming');
  });
});

describe('CreateMessageDto', () => {
  it('accepts valid message with content only and defaults role to user', async () => {
    const dto = plainToInstance(CreateMessageDto, {
      content: 'Hello, Antigravity!',
    });
    const errors = await validate(dto, VALIDATION_OPTIONS);

    expect(errors).toHaveLength(0);
    expect(dto.content).toBe('Hello, Antigravity!');
    expect(dto.role).toBe('user');
  });

  it('accepts explicit valid roles', async () => {
    for (const role of ['user', 'assistant', 'system', 'tool'] as const) {
      const errors = await validateDto(CreateMessageDto, {
        content: 'Sample text',
        role,
      });
      expect(errors).toHaveLength(0);
    }
  });

  it('rejects invalid role with 400 validation error', async () => {
    const errors = await validateDto(CreateMessageDto, {
      content: 'Sample text',
      role: 'moderator',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('role');
  });

  it('rejects missing or empty content', async () => {
    const missing = await validateDto(CreateMessageDto, {});
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.some((e) => e.property === 'content')).toBe(true);

    const empty = await validateDto(CreateMessageDto, { content: '' });
    expect(empty.length).toBeGreaterThan(0);
    expect(empty.some((e) => e.property === 'content')).toBe(true);
  });

  it('rejects non-string content', async () => {
    const nonString = await validateDto(CreateMessageDto, { content: 12345 });
    expect(nonString.length).toBeGreaterThan(0);
    expect(nonString.some((e) => e.property === 'content')).toBe(true);
  });

  it('accepts valid agentId string or null/omitted', async () => {
    const withAgent = await validateDto(CreateMessageDto, {
      content: 'Team reply',
      agentId: '018f3a9e-0000-7000-8000-000000000001',
    });
    expect(withAgent).toHaveLength(0);

    const withNull = await validateDto(CreateMessageDto, {
      content: 'User message',
      agentId: null,
    });
    expect(withNull).toHaveLength(0);
  });

  it('rejects invalid agentId (empty string or non-string)', async () => {
    const emptyAgent = await validateDto(CreateMessageDto, {
      content: 'Text',
      agentId: '',
    });
    expect(emptyAgent).toHaveLength(1);
    expect(emptyAgent[0].property).toBe('agentId');

    const nonStringAgent = await validateDto(CreateMessageDto, {
      content: 'Text',
      agentId: 42,
    });
    expect(nonStringAgent).toHaveLength(1);
    expect(nonStringAgent[0].property).toBe('agentId');
  });

  it('rejects client-supplied server-managed fields with 400', async () => {
    const fields = [
      { id: '018f3a9e-0000-7000-8000-000000000001' },
      { sequence: 1 },
      { status: 'complete' },
      { tokenCount: 42 },
      { token_count: 42 },
      { createdAt: '2026-10-18T00:00:00.000Z' },
      { created_at: '2026-10-18T00:00:00.000Z' },
    ];

    for (const field of fields) {
      const payload = { content: 'Test message', ...field };
      const errors = await validateDto(CreateMessageDto, payload);
      expect(errors.length).toBeGreaterThanOrEqual(1);
      const prop = Object.keys(field)[0];
      expect(errors.some((e) => e.property === prop)).toBe(true);
    }
  });

  it('rejects unknown properties under forbidNonWhitelisted', async () => {
    const errors = await validateDto(CreateMessageDto, {
      content: 'Test message',
      extraField: 'not-allowed',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('extraField');
  });
});
