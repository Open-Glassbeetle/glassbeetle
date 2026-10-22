import { newId } from '../../../common/persistence/identifiers.js';
import { nowIso } from '../../../common/persistence/timestamps.js';
import type { ChatResponseDto } from './chat-response.dto.js';
import type { CreateChatDto } from './create-chat.dto.js';
import type { UpdateChatDto } from './update-chat.dto.js';

/**
 * Raw row shape for the `chats` SQLite table.
 *
 * Both owner columns are nullable here even though a chat must have exactly
 * one owner: the `CHECK` constraint holds on insert, but `ON DELETE SET NULL`
 * can leave an existing chat with neither. The mapper copes with that rather
 * than asserting the invariant on read.
 *
 * `context_summary` is written by context compaction, which is not implemented,
 * and clients may not set it.
 */
export interface ChatRow {
  readonly id: string;
  readonly title: string | null;
  readonly project_id: string | null;
  readonly agent_id: string | null;
  readonly team_id: string | null;
  readonly context_summary: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Maps a SQLite `chats` row to the public `ChatResponseDto`.
 *
 * Defensive row mapping:
 * - A chat whose owning agent or team was deleted will have had its foreign key
 *   set to NULL by SQLite ON DELETE SET NULL, leaving both owner columns null.
 *   This mapper maps them directly without asserting that one owner is present,
 *   ensuring list and retrieve endpoints return the row rather than crashing.
 * - Snake_case columns are mapped to camelCase.
 * - Nullable columns are returned as `null`, never undefined.
 */
export function mapChatRowToResponse(row: ChatRow): ChatResponseDto {
  return {
    id: row.id,
    title: row.title ?? null,
    projectId: row.project_id ?? null,
    agentId: row.agent_id ?? null,
    teamId: row.team_id ?? null,
    contextSummary: row.context_summary ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Options when mapping a `CreateChatDto` to a new row.
 *
 * Both exist so a test can pin the generated id and timestamp and assert on an
 * exact row.
 */
export interface CreateChatRowOptions {
  readonly id?: string;
  readonly now?: string;
}

/**
 * Maps a `CreateChatDto` to a fresh `ChatRow` ready for insertion.
 */
export function mapCreateChatDtoToRow(
  dto: CreateChatDto,
  options?: CreateChatRowOptions,
): ChatRow {
  const timestamp = options?.now ?? nowIso();

  return {
    id: options?.id ?? newId(),
    title: dto.title ?? null,
    project_id: dto.projectId ?? null,
    agent_id: dto.agentId ?? null,
    team_id: dto.teamId ?? null,
    context_summary: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

/**
 * Result of evaluating an `UpdateChatDto` against an existing row.
 */
export interface ChatUpdateResult {
  /** The row as it will be after the update; equal to the existing row when nothing changed. */
  readonly updatedRow: ChatRow;
  /** Whether any column is actually being changed. */
  readonly hasChanges: boolean;
  /** SQL `SET` clauses, e.g. `["name = ?", "updated_at = ?"]`. */
  readonly setClauses: readonly string[];
  /** Bound values for `setClauses`, in the same order. */
  readonly setParams: readonly unknown[];
}

/**
 * Applies an `UpdateChatDto` to an existing `ChatRow`.
 *
 * Supported updates:
 * - `title`: set to new string, or cleared with explicit `null`.
 * - `projectId`: set to new project ID, or cleared with explicit `null` (moving out of a project).
 * - Empty body (`{}`): idempotent no-op (`updated_at` untouched).
 */
export function applyChatUpdates(
  existingRow: ChatRow,
  dto: UpdateChatDto,
  options?: { readonly now?: string },
): ChatUpdateResult {
  const changedColumns: Record<string, unknown> = {};
  const setClauses: string[] = [];
  const setParams: unknown[] = [];

  /**
   * Notes one column change in all three outputs at once, so the `SET` clause
   * and its bound parameter cannot drift apart.
   */
  function recordChange(column: keyof ChatRow, value: unknown): void {
    changedColumns[column] = value;
    setClauses.push(`${column} = ?`);
    setParams.push(value);
  }

  if (dto.title !== undefined) {
    const nextTitle = dto.title ?? null;
    if (nextTitle !== existingRow.title) {
      recordChange('title', nextTitle);
    }
  }

  if (dto.projectId !== undefined) {
    const nextProjectId = dto.projectId ?? null;
    if (nextProjectId !== existingRow.project_id) {
      recordChange('project_id', nextProjectId);
    }
  }

  const hasChanges = setClauses.length > 0;
  const updatedAt = hasChanges
    ? (options?.now ?? nowIso())
    : existingRow.updated_at;

  if (hasChanges) {
    changedColumns.updated_at = updatedAt;
    setClauses.push('updated_at = ?');
    setParams.push(updatedAt);
  }

  const updatedRow: ChatRow = {
    ...existingRow,
    ...(changedColumns as Partial<ChatRow>),
    updated_at: updatedAt,
  };

  return { updatedRow, hasChanges, setClauses, setParams };
}
