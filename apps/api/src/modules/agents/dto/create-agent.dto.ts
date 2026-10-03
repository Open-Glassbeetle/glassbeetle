import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Request payload for creating a new agent.
 *
 * Only `name` is required. All other fields are optional.
 * Server-managed fields (`id`, `created_at`, `updated_at`) and local file storage
 * paths (`picture_path`) are forbidden and rejected if present.
 */
export class CreateAgentDto {
  @ApiProperty({
    description: 'Display name of the agent',
    example: 'Research Assistant',
  })
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name must not be empty' })
  name!: string;

  @ApiPropertyOptional({
    description: 'Free-text character description and behavioral demeanor',
    example: 'Friendly, inquisitive, and methodical researcher.',
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'personality must be a string' })
  personality?: string | null;

  @ApiPropertyOptional({
    description:
      'Agent-specific instructions, appended to the base system prompt',
    example: 'Always provide citations and references in IEEE format.',
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'instructions must be a string' })
  instructions?: string | null;

  @ApiPropertyOptional({
    description:
      'Identifier of the linked system prompt template (or null if unlinked)',
    example: '018f3a9e-0000-7000-8000-000000000001',
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'systemPromptId must be a string' })
  systemPromptId?: string | null;

  @ApiPropertyOptional({
    description: 'Identifier of the linked model (or null if unlinked)',
    example: '018f3a9e-0000-7000-8000-000000000002',
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'modelId must be a string' })
  modelId?: string | null;

  @ApiPropertyOptional({
    description:
      'Sampling temperature for completions (bounded between 0 and 2)',
    example: 0.7,
    nullable: true,
  })
  @IsOptional()
  @IsNumber({}, { message: 'temperature must be a number' })
  @Min(0, { message: 'temperature must be at least 0' })
  @Max(2, { message: 'temperature must not exceed 2' })
  temperature?: number | null;

  @ApiPropertyOptional({
    description:
      'Maximum number of tokens to generate in a completion (positive integer)',
    example: 4096,
    nullable: true,
  })
  @IsOptional()
  @IsInt({ message: 'maxTokens must be an integer' })
  @Min(1, { message: 'maxTokens must be at least 1' })
  maxTokens?: number | null;

  @ApiPropertyOptional({
    description:
      'Arbitrary provider-specific additional parameters as a key-value object',
    example: { top_p: 0.9, frequency_penalty: 0.5 },
    nullable: true,
  })
  @IsOptional()
  @IsObject({ message: 'modelParams must be an object' })
  modelParams?: Record<string, unknown> | null;
}
