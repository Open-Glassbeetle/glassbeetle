import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { newId } from '../persistence/identifiers.js';
import {
  INVALID_IDENTIFIER_CODE,
  ParseUuidV7Pipe,
} from './parse-uuid-v7.pipe.js';

describe('ParseUuidV7Pipe', () => {
  const pipe = new ParseUuidV7Pipe();
  const metadata = { type: 'param', data: 'agentId' } as const;

  it('passes a UUIDv7 through unchanged', async () => {
    const id = newId();
    await expect(pipe.transform(id, metadata)).resolves.toBe(id);
  });

  it.each([
    ['a non-UUID string', 'not-a-uuid'],
    ['a UUIDv4', '550e8400-e29b-41d4-a716-446655440000'],
    ['an empty string', ''],
    ['a non-string', 42],
    ['undefined', undefined],
  ])('rejects %s with a typed 400', async (_label, value) => {
    const error = await pipe
      .transform(value, metadata)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual({
      code: INVALID_IDENTIFIER_CODE,
      message: 'agentId must be a UUIDv7',
    });
  });

  it('never echoes the rejected value', async () => {
    const value = 'x'.repeat(4000);
    const error = (await pipe
      .transform(value, metadata)
      .catch((e: unknown) => e)) as Error;

    expect(error.message).not.toContain(value);
  });
});
