import { nowIso } from '../../../common/persistence/timestamps.js';
import type { SystemPromptResponseDto } from './system-prompt-response.dto.js';
import type { UpdateSystemPromptDto } from './update-system-prompt.dto.js';

/**
 * Raw row shape for the `system_prompts` SQLite table.
 */
export interface SystemPromptRow {
  readonly id: string;
  readonly name: string;
  readonly content: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Maps a SQLite `system_prompts` row to the public `SystemPromptResponseDto`.
 */
export function mapSystemPromptRowToResponse(
  row: SystemPromptRow,
): SystemPromptResponseDto {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Result of computing partial updates against an existing system prompt row.
 */
export interface ApplySystemPromptUpdatesResult {
  readonly hasChanges: boolean;
  readonly setClauses: readonly string[];
  readonly setParams: readonly unknown[];
}

/**
 * Computes the SQL SET clauses and bound parameters for a partial update (PATCH).
 *
 * Rules:
 * - Only fields explicitly defined in the DTO are updated.
 * - If the provided value equals the existing value, no update is scheduled for that column.
 * - `updated_at` is updated only when one or more mutable columns change.
 * - `created_at` and `id` are never modified.
 */
export function applySystemPromptUpdates(
  existing: SystemPromptRow,
  dto: UpdateSystemPromptDto,
  now: string = nowIso(),
): ApplySystemPromptUpdatesResult {
  const setClauses: string[] = [];
  const setParams: unknown[] = [];
  let hasChanges = false;

  if (dto.name !== undefined && dto.name !== existing.name) {
    setClauses.push('name = ?');
    setParams.push(dto.name);
    hasChanges = true;
  }

  if (dto.content !== undefined && dto.content !== existing.content) {
    setClauses.push('content = ?');
    setParams.push(dto.content);
    hasChanges = true;
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
