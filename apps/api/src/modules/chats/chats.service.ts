import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  createPaginatedResponse,
  type PaginatedResponse,
} from '../../common/pagination/paginated-response.dto.js';
import { buildPaginationSqlFragment } from '../../common/pagination/sql-query-builder.js';
import { DatabaseService } from '../../database/database.service.js';
import {
  BOTH_OWNERS_ERROR_MESSAGE,
  CONTEXT_SUMMARY_READONLY_ERROR_MESSAGE,
  NEITHER_OWNER_ERROR_MESSAGE,
  OWNER_IMMUTABLE_ERROR_MESSAGE,
} from './dto/chat-validators.js';
import type { ChatResponseDto } from './dto/chat-response.dto.js';
import {
  applyChatUpdates,
  mapChatRowToResponse,
  mapCreateChatDtoToRow,
  type ChatRow,
} from './dto/chat.mapper.js';
import type { CreateChatDto } from './dto/create-chat.dto.js';
import type { DeleteAllChatsResponseDto } from './dto/delete-all-chats-response.dto.js';
import type { ListChatsQueryDto } from './dto/list-chats-query.dto.js';
import type { UpdateChatDto } from './dto/update-chat.dto.js';

/**
 * Whitelist of allowed sort columns for the chats collection endpoint.
 * Maps client-facing camelCase keys to safe database column names.
 */
export const ALLOWED_CHAT_SORT_COLUMNS: Readonly<Record<string, string>> = {
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  title: 'title',
  id: 'id',
};

/**
 * Owns the `chats` table: queries, the owner rule, and bulk deletion.
 *
 * The invariant that shapes this service is that a chat belongs to exactly
 * one agent or one team. The schema says so with a `CHECK` constraint, but a
 * constraint can only produce an opaque `SQLITE_CONSTRAINT_CHECK` failure, so
 * every write path checks first and raises a 400 that names the rule.
 *
 * The same invariant is why the owner cannot be changed: the messages below a
 * chat were produced by that agent or that team, and repointing the chat
 * would silently reattribute the whole conversation.
 */
