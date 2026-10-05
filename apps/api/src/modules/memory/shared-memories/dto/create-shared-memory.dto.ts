import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Payload for adding a shared memory (POST /api/v1/memories).
 *
 * Rules:
 * - `content`: Required non-empty string with an upper bound of 100,000 characters.
 * - `tags`: Optional array of non-empty strings. Non-string elements are rejected.
 * - Server-managed fields (`id`, `createdAt`, `updatedAt`) and unwhitelisted fields
 *   (e.g., `agentId`) are rejected by ValidationPipe.
 */
export class CreateSharedMemoryDto {
  @ApiProperty({
    description:
      'Shared memory content text (global facts, preferences, or conventions)',
    example: 'Always format code using Prettier and Oxlint.',
    maxLength: 100_000,
  })
  @IsString({ message: 'content must be a string' })
  @IsNotEmpty({ message: 'content must not be empty' })
  @MaxLength(100_000, { message: 'content must not exceed 100000 characters' })
  readonly content!: string;

  @ApiPropertyOptional({
    description: 'Optional list of classification or topic tags',
    example: ['conventions', 'style'],
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: 'tags must be an array' })
  @IsString({ each: true, message: 'each tag must be a string' })
  @IsNotEmpty({ each: true, message: 'tags cannot contain empty strings' })
  readonly tags?: string[];
}
