import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateBy,
  ValidateIf,
  isUUID,
  type ValidationOptions,
} from 'class-validator';
import { trimString } from '../../teams/dto/create-team.dto.js';
import {
  CONTEXT_SUMMARY_READONLY_ERROR_MESSAGE,
  DisallowField,
  ExactlyOneOwner,
} from './chat-validators.js';

/** Longest chat title the API accepts. */
export const MAX_CHAT_TITLE_LENGTH = 200;

/**
 * Request payload for creating a new chat.
 *
 * Exactly one owner must be provided: either `agentId` or `teamId`.
 * `title` and `projectId` are optional.
 * `context_summary` is read-only and rejected if provided.
 * Server-managed fields (`id`, `created_at`, `updated_at`) are forbidden.
 */

/**
 * UUIDv7 check that stays quiet when the value is absent or blank, so
 * {@link ExactlyOneOwner} can own those error messages.
 */
function IsUuidV7IfPresent(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isUuidV7IfPresent',
      validator: {
        validate: (value: unknown): boolean => {
          if (value === undefined || value === null) {
            return true;
          }
          if (typeof value !== 'string' || value.trim().length === 0) {
            return true;
          }
          return isUUID(value, '7');
        },
        defaultMessage: (args): string =>
          `${args?.property ?? 'value'} must be a UUIDv7`,
      },
    },
    validationOptions,
  );
}

export class CreateChatDto {
  @ApiPropertyOptional({
    type: String,
    description: 'Display title of the chat',
    example: 'Research on Agent Architectures',
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
    description: 'Identifier of the project this chat belongs to (or null if unassigned)',
    example: '018f3a9e-0000-7000-8000-000000000002',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Transform(trimString)
  @IsString({ message: 'projectId must be a string' })
  @IsUUID('7', { message: 'projectId must be a UUIDv7' })
  projectId?: string | null;

  @ApiPropertyOptional({
    type: String,
    description: 'Identifier of the owning agent (mutually exclusive with teamId)',
    example: '018f3a9e-0000-7000-8000-000000000003',
    nullable: true,
  })
  @ValidateIf((o: CreateChatDto) => !o.teamId || Boolean(o.agentId))
  @ExactlyOneOwner()
  @Transform(trimString)
  @IsUuidV7IfPresent({ message: 'agentId must be a UUIDv7' })
  agentId?: string | null;

  @ApiPropertyOptional({
    type: String,
    description: 'Identifier of the owning team (mutually exclusive with agentId)',
    example: '018f3a9e-0000-7000-8000-000000000004',
    nullable: true,
  })
  @ValidateIf((o: CreateChatDto) => Boolean(o.teamId))
  @Transform(trimString)
  @IsString({ message: 'teamId must be a string' })
  @IsUUID('7', { message: 'teamId must be a UUIDv7' })
  teamId?: string | null;

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
