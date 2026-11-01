import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Optional override payload for non-streaming chat completions.
 *
 * If fields are omitted, parameters default according to the documented precedence order:
 * 1. Request body overrides (this DTO)
 * 2. Agent configuration (`agents.temperature`, `agents.max_tokens`, `agents.model_id`)
 * 3. Model defaults (`models.default_temperature`, `models.default_max_tokens`)
 */
export class CreateCompletionDto {
  @ApiPropertyOptional({
    type: String,
    description:
      'Optional override for the model to invoke (UUIDv7 model identifier)',
    example: '018f3a9e-0000-7000-8000-000000000002',
  })
  @IsOptional()
  @IsString({ message: 'modelId must be a string' })
  @IsNotEmpty({ message: 'modelId must not be empty' })
  modelId?: string;

  @ApiPropertyOptional({
    type: Number,
    description:
      'Optional override for sampling temperature (bounded between 0 and 2)',
    example: 0.7,
    minimum: 0,
    maximum: 2,
  })
  @IsOptional()
  @IsNumber({}, { message: 'temperature must be a number' })
  @Min(0, { message: 'temperature must be at least 0' })
  @Max(2, { message: 'temperature must not exceed 2' })
  temperature?: number;

  @ApiPropertyOptional({
    type: 'integer',
    description:
      'Optional override for maximum tokens to generate (positive integer, at least 1)',
    example: 2048,
    minimum: 1,
  })
  @IsOptional()
  @IsInt({ message: 'maxTokens must be an integer' })
  @Min(1, { message: 'maxTokens must be at least 1' })
  maxTokens?: number;
}
