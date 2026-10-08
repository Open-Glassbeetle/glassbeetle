import {
  fromDbBoolean,
  toDbBoolean,
} from '../../../common/persistence/row-mapping.js';
import { nowIso } from '../../../common/persistence/timestamps.js';
import type { UpdateUserProfileDto } from './update-user-profile.dto.js';
import type { UserProfileResponseDto } from './user-profile-response.dto.js';

/**
 * Raw row shape for the `user_profile` SQLite table.
 */
export interface UserProfileRow {
  readonly id: string;
  readonly singleton: number;
  readonly display_name: string | null;
  readonly pronouns: string | null;
  readonly about: string | null;
  readonly locale: string | null;
  readonly timezone: string | null;
  readonly include_in_prompts: number;
  readonly picture_path: string | null;
  readonly picture_updated_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Maps a SQLite `user_profile` row to the public `UserProfileResponseDto`.
 *
 * Ensures:
 * - `picture_path` is never leaked; replaced by `hasPicture: boolean`.
 * - `singleton` is never leaked; it constrains the table, it does not describe
 *   the user.
 * - `include_in_prompts` is a real boolean rather than SQLite's 0/1.
 * - Nullable columns are returned as `null`, not undefined.
 * - Snake_case columns are mapped to camelCase.
 */
export function mapUserProfileRowToResponse(
  row: UserProfileRow,
): UserProfileResponseDto {
  return {
    id: row.id,
    displayName: row.display_name ?? null,
    pronouns: row.pronouns ?? null,
    about: row.about ?? null,
    locale: row.locale ?? null,
    timezone: row.timezone ?? null,
    includeInPrompts: fromDbBoolean(row.include_in_prompts),
    hasPicture: Boolean(row.picture_path),
    pictureUpdatedAt: row.picture_updated_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Result of evaluating an `UpdateUserProfileDto` against an existing row.
 */
export interface UserProfileUpdateResult {
  /** The updated row representation. */
  readonly updatedRow: UserProfileRow;
  /** True if at least one field was changed. */
  readonly hasChanges: boolean;
  /** SQL SET clauses (e.g. `["display_name = ?"]`). */
  readonly setClauses: readonly string[];
  /** Parameter values corresponding to `setClauses`. */
  readonly setParams: readonly unknown[];
}

/**
 * Applies an `UpdateUserProfileDto` to an existing `UserProfileRow`.
 *
 * Implements the null-vs-omitted contract:
 * - Omitted (`undefined`): column is unchanged.
 * - Explicit `null`: nullable column is set to `null`.
 * - Value: column is set to the provided value.
 * - A field set to the value it already holds is not a change, so a client
 *   re-submitting an unedited form does not bump `updated_at`.
 */
export function applyUserProfileUpdates(
  existingRow: UserProfileRow,
  dto: UpdateUserProfileDto,
  options?: { readonly now?: string },
): UserProfileUpdateResult {
  const changedColumns: Record<string, unknown> = {};
  const setClauses: string[] = [];
  const setParams: unknown[] = [];

  function recordChange(column: keyof UserProfileRow, value: unknown): void {
    changedColumns[column] = value;
    setClauses.push(`${column} = ?`);
    setParams.push(value);
  }

  function recordText(
    column: 'display_name' | 'pronouns' | 'about' | 'locale' | 'timezone',
    incoming: string | null | undefined,
  ): void {
    if (incoming === undefined) {
      return;
    }

    const next = incoming ?? null;
    if (next !== existingRow[column]) {
      recordChange(column, next);
    }
  }

  recordText('display_name', dto.displayName);
  recordText('pronouns', dto.pronouns);
  recordText('about', dto.about);
  recordText('locale', dto.locale);
  recordText('timezone', dto.timezone);

  if (dto.includeInPrompts !== undefined) {
    const next = toDbBoolean(dto.includeInPrompts);
    if (next !== existingRow.include_in_prompts) {
      recordChange('include_in_prompts', next);
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

  const updatedRow: UserProfileRow = {
    ...existingRow,
    ...(changedColumns as Partial<UserProfileRow>),
    updated_at: updatedAt,
  };

  return { updatedRow, hasChanges, setClauses, setParams };
}
