import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  createPaginatedResponse,
  type PaginatedResponse,
} from '../../common/pagination/paginated-response.dto.js';
import { buildPaginationSqlFragment } from '../../common/pagination/sql-query-builder.js';
import { newId } from '../../common/persistence/identifiers.js';
import { nowIso } from '../../common/persistence/timestamps.js';
import { DatabaseService } from '../../database/database.service.js';
import type { AgentResponseDto } from './dto/agent-response.dto.js';
import {
  mapAgentRowToResponse,
  mapCreateAgentDtoToRow,
  type AgentRow,
} from './dto/agent.mapper.js';
import type { CreateAgentDto } from './dto/create-agent.dto.js';
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

  /**
   * Retrieves a single agent by ID, or null if not found.
   */
  async findById(id: string): Promise<AgentResponseDto | null> {
    const row = this.db.get<AgentRow>('SELECT * FROM agents WHERE id = ?', [
      id,
    ]);
    if (!row) {
      return null;
    }
    return mapAgentRowToResponse(row);
  }

  /**
   * Creates a new agent within an atomic transaction.
   *
   * Validates that supplied foreign keys exist before insertion to return
   * specific 422 errors naming the invalid reference.
   */
  async create(dto: CreateAgentDto): Promise<AgentResponseDto> {
    return this.db.transaction(() => {
      // Validate modelId foreign key if supplied
      if (dto.modelId) {
        const modelRow = this.db.get<{ id: string }>(
          'SELECT id FROM models WHERE id = ?',
          [dto.modelId],
        );
        if (!modelRow) {
          throw new UnprocessableEntityException({
            code: 'MODEL_NOT_FOUND',
            message: `Referenced modelId "${dto.modelId}" does not exist`,
          });
        }
      }

      // Validate systemPromptId foreign key if supplied
      if (dto.systemPromptId) {
        const promptRow = this.db.get<{ id: string }>(
          'SELECT id FROM system_prompts WHERE id = ?',
          [dto.systemPromptId],
        );
        if (!promptRow) {
          throw new UnprocessableEntityException({
            code: 'SYSTEM_PROMPT_NOT_FOUND',
            message: `Referenced systemPromptId "${dto.systemPromptId}" does not exist`,
          });
        }
      }

      const id = newId();
      const now = nowIso();
      const row = mapCreateAgentDtoToRow(dto, { id, now });

      try {
        this.db.run(
          `INSERT INTO agents (
            id,
            name,
            personality,
            instructions,
            system_prompt_id,
            model_id,
            temperature,
            max_tokens,
            model_params,
            picture_path,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.id,
            row.name,
            row.personality,
            row.instructions,
            row.system_prompt_id,
            row.model_id,
            row.temperature,
            row.max_tokens,
            row.model_params,
            row.picture_path,
            row.created_at,
            row.updated_at,
          ],
        );
      } catch (error: any) {
        if (error?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
          throw new UnprocessableEntityException({
            code: 'FOREIGN_KEY_VIOLATION',
            message: 'Referenced foreign key constraint failed',
          });
        }
        throw error;
      }

      const persisted = this.db.get<AgentRow>(
        'SELECT * FROM agents WHERE id = ?',
        [row.id],
      );

      if (!persisted) {
        throw new Error('Failed to retrieve agent after insert');
      }

      return mapAgentRowToResponse(persisted);
    });
  }
}
