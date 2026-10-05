import {
  parseJsonColumn,
  serializeJsonColumn,
} from '../../../../common/persistence/row-mapping.js';
import type {
  AgentMemoryResponseDto,
  AgentMemoryRow,
} from './agent-memory-response.dto.js';

/**
 * Maps a SQLite `agent_memories` row to the public `AgentMemoryResponseDto`.
 *
 * Ensures:
 * - Snake_case columns (`agent_id`, `created_at`, `updated_at`) are mapped to camelCase.
 * - `tags` JSON column is deserialized into `string[]`. If null, empty, or invalid JSON,
 *   it falls back to `[]` so consumers always receive an array.
 */
export function mapAgentMemoryRowToResponse(
  row: AgentMemoryRow,
): AgentMemoryResponseDto {
  return {
    id: row.id,
    agentId: row.agent_id,
    content: row.content,
    tags: parseJsonColumn<string[]>(row.tags, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Normalises tags for SQLite storage.
 *
 * Normalisation Contract:
 * - Both an omitted/null tags value and an empty array `[]` represent "no tags".
 * - On write, both are normalised to SQL `NULL` so the database does not contain
 *   two conflicting representations (`NULL` vs `'[]'`) for the same concept.
 * - Non-empty arrays of strings are serialised to canonical JSON text (e.g. `["a","b"]`).
 */
export function normalizeTagsOnWrite(
  tags?: readonly string[] | null,
): string | null {
  if (!tags || tags.length === 0) {
    return null;
  }
  return serializeJsonColumn(tags);
}

/**
 * Result of computing partial updates against an existing agent memory row.
 */
export interface ApplyAgentMemoryUpdatesResult {
  readonly hasChanges: boolean;
  readonly setClauses: readonly string[];
  readonly setParams: readonly unknown[];
}

/**
 * Computes the SQL SET clauses and bound parameters for a partial update (PATCH).
 *
 * Rules:
 * - Only fields explicitly defined in the DTO are updated.
 * - If provided value equals existing value, no update is scheduled for that column.
 * - `updated_at` is updated only when one or more mutable columns change.
 * - `created_at`, `agent_id`, and `id` are never modified.
 */
export function applyAgentMemoryUpdates(
  existing: AgentMemoryRow,
  dto: { readonly content?: string; readonly tags?: readonly string[] | null },
  now: string,
): ApplyAgentMemoryUpdatesResult {
  const setClauses: string[] = [];
  const setParams: unknown[] = [];
  let hasChanges = false;

  if (dto.content !== undefined && dto.content !== existing.content) {
    setClauses.push('content = ?');
    setParams.push(dto.content);
    hasChanges = true;
  }

  if (dto.tags !== undefined) {
    const normalizedNewTags = normalizeTagsOnWrite(dto.tags);
    if (normalizedNewTags !== existing.tags) {
      setClauses.push('tags = ?');
      setParams.push(normalizedNewTags);
      hasChanges = true;
    }
  }

  if (hasChanges) {
    setClauses.push('updated_at = ?');
    setParams.push(now);
  }

  return {
    hasChanges,
    setClauses,
    setParams,
  };
}
