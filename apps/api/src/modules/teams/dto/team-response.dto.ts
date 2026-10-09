import { ApiProperty } from '@nestjs/swagger';

/**
 * Public API representation of a team.
 *
 * A team is an ordered roster of agents. The order is the turn order a
 * multi-agent chat will take — see `docs/realtime-transport.md` — so a team is
 * configuration, not a group chat: nothing runs until the inference module
 * exists.
 *
 * `memberCount` is included because every list of teams is read in order to
 * answer "how big is it", and a client computing that would issue one request
 * per row. It is a single aggregate in the same query, not an N+1.
 */
export class TeamResponseDto {
  @ApiProperty({
    description: 'Unique team identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  readonly id!: string;

  @ApiProperty({
    description: 'Display name of the team',
    example: 'Research Desk',
  })
  readonly name!: string;

  @ApiProperty({
    type: String,
    description: 'What the team is for',
    example: 'Gathers sources, checks them, and writes the summary.',
    nullable: true,
  })
  readonly description!: string | null;

  @ApiProperty({
    type: 'integer',
    description: 'How many agents are on the roster',
    example: 3,
  })
  readonly memberCount!: number;

  @ApiProperty({
    description: 'Timestamp of team creation in ISO-8601 UTC format',
    example: '2026-10-04T12:00:00.000Z',
  })
  readonly createdAt!: string;

  @ApiProperty({
    description: 'Timestamp of the last team update in ISO-8601 UTC format',
    example: '2026-10-04T12:00:00.000Z',
  })
  readonly updatedAt!: string;
}

/** Interface representation of a team. */
export type TeamResponse = Readonly<TeamResponseDto>;
