import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  createPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/pagination/paginated-response.dto.js';
import { buildPaginationSqlFragment } from '../../../common/pagination/sql-query-builder.js';
import { nowIso } from '../../../common/persistence/timestamps.js';
import { DatabaseService } from '../../../database/database.service.js';
import { TeamsService } from '../teams.service.js';
import type { AddTeamMemberDto } from './dto/add-team-member.dto.js';
import type { ListTeamMembersQueryDto } from './dto/list-team-members-query.dto.js';
import type { ReorderTeamMembersDto } from './dto/reorder-team-members.dto.js';
import type { TeamMemberResponseDto } from './dto/team-member-response.dto.js';
import {
  mapTeamMemberRowToResponse,
  type TeamMemberRow,
} from './dto/team-member.mapper.js';
import type { UpdateTeamMemberDto } from './dto/update-team-member.dto.js';

/**
 * The one ordering a roster has. See `ListTeamMembersQueryDto`.
 */
export const ALLOWED_TEAM_MEMBER_SORT_COLUMNS: Readonly<
  Record<string, string>
> = {
  position: 'position',
};

/**
 * Owns `team_members`: who is on a team, in what role, and in what order.
 *
 * The table has no surrogate key — `(team_id, agent_id)` is the primary key
 * — so a membership is addressed by both ids and has a `created_at` but no
 * `updated_at`. Responses follow the table rather than papering over that;
 * the API conventions call it out explicitly.
 *
 * `position` is kept dense, `0..n-1`, because it is the turn order in a team
 * chat: a client rendering "3rd of 4" reads it directly, and a reorder is
 * computed from it. Every mutation therefore either appends at the end,
 * renumbers, or rewrites the whole sequence.
 *
 * Each change touches the team's `updated_at` through {@link TeamsService},
 * since the roster is part of what a team is.
 *
 * @see `docs/api-conventions.md`
 */
@Injectable()
export class TeamMembersService {
  /**
   * @param db - The shared SQLite connection.
   * @param teams - Used to assert the parent team exists and to touch its
   * `updated_at` after a roster change.
   */
  constructor(
    private readonly db: DatabaseService,
    private readonly teams: TeamsService,
  ) {}

  /**
   * Lists a team's roster in turn order.
   */
  async findAll(
    teamId: string,
    query: ListTeamMembersQueryDto,
  ): Promise<PaginatedResponse<TeamMemberResponseDto>> {
    this.teams.assertExists(teamId);

    const fragment = buildPaginationSqlFragment({
      query,
      allowedSortColumns: ALLOWED_TEAM_MEMBER_SORT_COLUMNS,
      defaultSortKey: 'position',
      defaultOrder: 'asc',
      // `team_members` has no `id`; the pair is the key, and within one team
      // the agent is what distinguishes a row.
      tiebreakerColumn: 'agent_id',
    });

    const totalRow = this.db.get<{ total: number }>(
      'SELECT COUNT(*) AS total FROM team_members WHERE team_id = ?',
      [teamId],
    );

    const rows = this.db.all<TeamMemberRow>(
      `SELECT * FROM team_members WHERE team_id = ? ${fragment.clauseSql}`,
      [teamId, ...fragment.params],
    );

    return createPaginatedResponse(
      rows.map(mapTeamMemberRowToResponse),
      totalRow?.total ?? 0,
      query.limit,
      query.offset,
    );
  }

  /**
   * Retrieves one membership.
   */
  async findOne(
    teamId: string,
    agentId: string,
  ): Promise<TeamMemberResponseDto> {
    return mapTeamMemberRowToResponse(this.readRow(teamId, agentId));
  }

