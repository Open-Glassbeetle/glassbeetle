import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  createPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/pagination/paginated-response.dto.js';
import { buildPaginationSqlFragment } from '../../../common/pagination/sql-query-builder.js';
import { newId } from '../../../common/persistence/identifiers.js';
import { nowIso } from '../../../common/persistence/timestamps.js';
import { DatabaseService } from '../../../database/database.service.js';
import { ChatsService } from '../chats.service.js';
import {
  mapMessageRowToResponse,
  type CreateMessageDto,
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

/**
 * Owns the `messages` table: the conversation history below a chat.
 *
 * Messages are append-only. There is no update and no delete endpoint — a
 * transcript that could be edited is not a transcript — so the interesting
 * problems here are scoping and sequence assignment rather than mutation.
 *
 * Every query is scoped by `chat_id` as well as by the message's own id.
 * Identifiers are globally unique, so `WHERE id = ?` alone would return
 * another chat's message through a URL naming the wrong chat; the project
 * treats that class of mistake as a security bug.
 *
 * @see `docs/api-conventions.md`
 */
@Injectable()
export class MessagesService {
  /**
   * @param db - The shared SQLite connection.
   * @param chats - Used only to assert the parent chat exists, so both
   * resources answer with the same `CHAT_NOT_FOUND` code.
   */
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

  /**
   * Appends a message to a chat with atomic, race-free sequence assignment.
   *
   * Architectural & concurrency guarantees:
   * 1. Chat existence:
   *    - The parent chat is verified prior to insertion; non-existent chats throw 404 CHAT_NOT_FOUND.
   *    - Defensive handling: If the chat's owning agent was deleted, appending is still permitted
   *      because conversation history is append-only and the chat row itself exists.
   * 2. Agent attribution:
   *    - If `agentId` is supplied, it must exist in `agents` table (422 AGENT_NOT_FOUND naming the field).
   *    - Team membership is intentionally not required, allowing guest agents, departed team members,
   *      and imported multi-agent transcripts.
   * 3. Atomic sequence computation:
   *    - The sequence is assigned via an atomic subquery: `COALESCE(MAX(sequence), 0) + 1` scoped to `chat_id`.
   *    - The first message in an empty chat receives `sequence = 1`; subsequent messages increment by 1.
   *    - Executed in a single atomic SQL statement inside a transaction, eliminating read-then-write drift.
   * 4. Conflict retry (belt-and-braces):
   *    - The database `UNIQUE (chat_id, sequence)` constraint guarantees absolute integrity.
   *    - If a collision occurs under high concurrency, up to 3 retries are performed before throwing 409 ConflictException.
   * 5. Parent chat timestamp:
   *    - The chat's `updated_at` column is advanced to match `created_at` in the exact same transaction.
   * 6. Status and token count:
   *    - Status is fixed to `'complete'` for directly posted messages.
   *    - `token_count` is explicitly left `null` (token counting belongs to model inference).
   *
   * @param options - Fixed `id` and timestamp, for tests that assert on an
   * exact row. Honoured on the first attempt only, so a retry cannot reuse an
   * id the failed attempt may already have written.
   * @throws NotFoundException (404) when the chat does not exist.
   * @throws UnprocessableEntityException (422) with code `AGENT_NOT_FOUND`
   * when `agentId` names an agent that does not.
   * @throws ConflictException (409) with code `MESSAGE_SEQUENCE_CONFLICT` when
   * the sequence could not be assigned within the retry budget.
   */
  async create(
    chatId: string,
    dto: CreateMessageDto,
    options?: { id?: string; now?: string },
  ): Promise<MessageResponseDto> {
    // 1. Verify parent chat exists.
    this.chats.assertExists(chatId);

    // 2. Validate referenced agent exists if agentId was provided.
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

    const role = dto.role ?? 'user';
    const agentId = dto.agentId ?? null;
    const maxRetries = 3;
    let attempts = 0;

    while (attempts < maxRetries) {
      attempts += 1;
      const messageId = options?.id && attempts === 1 ? options.id : newId();
      const now = options?.now && attempts === 1 ? options.now : nowIso();

      try {
        return this.db.transaction(() => {
          const insertSql = `
            INSERT INTO messages (
              id,
              chat_id,
              sequence,
              role,
              agent_id,
              content,
              status,
              token_count,
              created_at
            ) VALUES (
              ?,
              ?,
              (SELECT COALESCE(MAX(sequence), 0) + 1 FROM messages WHERE chat_id = ?),
              ?,
              ?,
              ?,
              ?,
              ?,
              ?
            )
            RETURNING *
          `;

          const row = this.db.get<MessageRow>(insertSql, [
            messageId,
            chatId,
            chatId,
            role,
            agentId,
            dto.content,
            'complete',
            null,
            now,
          ]);

          this.db.run('UPDATE chats SET updated_at = ? WHERE id = ?', [
            now,
            chatId,
          ]);

          return mapMessageRowToResponse(row!);
        });
      } catch (error: any) {
        const isUniqueConstraint =
          error?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
          (typeof error?.message === 'string' &&
            error.message.includes('UNIQUE constraint failed: messages.chat_id, messages.sequence'));

        if (isUniqueConstraint && attempts < maxRetries) {
          continue;
        }

        if (isUniqueConstraint) {
          throw new ConflictException({
            code: 'MESSAGE_SEQUENCE_CONFLICT',
            message: 'Could not resolve sequence assignment conflict after multiple retries',
          });
        }

        throw error;
      }
    }

    /* istanbul ignore next */
    throw new ConflictException({
      code: 'MESSAGE_SEQUENCE_CONFLICT',
      message: 'Could not resolve sequence assignment conflict',
    });
  }
}
