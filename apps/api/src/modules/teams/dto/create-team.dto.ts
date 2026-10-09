import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Trims a string field, leaving anything else for the type check to reject.
 *
 * `@IsNotEmpty()` rejects `''` but accepts `'   '`, so without this a team
 * could be created with a name made of spaces — indistinguishable from an
 * unnamed one in a list, and impossible to search for.
 */
export function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Longest team name the API accepts. */
export const MAX_TEAM_NAME_LENGTH = 120;

/** Longest team description the API accepts. */
export const MAX_TEAM_DESCRIPTION_LENGTH = 2000;

/**
 * Request payload for creating a team.
 *
 * Only `name` is required. Members are added through
 * `POST /teams/:teamId/members` rather than here: a team with an agent that
 * does not exist has to fail as a whole, and doing that in one endpoint means
 * either a transaction that half-creates a team or a validation pass that
 * duplicates the member endpoint's rules.
 */
export class CreateTeamDto {
  @ApiProperty({
    description: 'Display name of the team',
    example: 'Research Desk',
    maxLength: MAX_TEAM_NAME_LENGTH,
  })
  @Transform(trimString)
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name must not be empty' })
  @MaxLength(MAX_TEAM_NAME_LENGTH, {
    message: `name must not exceed ${MAX_TEAM_NAME_LENGTH} characters`,
  })
  name!: string;

  @ApiPropertyOptional({
    type: String,
    description: 'What the team is for',
    example: 'Gathers sources, checks them, and writes the summary.',
    maxLength: MAX_TEAM_DESCRIPTION_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString({ message: 'description must be a string' })
  @MaxLength(MAX_TEAM_DESCRIPTION_LENGTH, {
    message: `description must not exceed ${MAX_TEAM_DESCRIPTION_LENGTH} characters`,
  })
  description?: string | null;
}