@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Retrieves a paginated list of chats matching optional query filters.
   *
   * Supports filtering by:
   * - `projectId`: Exact match, or "null" for unassigned chats outside any project.
   * - `agentId`: Exact match, or "null" for chats without an assigned agent.
   * - `teamId`: Exact match, or "null" for chats without an assigned team.
   *
   * Defensive mapping is applied so chats whose owner was deleted (and set to NULL
   * by SQLite foreign key cascade) are listed without error.
   */
  async findAll(
    query: ListChatsQueryDto,
  ): Promise<PaginatedResponse<ChatResponseDto>> {
    const conditions: string[] = [];
    const filterParams: unknown[] = [];

    if (query.projectId !== undefined) {
      if (query.projectId === 'null') {
        conditions.push('project_id IS NULL');
      } else {
        conditions.push('project_id = ?');
        filterParams.push(query.projectId);
      }
    }

    if (query.agentId !== undefined) {
      if (query.agentId === 'null') {
        conditions.push('agent_id IS NULL');
      } else {
        conditions.push('agent_id = ?');
        filterParams.push(query.agentId);
      }
    }

    if (query.teamId !== undefined) {
      if (query.teamId === 'null') {
        conditions.push('team_id IS NULL');
      } else {
        conditions.push('team_id = ?');
        filterParams.push(query.teamId);
      }
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = this.db.get<{ total: number }>(
      `SELECT COUNT(*) AS total FROM chats ${whereClause}`,
      filterParams,
    );
    const total = countRow?.total ?? 0;

    const pagination = buildPaginationSqlFragment({
      query,
      allowedSortColumns: ALLOWED_CHAT_SORT_COLUMNS,
      defaultSortKey: 'createdAt',
      defaultOrder: 'desc',
      tiebreakerColumn: 'id',
    });

    const rows = this.db.all<ChatRow>(
      `SELECT * FROM chats ${whereClause} ${pagination.clauseSql}`,
      [...filterParams, ...pagination.params],
    );

    return createPaginatedResponse(
      rows.map(mapChatRowToResponse),
      total,
      query.limit,
      query.offset,
    );
  }

  /**
   * Asserts that a chat exists in SQLite and returns its row.
   *
   * Public because `MessagesService` calls it: a message route is scoped to its
   * chat, so "which chat is this" has to be answered the same way in both
   * services, with the same 404 code.
   *
   * @throws NotFoundException (404) with code `CHAT_NOT_FOUND`.
   */
  assertExists(chatId: string): ChatRow {
    const row = this.db.get<ChatRow>('SELECT * FROM chats WHERE id = ?', [
      chatId,
    ]);

    if (!row) {
      throw new NotFoundException({
        code: 'CHAT_NOT_FOUND',
        message: `Chat with ID "${chatId}" not found`,
      });
    }

    return row;
  }

  /**
   * Retrieves a single chat by ID.
   *
   * Throws 404 NotFoundException if no chat exists with that ID.
   * Employs defensive row mapping so that orphaned chats (whose owner was deleted)
   * can still be inspected.
   */
  async findOne(chatId: string): Promise<ChatResponseDto> {
    const row = this.assertExists(chatId);
    return mapChatRowToResponse(row);
  }

  /**
   * Creates a new chat within an atomic transaction.
   *
   * Owner rule:
   * - A chat MUST belong to either an agent or a team, never both and never neither.
   *   Violations are rejected with a clear 400 BadRequestException explaining the rule.
   *
   * Foreign key validation:
   * - Referenced agentId, teamId, and projectId are verified against their respective tables.
   *   A non-existent reference throws 422 UnprocessableEntityException naming the field.
   *
   * Read-only fields:
   * - `context_summary` cannot be set by client requests; it is managed by compaction.
   */
  async create(dto: CreateChatDto): Promise<ChatResponseDto> {
    this.assertNoContextSummary(dto);
    this.assertOwnerRule(dto);

    return this.db.transaction(() => {
      if (dto.agentId) {
        const agent = this.db.get<{ id: string }>(
          'SELECT id FROM agents WHERE id = ?',
          [dto.agentId],
        );
        if (!agent) {
          throw new UnprocessableEntityException({
            code: 'AGENT_NOT_FOUND',
            message: `Referenced agentId "${dto.agentId}" does not exist`,
          });
        }
      }

      if (dto.teamId) {
        const team = this.db.get<{ id: string }>(
          'SELECT id FROM teams WHERE id = ?',
          [dto.teamId],
        );
        if (!team) {
          throw new UnprocessableEntityException({
            code: 'TEAM_NOT_FOUND',
            message: `Referenced teamId "${dto.teamId}" does not exist`,
          });
        }
      }

      if (dto.projectId) {
        const project = this.db.get<{ id: string }>(
          'SELECT id FROM projects WHERE id = ?',
          [dto.projectId],
        );
        if (!project) {
          throw new UnprocessableEntityException({
            code: 'PROJECT_NOT_FOUND',
            message: `Referenced projectId "${dto.projectId}" does not exist`,
          });
        }
      }

      const row = mapCreateChatDtoToRow(dto);

      this.db.run(
        `INSERT INTO chats (
          id,
          title,
          project_id,
          agent_id,
          team_id,
          context_summary,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.title,
          row.project_id,
          row.agent_id,
          row.team_id,
          row.context_summary,
          row.created_at,
          row.updated_at,
        ],
      );

      return mapChatRowToResponse(row);
    });
  }

  /**
   * Applies partial updates to an existing chat within an atomic transaction.
   *
   * Allowed updates:
   * - `title`: New title string, or `null` to clear.
   * - `projectId`: New project ID to move the chat, or `null` to detach from projects.
   *
   * Forbidden updates:
   * - `agentId` or `teamId`: Changing the owner of a chat is strictly forbidden
   *   because message history is tied to the original owner (agent or team).
   * - `context_summary`: Read-only, managed exclusively by the compaction endpoint.
   *
   * Idempotent no-op:
   * - An empty body or identical values leave `updated_at` untouched and return 200.
   */
  async update(chatId: string, dto: UpdateChatDto): Promise<ChatResponseDto> {
    this.assertNoContextSummary(dto);
    this.assertNoOwnerChange(dto);

    return this.db.transaction(() => {
      const existing = this.db.get<ChatRow>(
        'SELECT * FROM chats WHERE id = ?',
        [chatId],
      );

      if (!existing) {
        throw new NotFoundException({
          code: 'CHAT_NOT_FOUND',
          message: `Chat with ID "${chatId}" not found`,
        });
      }

      if (dto.projectId !== undefined && dto.projectId !== null) {
        const project = this.db.get<{ id: string }>(
          'SELECT id FROM projects WHERE id = ?',
          [dto.projectId],
        );
        if (!project) {
          throw new UnprocessableEntityException({
            code: 'PROJECT_NOT_FOUND',
            message: `Referenced projectId "${dto.projectId}" does not exist`,
          });
        }
      }

      const result = applyChatUpdates(existing, dto);

      if (result.hasChanges) {
        const updateResult = this.db.run(
          `UPDATE chats SET ${result.setClauses.join(', ')} WHERE id = ?`,
          [...result.setParams, chatId],
        );

        if (updateResult.changes === 0) {
          throw new NotFoundException({
            code: 'CHAT_NOT_FOUND',
            message: `Chat with ID "${chatId}" not found`,
          });
        }
      }

      return mapChatRowToResponse(result.updatedRow);
    });
  }

  /**
   * Permanently deletes a chat by ID.
   *
   * Cascade behaviour:
   * - `messages` (`chat_id REFERENCES chats(id) ON DELETE CASCADE`):
   *   The entire conversation history of messages is permanently destroyed.
   * - `artifacts` (`chat_id REFERENCES chats(id) ON DELETE SET NULL`):
   *   Artifacts survive with their `chat_id` reference cleared to NULL.
   *
   * Returns 204 No Content on success, or throws 404 NotFoundException if the chat
   * does not exist (using zero affected rows as the not-found signal).
   */
  async delete(chatId: string): Promise<void> {
    const result = this.db.run('DELETE FROM chats WHERE id = ?', [chatId]);

    if (result.changes === 0) {
      throw new NotFoundException({
        code: 'CHAT_NOT_FOUND',
        message: `Chat with ID "${chatId}" not found`,
      });
    }
  }

  /**
   * Permanently and irreversibly deletes all chats and their conversation history.
   *
   * This is an untargeted, irreversible operation that destroys all rows in `chats`,
   * which cascades to `messages` (ON DELETE CASCADE) so every message in the entire
   * database is deleted.
   *
   * Cascade and preservation behaviour:
   * - `messages` (`chat_id REFERENCES chats(id) ON DELETE CASCADE`):
   *   The entire conversation history across all chats is permanently destroyed.
   * - `artifacts` (`chat_id REFERENCES chats(id) ON DELETE SET NULL`):
   *   Artifacts survive with their `chat_id` set to null (work products are kept).
   * - `usage_events` (`chat_id REFERENCES chats(id) ON DELETE SET NULL`):
   *   Usage events survive with attribution unlinked, preserving historical spend and token totals.
   * - Agents, teams, projects, and memories are completely untouched.
   *
   * Counts of deleted chats and cascaded messages are captured inside the transaction
   * and logged at application level. Clearing an empty table returns `{ deletedChats: 0, deletedMessages: 0 }`.
   */
  async removeAll(): Promise<DeleteAllChatsResponseDto> {
    return this.db.transaction(() => {
      const chatCountRow = this.db.get<{ total: number }>(
        'SELECT COUNT(*) AS total FROM chats',
      );
      const messageCountRow = this.db.get<{ total: number }>(
        'SELECT COUNT(*) AS total FROM messages',
      );

      const deletedChats = chatCountRow?.total ?? 0;
      const deletedMessages = messageCountRow?.total ?? 0;

      this.db.run('DELETE FROM chats');

      this.logger.log(
        `Deleted ${deletedChats} chats and ${deletedMessages} cascaded messages in bulk`,
      );

      return {
        deletedChats,
        deletedMessages,
      };
    });
  }

  /**
   * Enforces that exactly one of agentId or teamId is provided.
   *
   * Blank strings count as absent, so `{"agentId": "  "}` is rejected as
   * "no owner" rather than reaching the foreign-key check as a lookup that
   * cannot match.
   *
   * @throws BadRequestException (400) when both or neither is supplied.
   */
  private assertOwnerRule(dto: CreateChatDto): void {
    const hasAgent =
      typeof dto.agentId === 'string' && dto.agentId.trim().length > 0;
    const hasTeam =
      typeof dto.teamId === 'string' && dto.teamId.trim().length > 0;

    if (hasAgent && hasTeam) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: BOTH_OWNERS_ERROR_MESSAGE,
      });
    }

    if (!hasAgent && !hasTeam) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: NEITHER_OWNER_ERROR_MESSAGE,
      });
    }
  }

  /**
   * Enforces that chat owner cannot be changed via update.
   *
   * Checked with `in` as well as against `undefined`, so an explicit
   * `"agentId": null` — an attempt to clear the owner — is rejected too.
   *
   * @throws BadRequestException (400) when either owner field is present.
   */
  private assertNoOwnerChange(dto: UpdateChatDto): void {
    if (
      ('agentId' in dto && dto.agentId !== undefined) ||
      ('teamId' in dto && dto.teamId !== undefined)
    ) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: OWNER_IMMUTABLE_ERROR_MESSAGE,
      });
    }
  }

  /**
   * Enforces that context_summary cannot be set directly by clients.
   *
   * The column is written by context compaction, which is not implemented yet.
   * Rejecting it now keeps clients from coming to depend on setting it. Both
   * spellings are checked because the camelCase one is what a client would
   * send, while the snake_case one could arrive through a hand-built request.
   *
   * @throws BadRequestException (400) when either spelling is present.
   */
  private assertNoContextSummary(
    dto: CreateChatDto | UpdateChatDto | Record<string, unknown>,
  ): void {
    const record = dto as Record<string, unknown>;
    if (
      record.contextSummary !== undefined ||
      record.context_summary !== undefined
    ) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: CONTEXT_SUMMARY_READONLY_ERROR_MESSAGE,
      });
    }
  }
}
