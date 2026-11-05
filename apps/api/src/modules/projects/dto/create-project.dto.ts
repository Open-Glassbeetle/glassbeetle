import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Trims a string field, leaving anything else for the type check to reject.
 *
 * `@IsNotEmpty()` rejects `''` but accepts `'   '`, so without this a project
 * could be created with a name made of spaces — indistinguishable from an
 * unnamed one in a list, and impossible to search for.
 */
export function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Longest project name the API accepts (matches agent/team names). */
export const MAX_PROJECT_NAME_LENGTH = 120;

/** Longest project description the API accepts. */
export const MAX_PROJECT_DESCRIPTION_LENGTH = 2000;

/**
 * Request payload for creating a project.
 *
 * Only `name` is required. Server-managed fields (`id`, `createdAt`, `updatedAt`)
 * and storage references (`image`, `image_path`, `hasImage`) are forbidden and
 * rejected by ValidationPipe.
 */
export class CreateProjectDto {
  @ApiProperty({
    description: 'Display name of the project',
    example: 'NextGen Compiler',
    maxLength: MAX_PROJECT_NAME_LENGTH,
  })
  @Transform(trimString)
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name must not be empty' })
  @MaxLength(MAX_PROJECT_NAME_LENGTH, {
    message: `name must not exceed ${MAX_PROJECT_NAME_LENGTH} characters`,
  })
  name!: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Detailed description of what the project is for',
    example: 'Optimising compiler infrastructure for intermediate representation analysis.',
    maxLength: MAX_PROJECT_DESCRIPTION_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString({ message: 'description must be a string' })
  @MaxLength(MAX_PROJECT_DESCRIPTION_LENGTH, {
    message: `description must not exceed ${MAX_PROJECT_DESCRIPTION_LENGTH} characters`,
  })
  description?: string | null;
}

