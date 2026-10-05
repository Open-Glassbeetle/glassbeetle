import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Payload for adding a private memory to an agent (POST /api/v1/agents/:agentId/memories).
 *
 * Rules:
 * - `content`: Required non-empty string with an upper bound of 100,000 characters.
 * - `tags`: Optional array of non-empty strings. Non-string elements are rejected.
 * - `agentId`: Provided via route path, not body. Any attempt to supply agentId in body is rejected.
 * - Server-managed fields (`id`, `createdAt`, `updatedAt`) are rejected by ValidationPipe.
 */
export class CreateAgentMemoryDto {
  @ApiProperty({
    description: 'Memory content text (facts, preferences, or context)',
    example: 'Prefers TypeScript over Python for backend services.',
    maxLength: 100_000,
  })
  @IsString({ message: 'content must be a string' })
  @IsNotEmpty({ message: 'content must not be empty' })
  @MaxLength(100_000, { message: 'content must not exceed 100000 characters' })
  readonly content!: string;

  @ApiPropertyOptional({
    description: 'Optional list of classification or topic tags',
    example: ['project-x', 'preference'],
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: 'tags must be an array' })
  @IsString({ each: true, message: 'each tag must be a string' })
  @IsNotEmpty({ each: true, message: 'tags cannot contain empty strings' })
  readonly tags?: string[];
}
