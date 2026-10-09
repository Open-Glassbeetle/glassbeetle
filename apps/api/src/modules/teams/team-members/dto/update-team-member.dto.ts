import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import {
  MAX_MEMBER_ROLE_LENGTH,
  trimRoleToNull,
} from './add-team-member.dto.js';

/**
 * Request payload for changing a membership (PATCH).
 *
 * Only the role can change. Position is not accepted here: it is maintained as
 * a dense sequence per team, and a single row changing its number would either
 * collide with another or leave a gap. `PUT /teams/:teamId/members/order`
 * rewrites the whole order in one transaction instead.
 *
 * An empty body is an idempotent no-op.
 */
export class UpdateTeamMemberDto {
  @ApiPropertyOptional({
    type: String,
    description: 'What this agent does on the team. Null clears the label.',
    example: 'Researcher',
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
