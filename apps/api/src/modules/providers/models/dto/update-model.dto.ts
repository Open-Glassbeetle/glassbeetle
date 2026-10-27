import { ApiPropertyOptional } from '@nestjs/swagger';
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
  ValidateIf,
} from 'class-validator';

/**
 * Request payload for updating an existing model (PATCH /api/v1/models/:modelId).
 *
 * All fields are optional. Only supplied mutable fields are updated.
 *
 * Immutable fields (`providerId`, `modelIdentifier`, `source`) and
 * server-managed fields (`id`, `createdAt`, `updatedAt`) are rejected with 400.
 */
export class UpdateModelDto {
  @ApiPropertyOptional({
    description: 'Human-facing display name for the model (non-empty string)',
    example: 'Claude 3.5 Sonnet (Upgraded)',
    maxLength: 255,
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'displayName must be a string' })
  @IsNotEmpty({ message: 'displayName must not be empty' })
  @MaxLength(255, {
    message: 'displayName must not exceed 255 characters',
  })
  displayName?: string;

  @ApiPropertyOptional({
    type: 'integer',
    description: 'Maximum context window size in tokens, or null to clear',
    example: 200000,
    minimum: 1,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_obj, val) => val !== null && val !== undefined)
  @IsInt({ message: 'contextWindow must be an integer' })
  @Min(1, { message: 'contextWindow must be at least 1' })
  contextWindow?: number | null;

  @ApiPropertyOptional({
    type: Number,
    description:
      'Default sampling temperature for completions, or null to clear',
    example: 0.7,
    minimum: 0,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_obj, val) => val !== null && val !== undefined)
  @IsNumber({}, { message: 'defaultTemperature must be a number' })
  @Min(0, { message: 'defaultTemperature must be at least 0' })
  defaultTemperature?: number | null;

  @ApiPropertyOptional({
    type: 'integer',
    description:
      'Default maximum tokens generated per completion, or null to clear',
    example: 4096,
    minimum: 1,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_obj, val) => val !== null && val !== undefined)
  @IsInt({ message: 'defaultMaxTokens must be an integer' })
  @Min(1, { message: 'defaultMaxTokens must be at least 1' })
  defaultMaxTokens?: number | null;

  @ApiPropertyOptional({
    description: 'Whether the model is enabled and selectable by agents',
    example: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'enabled must be a boolean' })
  enabled?: boolean;
}
