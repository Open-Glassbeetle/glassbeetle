/**
 * Shared helpers and constants for memory tags storage, normalisation, and querying.
 *
 * Designed to be shared between `agent_memories` and `shared_memories`.
 */

/**
 * Longest tag the API stores. Longer tags are truncated on write rather than
 * rejected, since a tag is a label and not content.
 */
export const MAX_TAG_LENGTH = 50;
/**
 * Most tags one memory can carry.
 *
 * A bound on the work a single tag filter can cause: each tag in an `all`
 * query becomes its own `EXISTS` subquery over `json_each`.
 */
export const MAX_TAGS_PER_MEMORY = 50;

/**
 * Filter mode for multi-tag querying.
 * - 'all': Memory must contain ALL specified tags (intersection).
 * - 'any': Memory must contain AT LEAST ONE specified tag (union).
 */
export type TagFilterMode = 'all' | 'any';

/**
 * Options for {@link buildTagFilterPredicate}.
 */
export interface TagFilterOptions {
  /**
   * Matching semantics; defaults to `all`.
   */
  readonly mode?: TagFilterMode;
  /**
   * Column holding the JSON tag array; defaults to `tags`.
   *
   * Interpolated into the SQL, so it must never come from a request — it names
   * a column, and column names cannot be bound as parameters.
   */
  readonly column?: string;
}

/**
 * A ready-to-compose `WHERE` fragment and its bound parameters.
 */
export interface TagFilterPredicate {
  /**
   * Parenthesised predicate, safe to join with `AND`.
   */
  readonly sqlClause: string;
  /**
   * Tag values for the fragment's placeholders, in order.
   */
  readonly params: readonly unknown[];
}

/**
 * Normalises a single tag string.
 * Trims whitespace, folds case to lowercase, and limits length.
 * Returns null if the tag is empty after trimming.
 *
 * Case folding is what makes `Recipes` and `recipes` the same tag. It happens
 * here, on both the write and the filter path, so the comparison in SQL can
 * stay a plain equality on JSON values — SQLite's `json_each` has no
 * case-insensitive matching.
 */
export function normalizeTag(tag: string): string | null {
  if (typeof tag !== 'string') {
    return null;
  }
  const trimmed = tag.trim().toLowerCase();
  if (trimmed === '') {
    return null;
  }
  return trimmed.slice(0, MAX_TAG_LENGTH);
}

/**
 * Normalises tags for SQLite storage.
 *
 * Normalisation Contract:
 * - Both an omitted/null tags value and an empty array `[]` represent "no tags".
 * - On write, both are normalised to SQL `NULL` so the database does not contain
 *   two conflicting representations (`NULL` vs `'[]'`) for the same concept.
 * - Individual tags are trimmed and converted to lowercase.
 * - Empty string tags are discarded.
 * - Duplicate tags are eliminated.
 * - Tags are sorted in ascending alphabetical order for canonical, deterministic storage.
 * - Non-empty arrays of strings are serialised to canonical JSON text (e.g. `["a","b"]`).
 */
export function normalizeTagsOnWrite(
  tags?: readonly string[] | null,
): string | null {
  if (!tags || !Array.isArray(tags) || tags.length === 0) {
    return null;
  }

  const cleaned: string[] = [];
  for (const item of tags) {
    const norm = normalizeTag(item);
    if (norm !== null) {
      cleaned.push(norm);
    }
  }

  if (cleaned.length === 0) {
    return null;
  }

  const uniqueSorted = Array.from(new Set(cleaned))
    .sort()
    .slice(0, MAX_TAGS_PER_MEMORY);

  return JSON.stringify(uniqueSorted);
}

/**
 * Parses the `tags` column from SQLite safely.
 *
 * Returns an array of strings (`string[]`).
 * If the input is null, undefined, empty, invalid JSON, or not a JSON array,
 * it safely degrades to an empty array `[]` without throwing an error.
 *
 * Degrading rather than throwing is deliberate: one hand-edited or legacy row
 * must not be able to fail the list request that happened to include it. The
 * API therefore always reports `tags` as an array, never `null`, which is why
 * clients need no second representation for "untagged".
 */
