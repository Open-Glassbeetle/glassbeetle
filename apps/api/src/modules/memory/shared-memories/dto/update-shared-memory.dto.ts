import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { MAX_TAG_LENGTH, MAX_TAGS_PER_MEMORY } from '../../tags/index.js';

/**
 * Payload for partially updating an existing shared memory (PATCH /api/v1/memories/:memoryId).
 *
 * Rules:
 * - `content`: Optional string; if provided, must be non-empty and <= 100,000 characters.
 *   Explicit null or empty string is rejected with 400.
 * - `tags`: Optional array of non-empty strings, or null/empty array to clear tags.
 *   Non-string items or empty strings inside the array are rejected with 400.
 *   At most 50 tags, each at most 50 characters, checked on the raw input before
 *   normalisation (see docs/memory-tags.md).
 * - Server-managed fields (`id`, `createdAt`, `updatedAt`) and unwhitelisted fields
 *   (e.g., `agentId`) are rejected by ValidationPipe.
 */
export class UpdateSharedMemoryDto {
  @ApiPropertyOptional({
    description: 'Updated shared memory content text',
    example: 'Always format code using Prettier and Oxlint.',
    maxLength: 100_000,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: 'content must be a string' })
  @IsNotEmpty({ message: 'content must not be empty' })
  @MaxLength(100_000, { message: 'content must not exceed 100000 characters' })
  readonly content?: string;

  @ApiPropertyOptional({
    description: 'Updated tags array or null/empty array to clear tags',
    example: ['conventions', 'style'],
    type: [String],
    maxItems: MAX_TAGS_PER_MEMORY,
    nullable: true,
  })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsArray({ message: 'tags must be an array' })
  @IsString({ each: true, message: 'each tag must be a string' })
  @IsNotEmpty({ each: true, message: 'tags cannot contain empty strings' })
  @ArrayMaxSize(MAX_TAGS_PER_MEMORY, {
    message: `tags must not contain more than ${MAX_TAGS_PER_MEMORY} items`,
  })
  @MaxLength(MAX_TAG_LENGTH, {
    each: true,
    message: `each tag must not exceed ${MAX_TAG_LENGTH} characters`,
  })
  readonly tags?: string[] | null;
}
