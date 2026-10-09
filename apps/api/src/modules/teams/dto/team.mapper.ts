import { newId } from '../../../common/persistence/identifiers.js';
import { nowIso } from '../../../common/persistence/timestamps.js';
import type { CreateTeamDto } from './create-team.dto.js';
import type { TeamResponseDto } from './team-response.dto.js';
import type { UpdateTeamDto } from './update-team.dto.js';

/**
 * Raw row shape for the `teams` SQLite table.
 */
export interface TeamRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * A `teams` row joined with its roster size.
 */
export interface TeamRowWithCount extends TeamRow {
  readonly member_count: number;
}

/**
 * Maps a `teams` row and its roster size to the public representation.
 */
export function mapTeamRowToResponse(row: TeamRowWithCount): TeamResponseDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    // `COUNT` over a LEFT JOIN yields 0 for a team with no members, but a
    // hand-built row might not, and a null count would render as blank.
    memberCount: Number(row.member_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Options when mapping a `CreateTeamDto` to a new row. */
export interface CreateTeamRowOptions {
  readonly id?: string;
  readonly now?: string;
}

/**
 * Maps a `CreateTeamDto` to a fresh `TeamRow` ready for insertion.
 */
export function mapCreateTeamDtoToRow(
  dto: CreateTeamDto,
  options?: CreateTeamRowOptions,
): TeamRow {
  const timestamp = options?.now ?? nowIso();

  return {
    id: options?.id ?? newId(),
    name: dto.name,
    description: dto.description ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

/**
 * Result of evaluating an `UpdateTeamDto` against an existing row.
 */
export interface TeamUpdateResult {
  readonly updatedRow: TeamRow;
  readonly hasChanges: boolean;
  readonly setClauses: readonly string[];
  readonly setParams: readonly unknown[];
}

/**
 * Applies an `UpdateTeamDto` to an existing `TeamRow`.
 *
 * Same null-vs-omitted contract as the rest of the API: omitted leaves the
 * column alone, `null` clears a nullable one, and a field set to the value it
 * already holds is not a change, so re-saving an unedited form does not bump
 * `updated_at`.
 */
export function applyTeamUpdates(
  existingRow: TeamRow,
  dto: UpdateTeamDto,
  options?: { readonly now?: string },
): TeamUpdateResult {
  const changedColumns: Record<string, unknown> = {};
  const setClauses: string[] = [];
  const setParams: unknown[] = [];

  function recordChange(column: keyof TeamRow, value: unknown): void {
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

  const updatedRow: TeamRow = {
    ...existingRow,
    ...(changedColumns as Partial<TeamRow>),
    updated_at: updatedAt,
  };

  return { updatedRow, hasChanges, setClauses, setParams };
}
