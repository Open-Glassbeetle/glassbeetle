import { Injectable, NotFoundException } from '@nestjs/common';
import { newId } from '../../common/persistence/identifiers.js';
import { nowIso } from '../../common/persistence/timestamps.js';
import {
  createPaginatedResponse,
  type PaginatedResponse,
} from '../../common/pagination/paginated-response.dto.js';
import { buildPaginationSqlFragment } from '../../common/pagination/sql-query-builder.js';
import { DatabaseService } from '../../database/database.service.js';
import {
  applySystemPromptUpdates,
  mapSystemPromptRowToResponse,
  type CreateSystemPromptDto,
  type ListSystemPromptsQueryDto,
  type SystemPromptResponseDto,
  type SystemPromptRow,
  type UpdateSystemPromptDto,
} from './dto/index.js';

/**
 * Mapping of allowed client-facing sort keys to their SQL column names.
 */
export const ALLOWED_SYSTEM_PROMPT_SORT_COLUMNS: Record<string, string> = {
  createdAt: 'created_at',
  created_at: 'created_at',
  updatedAt: 'updated_at',
  updated_at: 'updated_at',
  name: 'name',
  id: 'id',
};

/**
 * Escapes SQLite LIKE wildcard characters (`%`, `_`, and `\`).
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}

/**
 * Service managing system prompt resources and their persistence in SQLite.
 *
 * System prompts are reusable instruction templates referenced by agents via
 * `agents.system_prompt_id`.
 */
@Injectable()
export class SystemPromptsService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Retrieves a paginated list of system prompts matching optional filter criteria.
   */
  async findAll(
    query: ListSystemPromptsQueryDto,
  ): Promise<PaginatedResponse<SystemPromptResponseDto>> {
    const conditions: string[] = [];
    const filterParams: unknown[] = [];

    const nameSearch = query.name ?? query.search;
    if (nameSearch !== undefined && nameSearch.trim() !== '') {
      conditions.push("name LIKE ? ESCAPE '\\'");
      filterParams.push(`%${escapeLikePattern(nameSearch.trim())}%`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) AS total FROM system_prompts ${whereClause}`;
    const countRow = this.db.get<{ total: number }>(countSql, filterParams);
    const total = countRow?.total ?? 0;

    const pagination = buildPaginationSqlFragment({
      query,
      allowedSortColumns: ALLOWED_SYSTEM_PROMPT_SORT_COLUMNS,
      defaultSortKey: 'createdAt',
      defaultOrder: 'desc',
      tiebreakerColumn: 'id',
    });

    const selectSql = `SELECT * FROM system_prompts ${whereClause} ${pagination.clauseSql}`;
    const rows = this.db.all<SystemPromptRow>(selectSql, [
      ...filterParams,
      ...pagination.params,
    ]);

    return createPaginatedResponse(
      rows.map(mapSystemPromptRowToResponse),
      total,
      pagination.params[0],
      pagination.params[1],
    );
  }

  /**
   * Retrieves a single system prompt by ID, or null if not found.
   */
  async findById(id: string): Promise<SystemPromptResponseDto | null> {
    const row = this.db.get<SystemPromptRow>(
      'SELECT * FROM system_prompts WHERE id = ?',
      [id],
    );
    if (!row) {
      return null;
    }
    return mapSystemPromptRowToResponse(row);
  }

  /**
   * Retrieves a single system prompt by ID.
   * Throws NotFoundException (404) if no prompt exists with the given ID.
   */
  async findOne(id: string): Promise<SystemPromptResponseDto> {
    const prompt = await this.findById(id);
    if (!prompt) {
      throw new NotFoundException({
        code: 'SYSTEM_PROMPT_NOT_FOUND',
        message: `System prompt with ID "${id}" not found`,
      });
    }
    return prompt;
  }

  /**
   * Creates a new system prompt with server-generated ID and timestamps.
   */
  async create(dto: CreateSystemPromptDto): Promise<SystemPromptResponseDto> {
    const id = newId();
    const now = nowIso();

    this.db.run(
      `INSERT INTO system_prompts (id, name, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, dto.name, dto.content, now, now],
    );

    return {
      id,
      name: dto.name,
      content: dto.content,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Updates an existing system prompt partially within an atomic transaction.
   *
   * Only supplied fields are updated. If no fields changed (or empty body),
   * returns the existing row without bumping `updated_at`.
   * `created_at` and `id` are never touched.
   */
  async update(
    id: string,
    dto: UpdateSystemPromptDto,
  ): Promise<SystemPromptResponseDto> {
    return this.db.transaction(() => {
      const existing = this.db.get<SystemPromptRow>(
        'SELECT * FROM system_prompts WHERE id = ?',
        [id],
      );

      if (!existing) {
        throw new NotFoundException({
          code: 'SYSTEM_PROMPT_NOT_FOUND',
          message: `System prompt with ID "${id}" not found`,
        });
      }

      const updateResult = applySystemPromptUpdates(existing, dto, nowIso());

      if (!updateResult.hasChanges) {
        return mapSystemPromptRowToResponse(existing);
      }

      const sql = `UPDATE system_prompts SET ${updateResult.setClauses.join(', ')} WHERE id = ?`;
      const params = [...updateResult.setParams, id];

      this.db.run(sql, params);

      const persisted = this.db.get<SystemPromptRow>(
        'SELECT * FROM system_prompts WHERE id = ?',
        [id],
      );

      if (!persisted) {
        throw new Error('Failed to retrieve system prompt after update');
      }

      return mapSystemPromptRowToResponse(persisted);
    });
  }

  /**
   * Permanently deletes a system prompt by ID.
   *
   * Foreign key cascade behavior:
   * The referencing column `agents.system_prompt_id` is defined with `ON DELETE SET NULL`.
   * Deleting a system prompt automatically unlinks referencing agents by setting their
   * `system_prompt_id` to `NULL`. The referencing agents survive intact with their reference cleared.
   *
   * Throws NotFoundException (404) if no prompt with the given ID exists.
   */
  async delete(id: string): Promise<void> {
    const result = this.db.run('DELETE FROM system_prompts WHERE id = ?', [id]);

    if (result.changes === 0) {
      throw new NotFoundException({
        code: 'SYSTEM_PROMPT_NOT_FOUND',
        message: `System prompt with ID "${id}" not found`,
      });
    }
  }
}
