import { Injectable } from '@nestjs/common';
import {
  createPaginatedResponse,
  type PaginatedResponse,
} from '../../common/pagination/paginated-response.dto.js';
import { buildPaginationSqlFragment } from '../../common/pagination/sql-query-builder.js';
import { DatabaseService } from '../../database/database.service.js';
import type { AgentResponseDto } from './dto/agent-response.dto.js';
import { mapAgentRowToResponse, type AgentRow } from './dto/agent.mapper.js';
import type { ListAgentsQueryDto } from './dto/list-agents-query.dto.js';

/**
 * Whitelist of allowed sort columns for the agents collection endpoint.
 * Maps client-facing camelCase keys to safe database column names.
 */
export const ALLOWED_AGENT_SORT_COLUMNS: Readonly<Record<string, string>> = {
  createdAt: 'created_at',
  name: 'name',
  id: 'id',
  updatedAt: 'updated_at',
};

/**
 * Escapes characters with special meaning in SQLite LIKE patterns (`\`, `%`, `_`).
 * This ensures user-supplied search terms are treated strictly as literal substrings.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/([\\%_])/g, '\\$1');
}

@Injectable()
export class AgentsService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Retrieves a paginated list of agents matching optional query filters.
   */
  async findAll(
    query: ListAgentsQueryDto,
  ): Promise<PaginatedResponse<AgentResponseDto>> {
    const conditions: string[] = [];
    const filterParams: unknown[] = [];

    // Filter by modelId: supports exact ID match or string "null" for unassigned models
    if (query.modelId !== undefined) {
      if (query.modelId === 'null') {
        conditions.push('model_id IS NULL');
      } else {
        conditions.push('model_id = ?');
        filterParams.push(query.modelId);
      }
    }

    // Filter by systemPromptId: supports exact ID match or string "null" for unassigned prompts
    if (query.systemPromptId !== undefined) {
      if (query.systemPromptId === 'null') {
        conditions.push('system_prompt_id IS NULL');
      } else {
        conditions.push('system_prompt_id = ?');
        filterParams.push(query.systemPromptId);
      }
    }

    // Substring search on name (case-insensitive in SQLite by default for ASCII)
    const nameSearch = query.name ?? query.search;
    if (nameSearch !== undefined && nameSearch.trim() !== '') {
      conditions.push("name LIKE ? ESCAPE '\\'");
      filterParams.push(`%${escapeLikePattern(nameSearch.trim())}%`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count matching rows for the pagination envelope
    const countSql = `SELECT COUNT(*) AS total FROM agents ${whereClause}`;
    const countRow = this.db.get<{ total: number }>(countSql, filterParams);
    const total = countRow?.total ?? 0;

    // Build safe sorting and pagination clause (validates sort key against whitelist)
    const pagination = buildPaginationSqlFragment({
      query,
      allowedSortColumns: ALLOWED_AGENT_SORT_COLUMNS,
      defaultSortKey: 'createdAt',
      defaultOrder: 'desc',
    });

    // Query the requested slice of rows with bound parameters
    const selectSql = `SELECT * FROM agents ${whereClause} ${pagination.clauseSql}`;
    const rows = this.db.all<AgentRow>(selectSql, [
      ...filterParams,
      ...pagination.params,
    ]);

    return createPaginatedResponse(
      rows.map(mapAgentRowToResponse),
      total,
      pagination.params[0],
      pagination.params[1],
    );
  }
}
