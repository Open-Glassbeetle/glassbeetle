/**
 * Timestamps are stored as ISO-8601 strings in UTC with millisecond precision
 * (`2026-09-21T09:30:52.123Z`) in every `TEXT` timestamp column.
 *
 * This matches the format `data/backups/seed.sql` already writes via
 * `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`, and it compares correctly with SQLite's
 * lexicographic string comparison — so `WHERE created_at >= ?` and `ORDER BY
 * created_at` behave as expected without any conversion.
 *
 * Timestamps are generated in TypeScript rather than in SQL so that a single
 * write producing several rows can share one value, and so that tests can
 * control the clock.
 */

/**
 * The current time, formatted for storage.
 */
export function nowIso(): string {
  return toIso(new Date());
}

/**
 * Formats a date for storage. Always UTC, always millisecond precision.
 */
export function toIso(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Cannot format an invalid Date as a timestamp');
  }

  return date.toISOString();
}

/**
 * Parses a stored timestamp back into a `Date`.
 *
 * Returns `null` for a missing or unparseable value rather than throwing: a
 * single malformed row should not be able to fail an entire list request.
 */
export function fromIso(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