export function parseTagsOnRead(rawTags: unknown): string[] {
  if (rawTags === null || rawTags === undefined || rawTags === '') {
    return [];
  }

  if (Array.isArray(rawTags)) {
    return rawTags.filter((t): t is string => typeof t === 'string');
  }

  if (typeof rawTags !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(rawTags);
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === 'string');
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Parses raw client tag input into a deduplicated list of normalised tags.
 * Accepts a single tag, comma-separated tags ("a,b"), or a string array.
 *
 * All three forms are accepted because a query string gives no choice: Express
 * parses `?tags=a` as a string and `?tags=a&tags=b` as an array, and
 * `?tags=a,b` is what a client building a URL by hand will send.
 */
export function parseTagFilterInput(
  input: string | readonly string[],
): string[] {
  const rawList: string[] = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];

  const normalised: string[] = [];
  for (const raw of rawList) {
    const norm = normalizeTag(raw);
    if (norm !== null) {
      normalised.push(norm);
    }
  }

  return Array.from(new Set(normalised));
}

/**
 * Builds a safe SQL predicate for tag filtering in SQLite using JSON1.
 *
 * Characteristics:
 * - Guards against malformed JSON in the table with `json_valid(column) = 1` before calling `json_each`.
 * - Parameterized with `?` placeholders to prevent SQL injection.
 * - Supports 'all' (intersection) and 'any' (union) matching semantics.
 * - Untagged memories (`NULL`) naturally do not match.
 *
 * The `json_valid` guard is not decoration: `json_each` raises a SQLite error
 * on malformed JSON, and an error there would fail the whole list request
 * because of one bad row.
 *
 * @returns The predicate, or `null` when the input normalised to no tags at
 * all — which the caller must read as "no tag filter", not as "match nothing".
 */
export function buildTagFilterPredicate(
  tags: string | readonly string[],
  options?: TagFilterOptions,
): TagFilterPredicate | null {
  const parsedTags = parseTagFilterInput(tags);
  if (parsedTags.length === 0) {
    return null;
  }

  const column = options?.column ?? 'tags';
  const mode: TagFilterMode = options?.mode ?? 'all';

  if (mode === 'any') {
    const placeholders = parsedTags.map(() => '?').join(', ');
    const sqlClause = `(${column} IS NOT NULL AND json_valid(${column}) = 1 AND EXISTS (SELECT 1 FROM json_each(${column}) WHERE json_each.value IN (${placeholders})))`;
    return {
      sqlClause,
      params: parsedTags,
    };
  }

  // mode === 'all'
  const tagClauses = parsedTags.map(
    () =>
      `EXISTS (SELECT 1 FROM json_each(${column}) WHERE json_each.value = ?)`,
  );
  const sqlClause = `(${column} IS NOT NULL AND json_valid(${column}) = 1 AND ${tagClauses.join(' AND ')})`;

  return {
    sqlClause,
    params: parsedTags,
  };
}

/**
 * Builds a SQL query to list all distinct tags in use across memories.
 * Useful for autocomplete in client user interfaces.
 *
 * No endpoint exposes this yet; it is the query a tag picker would need.
 *
 * @param tableName - Interpolated into the SQL, so it must be a literal from
 * the calling code and never a value from a request.
 * @param options - `agentId` restricts the result to one agent's private tags;
 * it is bound as a parameter.
 */
export function getDistinctTagsQuery(
  tableName: 'agent_memories' | 'shared_memories' | string,
  options?: { readonly agentId?: string },
): { sql: string; params: readonly unknown[] } {
  const params: unknown[] = [];
  let where = `${tableName}.tags IS NOT NULL AND json_valid(${tableName}.tags) = 1`;

  if (options?.agentId) {
    where += ` AND ${tableName}.agent_id = ?`;
    params.push(options.agentId);
  }

  const sql = `SELECT DISTINCT json_each.value AS tag FROM ${tableName}, json_each(${tableName}.tags) WHERE ${where} ORDER BY tag ASC`;

  return { sql, params };
}
