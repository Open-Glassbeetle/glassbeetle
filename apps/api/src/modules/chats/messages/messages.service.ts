import { Injectable } from '@nestjs/common';
import {
  createPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/pagination/paginated-response.dto.js';
import { buildPaginationSqlFragment } from '../../../common/pagination/sql-query-builder.js';
import { DatabaseService } from '../../../database/database.service.js';
import { ChatsService } from '../chats.service.js';
import {
  mapMessageRowToResponse,
  type ListMessagesQueryDto,
  type MessageResponseDto,
  type MessageRow,
} from './dto/index.js';

/**
 * Whitelist of allowed sort columns for the messages collection endpoint.
 *
 * Sequence is dense, unique per chat, and covered by `idx_messages_chat_id_sequence`.
 * Ordering by `created_at` is unindexed and prone to timestamp collisions;
 * therefore only `sequence` is permitted.
 */
export const ALLOWED_MESSAGE_SORT_COLUMNS: Readonly<Record<string, string>> = {
  sequence: 'sequence',
};

@Injectable()
export class MessagesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly chats: ChatsService,
  ) {}

  /**
   * Retrieves messages belonging to a chat, ordered by sequence (default: ascending).
   *
   * Features:
   * - Strict chat existence check (throws 404 CHAT_NOT_FOUND if chat does not exist).
   * - Scoped by `chat_id` on every query to prevent message leaking across chats.
   * - Supports sequence-based cursor pagination (`before` / `after`) as well as offset pagination.
   * - Sequence ordering can be reversed (`order=desc`) for loading tail turns in conversation view.
   * - Filters by `role`, `status`, and `agentId` (with `'null'` matching unassigned/deleted agents).
   * - Messages in `pending` or `streaming` status are returned verbatim with their partial/in-flight content.
   * - Nullable foreign keys (such as deleted agents via ON DELETE SET NULL) return `agentId: null`.
   */
  async findAll(
    chatId: string,
    query: ListMessagesQueryDto,
  ): Promise<PaginatedResponse<MessageResponseDto>> {
    // 1. Verify parent chat exists; return 404 if not.
    this.chats.assertExists(chatId);

    // 2. Base domain filters scoped to this chat.
    const filterConditions: string[] = ['chat_id = ?'];
    const filterParams: unknown[] = [chatId];

    if (query.role) {
      filterConditions.push('role = ?');
      filterParams.push(query.role);
    }

    if (query.status) {
      filterConditions.push('status = ?');
      filterParams.push(query.status);
    }

    if (query.agentId !== undefined) {
      if (query.agentId === 'null') {
        filterConditions.push('agent_id IS NULL');
      } else {
        filterConditions.push('agent_id = ?');
        filterParams.push(query.agentId);
      }
    }

    // 3. Total count of messages matching the domain filters for this chat.
    const countSql = `SELECT COUNT(*) AS total FROM messages WHERE ${filterConditions.join(' AND ')}`;
    const countRow = this.db.get<{ total: number }>(countSql, filterParams);
    const total = countRow?.total ?? 0;

    // 4. Query conditions including pagination cursors (before / after sequence).
    const queryConditions: string[] = [...filterConditions];
    const queryParams: unknown[] = [...filterParams];

    if (query.before !== undefined) {
      queryConditions.push('sequence < ?');
      queryParams.push(query.before);
    }

    if (query.after !== undefined) {
      queryConditions.push('sequence > ?');
      queryParams.push(query.after);
    }

    // 5. Build pagination and ordering fragment using the shared helper.
    const pagination = buildPaginationSqlFragment({
      query,
      allowedSortColumns: ALLOWED_MESSAGE_SORT_COLUMNS,
      defaultSortKey: 'sequence',
      defaultOrder: 'asc',
      tiebreakerColumn: null,
    });

    const whereClause = `WHERE ${queryConditions.join(' AND ')}`;
    const rowsSql = `SELECT * FROM messages ${whereClause} ${pagination.clauseSql}`;
    const rows = this.db.all<MessageRow>(rowsSql, [
      ...queryParams,
      ...pagination.params,
    ]);

    return createPaginatedResponse(
      rows.map(mapMessageRowToResponse),
      total,
      query.limit,
      query.offset,
    );
  }
}
