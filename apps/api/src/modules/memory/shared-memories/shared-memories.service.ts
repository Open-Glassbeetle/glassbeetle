import { Injectable } from '@nestjs/common';
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
  type CreateSharedMemoryDto,
  type ListSharedMemoriesQueryDto,
  type SharedMemoryResponseDto,
  type SharedMemoryRow,
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
}
