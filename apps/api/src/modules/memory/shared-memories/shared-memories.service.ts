import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { newId } from '../../../common/persistence/identifiers.js';
import { nowIso } from '../../../common/persistence/timestamps.js';
import {
  createPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/pagination/paginated-response.dto.js';
import type { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';
import { buildPaginationSqlFragment } from '../../../common/pagination/sql-query-builder.js';
import { DatabaseService } from '../../../database/database.service.js';
import {
  mapSharedMemoryRowToResponse,
  normalizeTagsOnWrite,
  type BulkDeleteResponseDto,
  type CreateSharedMemoryDto,
  type ListSharedMemoriesQueryDto,
  type SharedMemoryResponseDto,
  type SharedMemoryRow,
  type UpdateSharedMemoryDto,
} from './dto/index.js';

/**
 * Allowed client sort keys mapped to SQL column names.
 */
export const ALLOWED_SHARED_MEMORY_SORT_COLUMNS: Record<string, string> = {
  createdAt: 'created_at',
  created_at: 'created_at',
  updatedAt: 'updated_at',
  updated_at: 'updated_at',
  id: 'id',
  content: 'content',
};

/**
 * Escapes SQLite LIKE wildcard characters (`%`, `_`, and `\`).
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}

/**
 * Options when creating a shared memory row.
 */
export interface CreateSharedMemoryOptions {
  readonly id?: string;
  readonly now?: string;
}

/**
 * Service managing shared (global) memory persistence in SQLite.
 *
 * Shared memory stores facts, conventions, and context that are available
 * globally rather than scoped to a specific agent.
 */
@Injectable()
export class SharedMemoriesService {
  private readonly logger = new Logger(SharedMemoriesService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Lists shared memories with pagination, sorting, and optional filters.
   */
  async findAll(
    query: ListSharedMemoriesQueryDto,
  ): Promise<PaginatedResponse<SharedMemoryResponseDto>> {
    const conditions: string[] = [];
    const filterParams: unknown[] = [];

    if (query.tag !== undefined && query.tag.trim() !== '') {
      conditions.push(
        'EXISTS (SELECT 1 FROM json_each(shared_memories.tags) WHERE json_each.value = ?)',
      );
      filterParams.push(query.tag.trim());
    }

    const contentSearch = query.content ?? query.search;
    if (contentSearch !== undefined && contentSearch.trim() !== '') {
      conditions.push("shared_memories.content LIKE ? ESCAPE '\\'");
      filterParams.push(`%${escapeLikePattern(contentSearch.trim())}%`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) AS total FROM shared_memories ${whereClause}`;
    const countRow = this.db.get<{ total: number }>(countSql, filterParams);
    const total = countRow?.total ?? 0;

    const paginationQuery: PaginationQueryDto = {
      ...query,
      sort: query.sort ?? query.sortBy,
    };

    const pagination = buildPaginationSqlFragment({
      query: paginationQuery,
      allowedSortColumns: ALLOWED_SHARED_MEMORY_SORT_COLUMNS,
      defaultSortKey: 'createdAt',
      defaultOrder: 'desc',
      tiebreakerColumn: 'id',
    });

    const selectSql = `SELECT * FROM shared_memories ${whereClause} ${pagination.clauseSql}`;
    const rows = this.db.all<SharedMemoryRow>(selectSql, [
      ...filterParams,
      ...pagination.params,
    ]);

    return createPaginatedResponse(
      rows.map(mapSharedMemoryRowToResponse),
      total,
      pagination.params[0],
      pagination.params[1],
    );
  }

  /**
   * Adds a new shared memory.
   */
  async create(
    dto: CreateSharedMemoryDto,
    options?: CreateSharedMemoryOptions,
  ): Promise<SharedMemoryResponseDto> {
    const id = options?.id ?? newId();
    const now = options?.now ?? nowIso();
    const tags = normalizeTagsOnWrite(dto.tags);

    this.db.run(
      `INSERT INTO shared_memories (id, content, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, dto.content, tags, now, now],
    );

    const row: SharedMemoryRow = {
      id,
      content: dto.content,
      tags,
      created_at: now,
      updated_at: now,
    };

    return mapSharedMemoryRowToResponse(row);
  }

  /**
   * Retrieves a single shared memory by ID.
   */
  async findOne(memoryId: string): Promise<SharedMemoryResponseDto> {
    const row = this.db.get<SharedMemoryRow>(
      'SELECT * FROM shared_memories WHERE id = ?',
      [memoryId],
    );

    if (!row) {
      throw new NotFoundException(`Memory with ID "${memoryId}" not found`);
    }

    return mapSharedMemoryRowToResponse(row);
  }

  /**
   * Partially updates an existing shared memory by ID.
   *
   * Executes a direct UPDATE WHERE id = ? without a prior read to avoid
   * read-then-write races. If no fields are provided, checks existence
   * and returns the current record without advancing updated_at.
   */
  async update(
    memoryId: string,
    dto: UpdateSharedMemoryDto,
    options?: { readonly now?: string },
  ): Promise<SharedMemoryResponseDto> {
    const setClauses: string[] = [];
    const setParams: unknown[] = [];
    const now = options?.now ?? nowIso();

    if (dto.content !== undefined) {
      setClauses.push('content = ?');
      setParams.push(dto.content);
    }

    if (dto.tags !== undefined) {
      setClauses.push('tags = ?');
      setParams.push(normalizeTagsOnWrite(dto.tags));
    }

    if (setClauses.length === 0) {
      return this.findOne(memoryId);
    }

    setClauses.push('updated_at = ?');
    setParams.push(now);

    const result = this.db.run(
      `UPDATE shared_memories SET ${setClauses.join(', ')} WHERE id = ?`,
      [...setParams, memoryId],
    );

    if (result.changes === 0) {
      throw new NotFoundException(`Memory with ID "${memoryId}" not found`);
    }

    return this.findOne(memoryId);
  }

  /**
   * Permanently deletes a shared memory by ID.
   *
   * Executes DELETE WHERE id = ? treating 0 affected rows as not-found.
   */
  async remove(memoryId: string): Promise<void> {
    const result = this.db.run('DELETE FROM shared_memories WHERE id = ?', [
      memoryId,
    ]);

    if (result.changes === 0) {
      throw new NotFoundException(`Memory with ID "${memoryId}" not found`);
    }
  }

  /**
   * Permanently and irreversibly clears all global shared memories.
   *
   * Scoped strictly to `shared_memories`. Never touches `agent_memories`.
   *
   * Returns `{ deleted: count }` where count is the number of records removed.
   * Clearing an empty table succeeds with `{ deleted: 0 }`.
   */
  async removeAll(): Promise<BulkDeleteResponseDto> {
    const result = this.db.run('DELETE FROM shared_memories');

    this.logger.log(`Deleted ${result.changes} shared memories in bulk`);

    return { deleted: result.changes };
  }
}
