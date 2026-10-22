import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Longest agent name the API accepts (matches teams and the user display name). */
export const MAX_AGENT_NAME_LENGTH = 120;

/**
 * Longest agent personality the API accepts.
 *
 * Prompt-budget prose, same order of magnitude as the user profile `about`
 * field: this text is composed into the agent's context.
 */
export const MAX_AGENT_PERSONALITY_LENGTH = 4000;

/**
 * Longest agent instructions the API accepts.
 *
 * Agent-specific instructions sit beside the system prompt in the context
 * layers. Cap below the 100 000-character memory/system-prompt budget, but
 * above a short bio so a detailed instruction block still fits.
 */
export const MAX_AGENT_INSTRUCTIONS_LENGTH = 10_000;

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
    maxLength: MAX_AGENT_NAME_LENGTH,
  })
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name must not be empty' })
  @MaxLength(MAX_AGENT_NAME_LENGTH, {
    message: `name must not exceed ${MAX_AGENT_NAME_LENGTH} characters`,
  })
  name!: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Free-text character description and behavioral demeanor',
    example: 'Friendly, inquisitive, and methodical researcher.',
    maxLength: MAX_AGENT_PERSONALITY_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'personality must be a string' })
  @MaxLength(MAX_AGENT_PERSONALITY_LENGTH, {
    message: `personality must not exceed ${MAX_AGENT_PERSONALITY_LENGTH} characters`,
  })
  personality?: string | null;

  @ApiPropertyOptional({
    type: String,
    description:
      'Agent-specific instructions, appended to the base system prompt',
    example: 'Always provide citations and references in IEEE format.',
    maxLength: MAX_AGENT_INSTRUCTIONS_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'instructions must be a string' })
  @MaxLength(MAX_AGENT_INSTRUCTIONS_LENGTH, {
    message: `instructions must not exceed ${MAX_AGENT_INSTRUCTIONS_LENGTH} characters`,
  })
  instructions?: string | null;

  @ApiPropertyOptional({
    type: String,
    description:
      'Identifier of the linked system prompt template (or null if unlinked)',
    example: '018f3a9e-0000-7000-8000-000000000001',
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'systemPromptId must be a string' })
  systemPromptId?: string | null;

  @ApiPropertyOptional({
    type: String,
    description: 'Identifier of the linked model (or null if unlinked)',
    example: '018f3a9e-0000-7000-8000-000000000002',
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'modelId must be a string' })
  modelId?: string | null;

  @ApiPropertyOptional({
    type: Number,
    description:
      'Sampling temperature for completions (bounded between 0 and 2)',
    example: 0.7,
    minimum: 0,
    maximum: 2,
    nullable: true,
  })
  @IsOptional()
  @IsNumber({}, { message: 'temperature must be a number' })
  @Min(0, { message: 'temperature must be at least 0' })
  @Max(2, { message: 'temperature must not exceed 2' })
  temperature?: number | null;

  @ApiPropertyOptional({
    type: 'integer',
    description:
      'Maximum number of tokens to generate in a completion (positive integer)',
    example: 4096,
    minimum: 1,
    nullable: true,
  })
  @IsOptional()
  @IsInt({ message: 'maxTokens must be an integer' })
  @Min(1, { message: 'maxTokens must be at least 1' })
  maxTokens?: number | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Arbitrary provider-specific additional parameters as a key-value object',
    example: { top_p: 0.9, frequency_penalty: 0.5 },
    nullable: true,
  })
  @IsOptional()
  @IsObject({ message: 'modelParams must be an object' })
  modelParams?: Record<string, unknown> | null;
}
