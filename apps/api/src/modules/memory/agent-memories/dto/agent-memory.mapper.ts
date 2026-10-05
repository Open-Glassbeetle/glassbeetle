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
