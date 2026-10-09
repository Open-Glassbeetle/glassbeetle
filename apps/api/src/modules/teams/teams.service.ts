import { Injectable, NotFoundException } from '@nestjs/common';
import {
  createPaginatedResponse,
  type PaginatedResponse,
} from '../../common/pagination/paginated-response.dto.js';
import {
  buildPaginationSqlFragment,
  escapeLikePattern,
} from '../../common/pagination/sql-query-builder.js';
import { nowIso } from '../../common/persistence/timestamps.js';
import { DatabaseService } from '../../database/database.service.js';
import type { CreateTeamDto } from './dto/create-team.dto.js';
import type { ListTeamsQueryDto } from './dto/list-teams-query.dto.js';
import type { TeamResponseDto } from './dto/team-response.dto.js';
import {
  applyTeamUpdates,
  mapCreateTeamDtoToRow,
  mapTeamRowToResponse,
  type TeamRow,
  type TeamRowWithCount,
} from './dto/team.mapper.js';
import type { UpdateTeamDto } from './dto/update-team.dto.js';

/**
 * Sort keys the teams collection accepts, mapped to safe column names.
 *
 * Qualified with the table alias because the roster count joins
 * `team_members`, which has a `created_at` of its own — an unqualified
 * `ORDER BY created_at` would be ambiguous and SQLite would reject it.
 */
export const ALLOWED_TEAM_SORT_COLUMNS: Readonly<Record<string, string>> = {
  createdAt: 't.created_at',
  updatedAt: 't.updated_at',
  name: 't.name',
  id: 't.id',
};

@Injectable()
export class TeamsService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Lists teams with their roster sizes.
   *
   * The count is a `LEFT JOIN` aggregate rather than a query per row: every
   * caller that lists teams wants to know how big they are, and the alternative
   * is the N+1 the conventions exist to prevent.
   */
  async findAll(
    query: ListTeamsQueryDto,
  ): Promise<PaginatedResponse<TeamResponseDto>> {
    const fragment = buildPaginationSqlFragment({
      query,
      allowedSortColumns: ALLOWED_TEAM_SORT_COLUMNS,
      defaultSortKey: 'createdAt',
      defaultOrder: 'desc',
      tiebreakerColumn: 't.id',
    });

    const conditions: string[] = [];
    const params: unknown[] = [];

    const search = (query.name ?? query.search)?.trim();
    if (search) {
      conditions.push(`t.name LIKE ? ESCAPE '\\'`);
      params.push(`%${escapeLikePattern(search)}%`);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const totalRow = this.db.get<{ total: number }>(
      `SELECT COUNT(*) AS total FROM teams t ${where}`,
      params,
    );

    const rows = this.db.all<TeamRowWithCount>(
      `SELECT t.*, COUNT(m.agent_id) AS member_count
         FROM teams t
         LEFT JOIN team_members m ON m.team_id = t.id
         ${where}
        GROUP BY t.id
        ${fragment.clauseSql}`,
      [...params, ...fragment.params],
    );

    return createPaginatedResponse(
      rows.map(mapTeamRowToResponse),
      totalRow?.total ?? 0,
      query.limit,
      query.offset,
    );
  }

  /**
   * Retrieves one team.
   */
  async findOne(teamId: string): Promise<TeamResponseDto> {
    return mapTeamRowToResponse(this.readRowWithCount(teamId));
  }

  /**
   * Creates a team. It starts with an empty roster.
   */
  async create(dto: CreateTeamDto): Promise<TeamResponseDto> {
    const row = mapCreateTeamDtoToRow(dto);

    this.db.run(
      `INSERT INTO teams (id, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [row.id, row.name, row.description, row.created_at, row.updated_at],
    );

    return mapTeamRowToResponse({ ...row, member_count: 0 });
  }

  /**
   * Applies a partial update.
   *
   * An empty body is an idempotent no-op: the response is the unchanged team
   * and `updated_at` is left alone.
   */
  async update(teamId: string, dto: UpdateTeamDto): Promise<TeamResponseDto> {
    const existing = this.readRowWithCount(teamId);
    const result = applyTeamUpdates(existing, dto);

    if (result.hasChanges) {
      this.db.run(
        `UPDATE teams SET ${result.setClauses.join(', ')} WHERE id = ?`,
        [...result.setParams, teamId],
      );
    }

    return mapTeamRowToResponse({
      ...result.updatedRow,
      member_count: existing.member_count,
    });
  }

  /**
   * Deletes a team.
   *
   * `team_members` cascades, so the roster goes with it; the agents themselves
   * are untouched, since membership is a relationship rather than ownership.
   */
  async delete(teamId: string): Promise<void> {
    this.assertExists(teamId);

    this.db.run('DELETE FROM teams WHERE id = ?', [teamId]);
  }

  /**
   * Touches `updated_at` after a roster change.
   *
   * Membership is part of what a team *is*, so a list sorted by "recently
   * changed" that ignored agents joining and leaving would be wrong in the
   * way most likely to be noticed.
   */
  touch(teamId: string): void {
    this.db.run('UPDATE teams SET updated_at = ? WHERE id = ?', [
      nowIso(),
      teamId,
    ]);
  }

  /**
   * Throws `404` unless the team exists.
   *
   * Exported for the members controller, which must reject a membership
   * request naming a team that is not there before it reports anything about
   * the roster.
   */
  assertExists(teamId: string): TeamRow {
    const row = this.db.get<TeamRow>('SELECT * FROM teams WHERE id = ?', [
      teamId,
    ]);

    if (!row) {
      throw new NotFoundException({
        code: 'TEAM_NOT_FOUND',
        message: `Team with ID "${teamId}" not found`,
      });
    }

    return row;
  }

  private readRowWithCount(teamId: string): TeamRowWithCount {
    const row = this.db.get<TeamRowWithCount>(
      `SELECT t.*, COUNT(m.agent_id) AS member_count
         FROM teams t
         LEFT JOIN team_members m ON m.team_id = t.id
        WHERE t.id = ?
        GROUP BY t.id`,
      [teamId],
    );

    if (!row) {
      throw new NotFoundException({
        code: 'TEAM_NOT_FOUND',
        message: `Team with ID "${teamId}" not found`,
      });
    }

    return row;
  }
}
