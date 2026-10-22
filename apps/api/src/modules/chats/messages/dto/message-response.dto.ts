import { ApiProperty } from '@nestjs/swagger';

/**
 * Valid roles for a message sender according to `messages` schema.
 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Runtime list of {@link MessageRole}, for `@IsIn()` and for the OpenAPI
 * enum. Kept in step with the `CHECK` constraint on `messages.role`.
 */
export const MESSAGE_ROLES: readonly MessageRole[] = [
  'user',
  'assistant',
  'system',
  'tool',
] as const;

/**
 * Lifecycle states of message generation according to `messages` schema.
 *
 * A message posted through the API is always `complete`. The other three
 * describe a message produced by inference — queued, being streamed, or
 * abandoned after a provider error — and nothing writes them yet.
 */
export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

/**
 * Runtime list of {@link MessageStatus}, for `@IsIn()` and for the OpenAPI
 * enum. Kept in step with the `CHECK` constraint on `messages.status`.
 */
export const MESSAGE_STATUSES: readonly MessageStatus[] = [
  'pending',
  'streaming',
  'complete',
  'error',
] as const;

/**
 * Public API representation of a chat message.
 */
export class MessageResponseDto {
  @ApiProperty({
    description: 'Unique message identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  readonly id!: string;

  @ApiProperty({
    description: 'Identifier of the chat this message belongs to',
    example: '018f3a9e-0000-7000-8000-000000000002',
  })
  readonly chatId!: string;

  @ApiProperty({
    description: 'Position in the chat sequence, counting from 1',
    example: 1,
  })
  readonly sequence!: number;

  @ApiProperty({
    description: 'Role of the message sender',
    enum: MESSAGE_ROLES,
    example: 'user',
  })
  readonly role!: MessageRole;

  @ApiProperty({
    type: String,
    description:
      'Which agent produced the message. Null for user messages, system messages, or when the producing agent was deleted.',
    example: '018f3a9e-0000-7000-8000-000000000003',
    nullable: true,
  })
  readonly agentId!: string | null;

  @ApiProperty({
    description:
      'Verbatim textual content of the message. In pending or streaming status, may be partial or empty.',
    example: 'Hello! How can I help you today?',
  })
  readonly content!: string;

  @ApiProperty({
    description: 'Generation status of the message',
    enum: MESSAGE_STATUSES,
    example: 'complete',
  })
  readonly status!: MessageStatus;

  @ApiProperty({
    type: 'integer',
    description:
      'Token count consumed by this message, populated once generation completes.',
    example: 42,
    nullable: true,
  })
  readonly tokenCount!: number | null;

  @ApiProperty({
    description: 'Creation timestamp in ISO-8601 UTC format',
    example: '2026-10-18T00:00:00.000Z',
  })
  readonly createdAt!: string;
}

/** Readonly view of {@link MessageResponseDto} for callers that only consume one. */
export type MessageResponse = Readonly<MessageResponseDto>;
