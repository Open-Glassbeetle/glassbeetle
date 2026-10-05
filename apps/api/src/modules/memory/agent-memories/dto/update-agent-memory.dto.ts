import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/**
 * Payload for partially updating an existing agent memory (PATCH).
 *
 * Rules:
 * - `content`: Optional string; if provided, must be non-empty and <= 100,000 characters.
 *   Explicit null or empty string is rejected with 400.
 * - `tags`: Optional array of non-empty strings, or null/empty array to clear tags.
 *   Non-string items or empty strings inside the array are rejected with 400.
 * - `agentId`: Forbidden in body. Rejection occurs via ValidationPipe.
 * - Server-managed fields (`id`, `createdAt`, `updatedAt`): Forbidden in body.
 */
export class UpdateAgentMemoryDto {
  @ApiPropertyOptional({
    description: 'Updated memory content text',
    example: 'Prefers TypeScript over Python.',
    maxLength: 100_000,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: 'content must be a string' })
  @IsNotEmpty({ message: 'content must not be empty' })
  @MaxLength(100_000, { message: 'content must not exceed 100000 characters' })
  readonly content?: string;

  @ApiPropertyOptional({
    description: 'Updated tags array or null/empty array to clear tags',
    example: ['project-x', 'preference'],
    type: [String],
    nullable: true,
  })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsArray({ message: 'tags must be an array' })
  @IsString({ each: true, message: 'each tag must be a string' })
  @IsNotEmpty({ each: true, message: 'tags cannot contain empty strings' })
  readonly tags?: string[] | null;
}
