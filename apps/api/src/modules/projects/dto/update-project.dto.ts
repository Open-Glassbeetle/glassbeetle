import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  CreateProjectDto,
  MAX_PROJECT_DESCRIPTION_LENGTH,
  MAX_PROJECT_NAME_LENGTH,
  trimString,
} from './create-project.dto.js';

/**
 * Request payload for updating a project (PATCH).
 *
 * - Omitted (`undefined`): field is not modified.
 * - Explicit `null`: `description` is cleared to null.
 * - `name` may not be null or empty; a project must remain identifiable in a list.
 * - Empty body (`{}`): idempotent no-op (200 OK, `updatedAt` untouched).
 * - Server-managed fields (`id`, `createdAt`, `updatedAt`) and storage fields
 *   (`image`, `image_path`, `hasImage`) are rejected by ValidationPipe.
 */
export class UpdateProjectDto extends PartialType(CreateProjectDto) {
  @ApiPropertyOptional({
    type: String,
    description: 'Display name of the project (cannot be null or empty)',
    example: 'NextGen Compiler',
    maxLength: MAX_PROJECT_NAME_LENGTH,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trimString)
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name must not be empty' })
  @MaxLength(MAX_PROJECT_NAME_LENGTH, {
    message: `name must not exceed ${MAX_PROJECT_NAME_LENGTH} characters`,
  })
  override name?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Detailed description of what the project is for (explicit null clears it)',
    example: 'Updated project description.',
    maxLength: MAX_PROJECT_DESCRIPTION_LENGTH,
    nullable: true,
  })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Transform(trimString)
  @IsString({ message: 'description must be a string' })
  @MaxLength(MAX_PROJECT_DESCRIPTION_LENGTH, {
    message: `description must not exceed ${MAX_PROJECT_DESCRIPTION_LENGTH} characters`,
  })
  @IsOptional()
  override description?: string | null;
}

