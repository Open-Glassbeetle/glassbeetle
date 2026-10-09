import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { trimString } from '../../dto/create-team.dto.js';

/**
 * Collapses a role the user cleared to `null` rather than an empty string, so
 * "no label" has one representation.
 */
function trimRoleToNull({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export { trimRoleToNull };

/** Longest role label the API accepts. */
export const MAX_MEMBER_ROLE_LENGTH = 60;

/**
 * Request payload for putting an agent on a team.
 *
 * The new member is appended to the end of the roster. There is no `position`
 * here on purpose: inserting in the middle would have to renumber everything
 * after it, which is the reorder endpoint's job, and offering two ways to
 * change the order is how orders end up with ties.
 */
export class AddTeamMemberDto {
  @ApiProperty({
    description: 'The agent to put on the roster',
    example: '018f3a9e-0000-7000-8000-000000000002',
  })
  @Transform(trimString)
  @IsString({ message: 'agentId must be a string' })
  @IsNotEmpty({ message: 'agentId must not be empty' })
  agentId!: string;

  @ApiPropertyOptional({
    type: String,
    description: 'What this agent does on the team',
    example: 'Supervisor',
    maxLength: MAX_MEMBER_ROLE_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @Transform(trimRoleToNull)
  @IsString({ message: 'role must be a string' })
  @MaxLength(MAX_MEMBER_ROLE_LENGTH, {
    message: `role must not exceed ${MAX_MEMBER_ROLE_LENGTH} characters`,
  })
  role?: string | null;
}
