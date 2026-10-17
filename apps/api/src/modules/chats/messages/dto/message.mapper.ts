import type {
  MessageResponseDto,
  MessageRole,
  MessageStatus,
} from './message-response.dto.js';

/**
 * Raw row shape for the `messages` SQLite table.
 */
export interface MessageRow {
  readonly id: string;
  readonly chat_id: string;
  readonly sequence: number;
  readonly role: MessageRole;
  readonly agent_id: string | null;
  readonly content: string;
  readonly status: MessageStatus;
  readonly token_count: number | null;
  readonly created_at: string;
}

/**
 * Maps a SQLite `messages` row to the public `MessageResponseDto`.
 *
 * Rules:
 * - Snake_case columns are mapped to camelCase.
 * - Nullable columns are returned as `null`, never undefined (`agentId`, `tokenCount`).
 * - Messages with status `pending` or `streaming` are returned verbatim with their partial/empty content.
 * - Messages whose agent was deleted (foreign key set to NULL via ON DELETE SET NULL) return `agentId: null`.
 */
export function mapMessageRowToResponse(row: MessageRow): MessageResponseDto {
  return {
    id: row.id,
    chatId: row.chat_id,
    sequence: row.sequence,
    role: row.role,
    agentId: row.agent_id ?? null,
    content: row.content,
    status: row.status,
    tokenCount: row.token_count ?? null,
    createdAt: row.created_at,
  };
}
