/**
 * Helpers for translating between SQLite storage types and the JSON shapes the
 * API exposes.
 *
 * SQLite has no boolean type and no JSON type, so the schema in `data/` stores
 * booleans as `INTEGER` (`providers.enabled`, `models.enabled`,
 * `backup_policy.enabled`, `providers.is_local`) and structured values as
 * JSON-encoded `TEXT` (`agent_memories.tags`, `shared_memories.tags`,
 * `agents.model_params`, `usage_events.metadata`).
 *
 * Every resource module should map through these helpers so the API never
 * leaks `1`/`0` where a client expects `true`/`false`, or a JSON string where
 * a client expects an array.
 */

/**
 * Converts an API boolean into its stored representation.
 */
export function toDbBoolean(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

/**
 * Converts a stored `INTEGER` boolean into a real boolean.
 *
 * SQLite drivers may hand back a number or, for a nullable column, `null`. A
 * missing value is reported as `false` rather than throwing; columns where that
 * distinction matters are declared `NOT NULL` in the schema.
 */
export function fromDbBoolean(
  value: number | boolean | null | undefined,
): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  return value !== null && value !== undefined && value !== 0;
}

/**
 * Serialises a value for a JSON `TEXT` column.
 *
 * `null` and `undefined` both collapse to `null` so that "absent" has exactly
 * one representation in the database.
 */
export function serializeJsonColumn(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return JSON.stringify(value);
}

/**
 * Parses a JSON `TEXT` column.
 *
 * Returns `fallback` when the column is null or holds text that is not valid
 * JSON. Nothing writing through {@link serializeJsonColumn} can produce invalid
 * JSON, but a row hand-edited or written by an older version should degrade to
 * a usable default rather than failing the whole request that read it.
 */
export function parseJsonColumn<T>(
  value: string | null | undefined,
  fallback: T,
): T {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
