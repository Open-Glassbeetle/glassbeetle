import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import {
  CreateTeamDto,
  MAX_TEAM_NAME_LENGTH,
  trimString,
} from './create-team.dto.js';

/**
 * Request payload for updating a team (PATCH).
 *
 * - Omitted (`undefined`): field is not modified.
 * - Explicit `null`: `description` is cleared.
 * - `name` may not be null or empty; a team without a name cannot be picked
 *   out of a list.
 * - Empty body (`{}`): idempotent no-op (200 OK, `updatedAt` untouched).
 */
export class UpdateTeamDto extends PartialType(CreateTeamDto) {
  @ApiPropertyOptional({
    type: String,
    description: 'Display name of the team (cannot be null or empty)',
    example: 'Research Desk',
    maxLength: MAX_TEAM_NAME_LENGTH,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trimString)
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name must not be empty' })
  @MaxLength(MAX_TEAM_NAME_LENGTH, {
    message: `name must not exceed ${MAX_TEAM_NAME_LENGTH} characters`,
  })
  override name?: string;
}
