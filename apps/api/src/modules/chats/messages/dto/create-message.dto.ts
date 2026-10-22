import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { DisallowField } from '../../dto/chat-validators.js';
import { MESSAGE_ROLES, type MessageRole } from './message-response.dto.js';

/**
 * Longest message content the API accepts.
 *
 * Matches the memory content cap: a conversational turn (and later model
 * output) can be large, and the JSON body limit is sized so 100 000 characters
 * remain reachable in any script.
 */
export const MAX_MESSAGE_CONTENT_LENGTH = 100_000;

/**
 * Request payload for appending a new message to a chat.
 *
 * Architectural decisions:
 * - Role selection: Client-supplied with a default of `'user'`. Allowing explicit
 *   roles (`user`, `assistant`, `system`, `tool`) enables conversation import and
 *   context seeding while remaining completely safe in a single-user local application.
 *   Defaulting to `'user'` preserves ergonomic safety when posting interactive turns.
 * - Agent attribution: `agentId` is optional. If provided, it must reference an
 *   existing agent in the database, but does not strictly require active membership
 *   in the chat's owning team. This permits guest agent contributions, messages from
 *   agents previously removed from the team, and imported historical transcripts.
 * - Server-managed fields: `id`, `sequence`, `status`, `tokenCount`, and `createdAt`
 *   (and snake_case counterparts) are strictly server-managed and rejected if supplied.
 */
export class CreateMessageDto {
  @ApiProperty({
    description: 'Verbatim textual content of the message',
    example: 'Hello! How can I configure my agent?',
    maxLength: MAX_MESSAGE_CONTENT_LENGTH,
  })
  @IsString({ message: 'content must be a string' })
  @IsNotEmpty({ message: 'content must not be empty' })
  @MaxLength(MAX_MESSAGE_CONTENT_LENGTH, {
    message: `content must not exceed ${MAX_MESSAGE_CONTENT_LENGTH} characters`,
  })
  content!: string;

  @ApiPropertyOptional({
    description:
      'Role of the message author. Defaults to "user" if omitted. ' +
      'Explicit roles permit seeding context or importing conversation histories.',
    enum: MESSAGE_ROLES,
    example: 'user',
    default: 'user',
  })
  @IsOptional()
  @IsIn(MESSAGE_ROLES, {
    message: `role must be one of: ${MESSAGE_ROLES.join(', ')}`,
  })
  role?: MessageRole = 'user';

  @ApiPropertyOptional({
    type: String,
    description:
      'Which agent produced the message. Optional for single-agent chats; relevant for team chats.',
    example: '018f3a9e-0000-7000-8000-000000000001',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString({ message: 'agentId must be a string' })
  @IsNotEmpty({ message: 'agentId must not be empty' })
  agentId?: string | null;

  @DisallowField('id is server-managed and cannot be supplied by the client')
  id?: unknown;

  @DisallowField(
    'sequence is server-managed and cannot be supplied by the client',
  )
  sequence?: unknown;

  @DisallowField(
    'status is server-managed and cannot be supplied by the client',
  )
  status?: unknown;

  @DisallowField(
    'tokenCount is server-managed and cannot be supplied by the client',
  )
  tokenCount?: unknown;

  @DisallowField(
    'token_count is server-managed and cannot be supplied by the client',
  )
  token_count?: unknown;

  @DisallowField(
    'createdAt is server-managed and cannot be supplied by the client',
  )
  createdAt?: unknown;

  @DisallowField(
    'created_at is server-managed and cannot be supplied by the client',
  )
  created_at?: unknown;
}
