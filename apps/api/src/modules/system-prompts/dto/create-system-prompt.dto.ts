import { IsNotEmpty, IsString } from 'class-validator';

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
  name!: string;

  @IsString({ message: 'content must be a string' })
  @IsNotEmpty({ message: 'content must not be empty' })
  content!: string;
}
