import { IsNotEmpty, IsString, ValidateIf } from 'class-validator';

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
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: 'content must be a string' })
  @IsNotEmpty({ message: 'content must not be empty' })
  content?: string;
}
