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
  mapAgentMemoryRowToResponse,
  normalizeTagsOnWrite,
  applyAgentMemoryUpdates,
  type AgentMemoryResponseDto,
  type AgentMemoryRow,
  type BulkDeleteResponseDto,
  type CreateAgentMemoryDto,
  type ListAgentMemoriesQueryDto,
  type UpdateAgentMemoryDto,
} from './dto/index.js';

/**
 * Allowed client sort keys mapped to SQL column names.
 */
export const ALLOWED_AGENT_MEMORY_SORT_COLUMNS: Record<string, string> = {
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
 * Options when creating an agent memory row.
 */
export interface CreateAgentMemoryOptions {
  readonly id?: string;
  readonly now?: string;
}

/**
 * Service managing agent-private memory persistence in SQLite.
 *
 * Agent memory is a private store of facts, preferences, and context belonging
 * to a single agent. It cascades on agent deletion (`ON DELETE CASCADE`).
 */
@Injectable()
export class AgentMemoriesService {
  private readonly logger = new Logger(AgentMemoriesService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Asserts that an agent exists in SQLite.
   * Throws 404 NotFoundException with AGENT_NOT_FOUND if the agent does not exist.
   */
  public assertAgentExists(agentId: string): void {
    const row = this.db.get<{ id: string }>(
      'SELECT id FROM agents WHERE id = ?',
      [agentId],
    );

    if (!row) {
      throw new NotFoundException({
        code: 'AGENT_NOT_FOUND',
        message: `Agent with ID "${agentId}" not found`,
      });
    }
  }

  /**
   * Lists memories belonging to the specified agent with pagination, sorting, and filters.
   */
  async findAll(
    agentId: string,
    query: ListAgentMemoriesQueryDto,
  ): Promise<PaginatedResponse<AgentMemoryResponseDto>> {
    this.assertAgentExists(agentId);

    const conditions: string[] = ['agent_memories.agent_id = ?'];
    const filterParams: unknown[] = [agentId];

    if (query.tag !== undefined && query.tag.trim() !== '') {
      conditions.push(
        'EXISTS (SELECT 1 FROM json_each(agent_memories.tags) WHERE json_each.value = ?)',
      );
      filterParams.push(query.tag.trim());
    }

    const contentSearch = query.content ?? query.search;
    if (contentSearch !== undefined && contentSearch.trim() !== '') {
      conditions.push("agent_memories.content LIKE ? ESCAPE '\\'");
      filterParams.push(`%${escapeLikePattern(contentSearch.trim())}%`);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countSql = `SELECT COUNT(*) AS total FROM agent_memories ${whereClause}`;
    const countRow = this.db.get<{ total: number }>(countSql, filterParams);
    const total = countRow?.total ?? 0;

    const paginationQuery: PaginationQueryDto = {
      ...query,
      sort: query.sort ?? query.sortBy,
    };

    const pagination = buildPaginationSqlFragment({
      query: paginationQuery,
      allowedSortColumns: ALLOWED_AGENT_MEMORY_SORT_COLUMNS,
      defaultSortKey: 'createdAt',
      defaultOrder: 'desc',
      tiebreakerColumn: 'id',
    });

    const selectSql = `SELECT * FROM agent_memories ${whereClause} ${pagination.clauseSql}`;
    const rows = this.db.all<AgentMemoryRow>(selectSql, [
      ...filterParams,
      ...pagination.params,
    ]);

    return createPaginatedResponse(
      rows.map(mapAgentMemoryRowToResponse),
      total,
      pagination.params[0],
      pagination.params[1],
    );
  }

  /**
   * Adds a new private memory for the specified agent.
   */
  async create(
    agentId: string,
    dto: CreateAgentMemoryDto,
    options?: CreateAgentMemoryOptions,
  ): Promise<AgentMemoryResponseDto> {
    this.assertAgentExists(agentId);

    const id = options?.id ?? newId();
    const now = options?.now ?? nowIso();
    const tags = normalizeTagsOnWrite(dto.tags);

    this.db.run(
      `INSERT INTO agent_memories (id, agent_id, content, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, agentId, dto.content, tags, now, now],
    );

    const row: AgentMemoryRow = {
      id,
      agent_id: agentId,
      content: dto.content,
      tags,
      created_at: now,
      updated_at: now,
    };

    return mapAgentMemoryRowToResponse(row);
  }

  /**
   * Retrieves a single private memory scoped by agentId and memoryId.
   */
  async findOne(
    agentId: string,
    memoryId: string,
  ): Promise<AgentMemoryResponseDto> {
    this.assertAgentExists(agentId);

    const row = this.db.get<AgentMemoryRow>(
      'SELECT * FROM agent_memories WHERE id = ? AND agent_id = ?',
      [memoryId, agentId],
    );

    if (!row) {
      throw new NotFoundException(`Memory with ID "${memoryId}" not found`);
    }

    return mapAgentMemoryRowToResponse(row);
  }

  /**
   * Partially updates an existing private memory scoped by agentId and memoryId.
   */
  async update(
    agentId: string,
    memoryId: string,
    dto: UpdateAgentMemoryDto,
    options?: { readonly now?: string },
  ): Promise<AgentMemoryResponseDto> {
    this.assertAgentExists(agentId);

    const existing = this.db.get<AgentMemoryRow>(
      'SELECT * FROM agent_memories WHERE id = ? AND agent_id = ?',
      [memoryId, agentId],
    );

    if (!existing) {
      throw new NotFoundException(`Memory with ID "${memoryId}" not found`);
    }

    const now = options?.now ?? nowIso();
    const { hasChanges, setClauses, setParams } = applyAgentMemoryUpdates(
      existing,
      dto,
      now,
    );

    if (!hasChanges) {
      return mapAgentMemoryRowToResponse(existing);
    }

    const result = this.db.run(
      `UPDATE agent_memories SET ${setClauses.join(', ')} WHERE id = ? AND agent_id = ?`,
      [...setParams, memoryId, agentId],
    );

    if (result.changes === 0) {
      throw new NotFoundException(`Memory with ID "${memoryId}" not found`);
    }

    const updated = this.db.get<AgentMemoryRow>(
      'SELECT * FROM agent_memories WHERE id = ? AND agent_id = ?',
      [memoryId, agentId],
    );

    return mapAgentMemoryRowToResponse(updated!);
  }

  /**
   * Deletes a private memory scoped by agentId and memoryId.
   */
  async remove(agentId: string, memoryId: string): Promise<void> {
    this.assertAgentExists(agentId);

    const result = this.db.run(
      'DELETE FROM agent_memories WHERE id = ? AND agent_id = ?',
      [memoryId, agentId],
    );

    if (result.changes === 0) {
      throw new NotFoundException(`Memory with ID "${memoryId}" not found`);
    }
  }

  /**
   * Permanently and irreversibly clears all private memories for the specified agent.
   *
   * Scoped strictly to `agent_memories.agent_id = ?` using a bound parameter.
   * It never touches memories of other agents and never touches `shared_memories`.
   *
   * Throws 404 NotFoundException if the agent does not exist.
   * Clearing an agent with zero memories succeeds with `{ deleted: 0 }`.
   */
  async removeAll(agentId: string): Promise<BulkDeleteResponseDto> {
    this.assertAgentExists(agentId);

    const result = this.db.run(
      'DELETE FROM agent_memories WHERE agent_id = ?',
      [agentId],
    );

    this.logger.log(
      `Deleted ${result.changes} private memories for agent "${agentId}"`,
    );

    return { deleted: result.changes };
  }
}