  /**
   * Puts an agent at the end of the roster.
   *
   * The new position is `MAX(position) + 1` computed inside the transaction, so
   * two agents added at once cannot land on the same number. Team membership
   * does not require anything of the agent beyond existing.
   *
   * @throws NotFoundException (404) when the team does not exist.
   * @throws UnprocessableEntityException (422) when `agentId` names an agent
   * that does not exist — the URL is valid, the body is not.
   * @throws ConflictException (409) with code `AGENT_ALREADY_ON_TEAM`.
   */
  async add(
    teamId: string,
    dto: AddTeamMemberDto,
  ): Promise<TeamMemberResponseDto> {
    this.teams.assertExists(teamId);

    const agent = this.db.get<{ id: string }>(
      'SELECT id FROM agents WHERE id = ?',
      [dto.agentId],
    );

    // 422 rather than 404: the team in the URL does exist, it is the body that
    // names something that does not. This is what `POST /agents` does for a
    // model id that is not a real row.
    if (!agent) {
      throw new UnprocessableEntityException({
        code: 'AGENT_NOT_FOUND',
        message: `Agent with ID "${dto.agentId}" not found`,
      });
    }

    const existing = this.db.get<TeamMemberRow>(
      'SELECT * FROM team_members WHERE team_id = ? AND agent_id = ?',
      [teamId, dto.agentId],
    );

    // Not idempotent on purpose. Adding an agent twice is a mistake worth
    // reporting, and silently succeeding would hide a double-submitted form
    // behind a roster that did not change.
    if (existing) {
      throw new ConflictException({
        code: 'AGENT_ALREADY_ON_TEAM',
        message: `Agent "${dto.agentId}" is already on this team`,
      });
    }

    const row = this.db.transaction(() => {
      const last = this.db.get<{ next: number }>(
        'SELECT COALESCE(MAX(position) + 1, 0) AS next FROM team_members WHERE team_id = ?',
        [teamId],
      );

      const inserted: TeamMemberRow = {
        team_id: teamId,
        agent_id: dto.agentId,
        role: dto.role ?? null,
        position: last?.next ?? 0,
        created_at: nowIso(),
      };

      this.db.run(
        `INSERT INTO team_members (team_id, agent_id, role, position, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          inserted.team_id,
          inserted.agent_id,
          inserted.role,
          inserted.position,
          inserted.created_at,
        ],
      );

      return inserted;
    });

    this.teams.touch(teamId);

    return mapTeamMemberRowToResponse(row);
  }

  /**
   * Changes an agent's role on the team.
   *
   * An empty body is an idempotent no-op, and so is setting the role to what
   * it already is — neither touches the team's `updated_at`.
   */
  async update(
    teamId: string,
    agentId: string,
    dto: UpdateTeamMemberDto,
  ): Promise<TeamMemberResponseDto> {
    const existing = this.readRow(teamId, agentId);

    if (dto.role === undefined) {
      return mapTeamMemberRowToResponse(existing);
    }

    const role = dto.role ?? null;

    if (role === existing.role) {
      return mapTeamMemberRowToResponse(existing);
    }

    this.db.run(
      'UPDATE team_members SET role = ? WHERE team_id = ? AND agent_id = ?',
      [role, teamId, agentId],
    );
    this.teams.touch(teamId);

    return mapTeamMemberRowToResponse({ ...existing, role });
  }

  /**
   * Takes an agent off the roster and closes the gap.
   *
   * Positions are renumbered in the same transaction so the sequence stays
   * dense. A roster left with a hole still orders correctly, but every client
   * that renders "3rd of 4" would then be wrong, and the next reorder would
   * be computed from numbers that do not mean what they say.
   */
  async remove(teamId: string, agentId: string): Promise<void> {
    this.readRow(teamId, agentId);

    this.db.transaction(() => {
      this.db.run(
        'DELETE FROM team_members WHERE team_id = ? AND agent_id = ?',
        [teamId, agentId],
      );

      this.renumber(teamId);
    });

    this.teams.touch(teamId);
  }

  /**
   * Rewrites the whole turn order in one transaction.
   *
   * The payload has to name exactly the agents currently on the team. A
   * partial list would silently decide where the omitted ones go, and a list
   * naming someone who has since left would reorder around a member that is
   * not there — both of which a client with a stale view would do without
   * noticing.
   *
   * Positions are rewritten to the payload's index order, which keeps the
   * sequence dense by construction.
   *
   * @returns The reordered roster, so a client does not have to re-read it.
   * @throws NotFoundException (404) when the team does not exist.
   * @throws ConflictException (409) with code `ROSTER_MISMATCH` when the
   * payload repeats an agent, or does not name exactly the current members.
   */
  async reorder(
    teamId: string,
    dto: ReorderTeamMembersDto,
  ): Promise<PaginatedResponse<TeamMemberResponseDto>> {
    this.teams.assertExists(teamId);

    const current = this.db
      .all<{ agent_id: string }>(
        'SELECT agent_id FROM team_members WHERE team_id = ?',
        [teamId],
      )
      .map((row) => row.agent_id);

    const requested = dto.agentIds;

    if (new Set(requested).size !== requested.length) {
      throw new ConflictException({
        code: 'ROSTER_MISMATCH',
        message: 'agentIds must not repeat an agent',
      });
    }

    const sortedCurrent = [...current].sort();
    const sortedRequested = [...requested].sort();
    const matches =
      sortedCurrent.length === sortedRequested.length &&
      sortedCurrent.every(
        (agentId, index) => agentId === sortedRequested[index],
      );

    if (!matches) {
      throw new ConflictException({
        code: 'ROSTER_MISMATCH',
        message:
          'agentIds must name exactly the agents currently on this team. Re-read the roster and try again.',
      });
    }

    this.db.transaction(() => {
      requested.forEach((agentId, index) => {
        this.db.run(
          'UPDATE team_members SET position = ? WHERE team_id = ? AND agent_id = ?',
          [index, teamId, agentId],
        );
      });
    });

    this.teams.touch(teamId);

    return this.findAll(teamId, { limit: 100, offset: 0 });
  }

  /**
   * Collapses a team's positions to a dense `0..n-1` sequence, keeping the
   * order they already had.
   */
  private renumber(teamId: string): void {
    const rows = this.db.all<{ agent_id: string }>(
      'SELECT agent_id FROM team_members WHERE team_id = ? ORDER BY position ASC, agent_id ASC',
      [teamId],
    );

    rows.forEach((row, index) => {
      this.db.run(
        'UPDATE team_members SET position = ? WHERE team_id = ? AND agent_id = ?',
        [index, teamId, row.agent_id],
      );
    });
  }

  /**
   * Reads one membership, or throws.
   *
   * @throws NotFoundException (404) with `TEAM_NOT_FOUND` when the team does
   * not exist, or `MEMBER_NOT_FOUND` when the agent is not on it.
   */
  private readRow(teamId: string, agentId: string): TeamMemberRow {
    this.teams.assertExists(teamId);

    // Filtered by the parent as well as the key: ids are globally unique, but
    // reading a membership by agent alone would answer a URL naming the wrong
    // team with another team's row.
    const row = this.db.get<TeamMemberRow>(
      'SELECT * FROM team_members WHERE team_id = ? AND agent_id = ?',
      [teamId, agentId],
    );

    if (!row) {
      throw new NotFoundException({
        code: 'MEMBER_NOT_FOUND',
        message: `Agent "${agentId}" is not on team "${teamId}"`,
      });
    }

    return row;
  }
}
