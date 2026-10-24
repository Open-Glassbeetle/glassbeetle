import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Request payload for manually registering an AI model under a provider.
 *
 * `POST /api/v1/providers/:providerId/models`
 *
 * `providerId` comes from the URL path and must not be supplied in the body.
 * `source` is always set to `'manual'` by the server and must not be supplied.
 * Server-managed fields (`id`, `createdAt`, `updatedAt`) are forbidden.
 */
export class RegisterModelDto {
  @ApiProperty({
    description:
      'Exact model identifier string for provider API calls (e.g. "claude-sonnet-5", "qwen2.5:14b")',
    example: 'claude-sonnet-5',
    maxLength: 255,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'modelIdentifier must be a string' })
  @IsNotEmpty({ message: 'modelIdentifier must not be empty' })
  @MaxLength(255, {
    message: 'modelIdentifier must not exceed 255 characters',
  })
  modelIdentifier!: string;

  @ApiProperty({
    description: 'Human-facing display name for the model',
    example: 'Claude Sonnet 3.5',
    maxLength: 255,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'displayName must be a string' })
  @IsNotEmpty({ message: 'displayName must not be empty' })
  @MaxLength(255, {
    message: 'displayName must not exceed 255 characters',
  })
  displayName!: string;

  @ApiPropertyOptional({
    type: 'integer',
    description: 'Maximum context window size in tokens (positive integer)',
    example: 200000,
    minimum: 1,
    nullable: true,
  })
  @IsOptional()
  @IsInt({ message: 'contextWindow must be an integer' })
  @Min(1, { message: 'contextWindow must be at least 1' })
  contextWindow?: number | null;

  @ApiPropertyOptional({
    type: Number,
    description:
      'Default sampling temperature for completions (non-negative number)',
    example: 0.7,
    minimum: 0,
    nullable: true,
  })
  @IsOptional()
  @IsNumber({}, { message: 'defaultTemperature must be a number' })
  @Min(0, { message: 'defaultTemperature must be at least 0' })
  defaultTemperature?: number | null;

  @ApiPropertyOptional({
    type: 'integer',
    description:
      'Default maximum tokens generated per completion (positive integer)',
    example: 4096,
    minimum: 1,
    nullable: true,
  })
  @IsOptional()
  @IsInt({ message: 'defaultMaxTokens must be an integer' })
  @Min(1, { message: 'defaultMaxTokens must be at least 1' })
  defaultMaxTokens?: number | null;

  @ApiPropertyOptional({
    description:
      'Whether the model is enabled immediately upon creation (defaults to true)',
    example: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'enabled must be a boolean' })
  enabled?: boolean;
}
