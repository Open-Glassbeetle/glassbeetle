import { newId } from '../../../common/persistence/identifiers.js';
import { nowIso } from '../../../common/persistence/timestamps.js';
import type { CreateProjectDto } from './create-project.dto.js';
import type { ProjectResponseDto } from './project-response.dto.js';
import type { UpdateProjectDto } from './update-project.dto.js';

/**
 * Raw row shape for the `projects` SQLite table.
 *
 * Mirrors the DDL in `data/projects/projects.sql` exactly:
 * - `id`: TEXT PRIMARY KEY
 * - `name`: TEXT NOT NULL
 * - `description`: TEXT NULLABLE
 * - `image_path`: TEXT NULLABLE (local storage reference, never exposed verbatim)
 * - `created_at`: TEXT NOT NULL
 * - `updated_at`: TEXT NOT NULL
 */
export interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly image_path: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Raw row shape joined or aggregated with associated chat and artifact counts.
 */
export interface ProjectRowWithCounts extends ProjectRow {
  readonly chat_count?: number | bigint | null;
  readonly artifact_count?: number | bigint | null;
}

/**
 * Maps a SQLite `projects` row (with optional count aggregates) to the public
 * `ProjectResponseDto`.
 *
 * Guarantees:
 * - `image_path` is never leaked; replaced by `hasImage: boolean`.
 * - Nullable `description` is emitted as `null`, not `undefined`.
 * - Aggregated counts are coerced to standard JavaScript numbers (defaulting to 0).
 */
export function mapProjectRowToResponse(
  row: ProjectRowWithCounts,
): ProjectResponseDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    hasImage: Boolean(row.image_path),
    chatCount: Number(row.chat_count ?? 0),
    artifactCount: Number(row.artifact_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Options when mapping a `CreateProjectDto` to a new database row.
 *
 * Exists so tests can pin the generated ID and timestamp and assert on an
 * exact persisted row.
 */
export interface CreateProjectRowOptions {
  /** Optional ID override (defaults to generating a new UUIDv7). */
  readonly id?: string;
  /** Optional timestamp override (defaults to nowIso()). */
  readonly now?: string;
}

/**
 * Maps a `CreateProjectDto` to a fresh `ProjectRow` ready for database insertion.
 *
 * Server-side timestamps and IDs are generated here unless overridden in options.
 * `image_path` is always initialized to `null`: project images are managed
 * through their own upload route.
 */
export function mapCreateProjectDtoToRow(
  dto: CreateProjectDto,
  options?: CreateProjectRowOptions,
): ProjectRow {
  const timestamp = options?.now ?? nowIso();

  return {
    id: options?.id ?? newId(),
    name: dto.name,
    description: dto.description ?? null,
    image_path: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

/**
 * Result of evaluating an `UpdateProjectDto` against an existing `ProjectRow`.
 */
export interface ProjectUpdateResult {
  /** The prospective row state after applying updates. */
  readonly updatedRow: ProjectRow;
  /** True if at least one column has changed value. */
  readonly hasChanges: boolean;
  /** Map of column names to new values for SQL UPDATE. */
  readonly changedColumns: Readonly<Record<string, unknown>>;
  /** SQL SET clauses (e.g. `["name = ?", "updated_at = ?"]`). */
  readonly setClauses: readonly string[];
  /** Parameter values matching `setClauses`. */
  readonly setParams: readonly unknown[];
}

/**
 * Applies an `UpdateProjectDto` to an existing `ProjectRow`.
 *
 * Implements the partial update contract:
 * - Omitted (`undefined`): Column is untouched.
 * - Explicit `null`: Nullable `description` is set to `null`.
 * - Value: Column is updated if different from current value.
 * - If no fields were modified (`{}`), returns `hasChanges: false` without altering `updated_at`.
 * - `created_at` and `id` are immutable and never modified.
 */
export function applyProjectUpdates(
  existingRow: ProjectRow,
  dto: UpdateProjectDto,
  options?: { readonly now?: string },
): ProjectUpdateResult {
  const changedColumns: Record<string, unknown> = {};
  const setClauses: string[] = [];
  const setParams: unknown[] = [];

  function recordChange(column: keyof ProjectRow, value: unknown): void {
    changedColumns[column] = value;
    setClauses.push(`${column} = ?`);
    setParams.push(value);
  }

  if (dto.name !== undefined && dto.name !== existingRow.name) {
    recordChange('name', dto.name);
  }

  if (dto.description !== undefined) {
    const next = dto.description ?? null;
    if (next !== existingRow.description) {
      recordChange('description', next);
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

  const updatedRow: ProjectRow = {
    ...existingRow,
    ...(changedColumns as Partial<ProjectRow>),
    updated_at: updatedAt,
  };

  return {
    updatedRow,
    hasChanges,
    changedColumns,
    setClauses,
    setParams,
  };
}

