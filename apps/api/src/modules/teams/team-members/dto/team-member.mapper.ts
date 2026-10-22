import type { TeamMemberResponseDto } from './team-member-response.dto.js';

/**
 * Raw row shape for the `team_members` SQLite table.
 *
 * `(team_id, agent_id)` is the primary key, so there is no `id` column, and the
 * table carries `created_at` without `updated_at` — which is why a membership
 * response has no `updatedAt` either.
 */
export interface TeamMemberRow {
  readonly team_id: string;
  readonly agent_id: string;
  readonly role: string | null;
  readonly position: number | null;
  readonly created_at: string;
}

/**
 * Maps a `team_members` row to the public representation.
 *
 * `position` is nullable in the schema but never null in practice: every write
 * path here assigns one. A row that predates that, or was hand-inserted, is
 * reported at position 0 rather than as `null`, because the field's contract
 * to a client is "a place in the order" and there is no such thing as no
 * place.
 */
export function mapTeamMemberRowToResponse(
  row: TeamMemberRow,
): TeamMemberResponseDto {
  return {
    teamId: row.team_id,
    agentId: row.agent_id,
    role: row.role ?? null,
    position: row.position ?? 0,
    createdAt: row.created_at,
  };
}
