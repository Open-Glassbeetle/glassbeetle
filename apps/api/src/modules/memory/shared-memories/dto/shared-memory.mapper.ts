import {
  normalizeTagsOnWrite,
  parseTagsOnRead,
} from '../../tags/index.js';
import type {
  SharedMemoryResponseDto,
  SharedMemoryRow,
} from './shared-memory-response.dto.js';

export { normalizeTagsOnWrite, parseTagsOnRead };

/**
 * Maps a SQLite `shared_memories` row to the public `SharedMemoryResponseDto`.
 *
 * Ensures:
 * - Snake_case columns (`created_at`, `updated_at`) are mapped to camelCase.
 * - `tags` JSON column is deserialized into `string[]`. If null, empty, or invalid JSON,
 *   it falls back to `[]` so consumers always receive an array.
 */
export function mapSharedMemoryRowToResponse(
  row: SharedMemoryRow,
): SharedMemoryResponseDto {
  return {
    id: row.id,
    content: row.content,
    tags: parseTagsOnRead(row.tags),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Result of computing partial updates against an existing shared memory row.
 */
export interface ApplySharedMemoryUpdatesResult {
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
 * - `created_at` and `id` are never modified.
 */
export function applySharedMemoryUpdates(
  existing: SharedMemoryRow,
  dto: { readonly content?: string; readonly tags?: readonly string[] | null },
  now: string,
): ApplySharedMemoryUpdatesResult {
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
