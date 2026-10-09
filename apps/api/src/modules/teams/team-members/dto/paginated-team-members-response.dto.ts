import { ApiProperty } from '@nestjs/swagger';
import type { PaginatedResponse } from '../../../../common/pagination/paginated-response.dto.js';
import { TeamMemberResponseDto } from './team-member-response.dto.js';

/**
 * Paginated collection envelope for a team roster.
 */
export class PaginatedTeamMembersResponseDto implements PaginatedResponse<TeamMemberResponseDto> {
  @ApiProperty({
    type: [TeamMemberResponseDto],
    description: 'The roster, in turn order',
  })
  readonly items!: readonly TeamMemberResponseDto[];

  @ApiProperty({
    example: 3,
    description: 'Total number of agents on the team',
  })
  readonly total!: number;

  @ApiProperty({
    example: 50,
    description: 'Maximum number of items returned per page',
  })
  readonly limit!: number;

  @ApiProperty({ example: 0, description: 'Offset of the first item returned' })
  readonly offset!: number;
}
