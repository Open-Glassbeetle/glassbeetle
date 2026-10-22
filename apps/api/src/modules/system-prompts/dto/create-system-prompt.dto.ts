import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Longest system prompt name the API accepts (matches agent/team names). */
export const MAX_SYSTEM_PROMPT_NAME_LENGTH = 120;

/**
 * Longest system prompt content the API accepts.
 *
 * Matches the memory content cap: this text is the prompt layer itself and
 * sits beside memory in the agent's composed context.
 */
export const MAX_SYSTEM_PROMPT_CONTENT_LENGTH = 100_000;

/**
 * Request payload for creating a new system prompt.
 *
 * Both `name` and `content` are required non-empty strings.
 * Server-managed fields (`id`, `createdAt`, `updatedAt`, `created_at`, `updated_at`)
 * are forbidden and rejected by ValidationPipe.
 */
export class CreateSystemPromptDto {
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name must not be empty' })
  @MaxLength(MAX_SYSTEM_PROMPT_NAME_LENGTH, {
    message: `name must not exceed ${MAX_SYSTEM_PROMPT_NAME_LENGTH} characters`,
  })
  name!: string;

  @IsString({ message: 'content must be a string' })
  @IsNotEmpty({ message: 'content must not be empty' })
  @MaxLength(MAX_SYSTEM_PROMPT_CONTENT_LENGTH, {
    message: `content must not exceed ${MAX_SYSTEM_PROMPT_CONTENT_LENGTH} characters`,
  })
  content!: string;
}
