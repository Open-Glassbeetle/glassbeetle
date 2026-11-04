import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
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

  @ApiPropertyOptional({
    description:
      'How the agents on the roster take turns in a multi-agent chat',
    enum: ['sequential', 'coordinator', 'broadcast', 'autonomous'],
    example: 'broadcast',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['sequential', 'coordinator', 'broadcast', 'autonomous'], {
    message:
      'strategy must be one of: sequential, coordinator, broadcast, autonomous',
  })
  strategy?: 'sequential' | 'coordinator' | 'broadcast' | 'autonomous';

  @ApiPropertyOptional({
    type: 'integer',
    description: 'Most turns a multi-agent exchange may take (1 to 10)',
    example: 5,
    minimum: 1,
    maximum: 10,
    nullable: true,
  })
  // GET returns null for a team with no cap, so a client that echoes the
  // response back must pass validation; null clears the cap.
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsInt({ message: 'maxTurnsPerInteraction must be an integer' })
  @Min(1, { message: 'maxTurnsPerInteraction must be at least 1' })
  @Max(10, { message: 'maxTurnsPerInteraction must not exceed 10' })
  maxTurnsPerInteraction?: number | null;
}
