import { ApiProperty } from '@nestjs/swagger';

/**
 * Public API representation of one agent's place on a team.
 *
 * There is no `id`: `team_members` is keyed by `(team_id, agent_id)`, so a
 * membership is addressed as `/teams/:teamId/members/:agentId` rather than by
 * an identifier of its own.
 *
 * Only the agent's id is returned, not its name. Foreign keys are exposed as
 * ids throughout this API, and the client that needs names already holds the
 * roster — the rail loads it on startup for every screen — so joining them in
 * here would duplicate data the caller has and make the two able to disagree.
 */
export class TeamMemberResponseDto {
  @ApiProperty({
    description: 'Team the agent belongs to',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  readonly teamId!: string;

  @ApiProperty({
    description: 'The agent on the roster',
    example: '018f3a9e-0000-7000-8000-000000000002',
  })
  readonly agentId!: string;

  @ApiProperty({
    type: String,
    description: 'What this agent does on the team',
    example: 'Supervisor',
    nullable: true,
  })
  readonly role!: string | null;

  @ApiProperty({
    type: 'integer',
    description:
      'Place in the roster, counting from zero. This is the order agents take their turn in a team chat, and it is always a dense sequence with no gaps or ties.',
    example: 0,
  })
  readonly position!: number;

  @ApiProperty({
    description: 'When the agent joined the team, in ISO-8601 UTC format',
    example: '2026-10-04T12:00:00.000Z',
  })
  readonly createdAt!: string;
}

/** Interface representation of a team membership. */
export type TeamMemberResponse = Readonly<TeamMemberResponseDto>;
