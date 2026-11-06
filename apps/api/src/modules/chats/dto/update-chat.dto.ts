import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { trimString } from '../../teams/dto/create-team.dto.js';
import {
  CONTEXT_SUMMARY_READONLY_ERROR_MESSAGE,
  DisallowField,
  OWNER_IMMUTABLE_ERROR_MESSAGE,
} from './chat-validators.js';
import { MAX_CHAT_TITLE_LENGTH } from './create-chat.dto.js';

/**
 * Request payload for updating an existing chat (PATCH).
 *
 * Handling of fields:
 * - Omitted (`undefined`): Field is not modified; existing value is retained.
 * - Explicit `null`: `title` or `projectId` is cleared (set to NULL).
 * - Empty body (`{}`): Treated as an idempotent no-op (200 OK, `updatedAt` untouched).
 * - Changing the owner (`agentId`, `teamId`) is strictly forbidden: message history
 *   was produced under the original owner, and reassigning it would make the conversation
 *   history incoherent.
 * - `context_summary` is read-only through this endpoint; it is managed by compaction.
 * - Server-managed fields (`id`, `createdAt`, `updatedAt`) are rejected.
 */
export class UpdateChatDto {
  @ApiPropertyOptional({
    type: String,
    description: 'Updated display title of the chat (or null to clear)',
    example: 'Updated Discussion Title',
    maxLength: MAX_CHAT_TITLE_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Transform(trimString)
  @IsString({ message: 'title must be a string' })
  @MaxLength(MAX_CHAT_TITLE_LENGTH, {
    message: `title must not exceed ${MAX_CHAT_TITLE_LENGTH} characters`,
  })
  title?: string | null;

  @ApiPropertyOptional({
    type: String,
    description: 'Project identifier to move the chat to, or null to detach from any project',
    example: '018f3a9e-0000-7000-8000-000000000002',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Transform(trimString)
  @IsString({ message: 'projectId must be a string' })
  @IsUUID('7', { message: 'projectId must be a UUIDv7' })
  projectId?: string | null;

  @DisallowField(OWNER_IMMUTABLE_ERROR_MESSAGE)
  agentId?: unknown;

  @DisallowField(OWNER_IMMUTABLE_ERROR_MESSAGE)
  teamId?: unknown;

  @DisallowField(CONTEXT_SUMMARY_READONLY_ERROR_MESSAGE)
  contextSummary?: unknown;

  @DisallowField(CONTEXT_SUMMARY_READONLY_ERROR_MESSAGE)
  context_summary?: unknown;

  @DisallowField('id is server-managed and cannot be supplied by the client')
  id?: unknown;

  @DisallowField('createdAt is server-managed and cannot be supplied by the client')
  createdAt?: unknown;

  @DisallowField('created_at is server-managed and cannot be supplied by the client')
  created_at?: unknown;

  @DisallowField('updatedAt is server-managed and cannot be supplied by the client')
  updatedAt?: unknown;

  @DisallowField('updated_at is server-managed and cannot be supplied by the client')
  updated_at?: unknown;
}
