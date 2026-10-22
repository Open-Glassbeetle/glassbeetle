import { IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import {
  MAX_SYSTEM_PROMPT_CONTENT_LENGTH,
  MAX_SYSTEM_PROMPT_NAME_LENGTH,
} from './create-system-prompt.dto.js';

/**
 * Request payload for updating an existing system prompt (PATCH).
 *
 * Both fields are optional, but neither may be set to null or empty string.
 * Omitted fields remain unchanged in the database.
 * Server-managed fields (`id`, `createdAt`, `updatedAt`) are rejected by ValidationPipe.
 */
export class UpdateSystemPromptDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name must not be empty' })
  @MaxLength(MAX_SYSTEM_PROMPT_NAME_LENGTH, {
    message: `name must not exceed ${MAX_SYSTEM_PROMPT_NAME_LENGTH} characters`,
  })
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: 'content must be a string' })
  @IsNotEmpty({ message: 'content must not be empty' })
  @MaxLength(MAX_SYSTEM_PROMPT_CONTENT_LENGTH, {
    message: `content must not exceed ${MAX_SYSTEM_PROMPT_CONTENT_LENGTH} characters`,
  })
  content?: string;
}
