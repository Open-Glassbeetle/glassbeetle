import { BadRequestException } from '@nestjs/common';
import type { PaginationQueryDto, SortOrder } from './pagination-query.dto.js';

/**
 * Inputs to {@link buildPaginationSqlFragment}.
 */
export interface SqlPaginationOptions {
  /**
   * The validated pagination query parameters from the request.
   */
  query: PaginationQueryDto;

  /**
   * Mapping of allowed client-facing sort keys to their exact, safe SQL column names.
   * Example: `{ createdAt: 'created_at', name: 'name', id: 'id' }`
   */
  allowedSortColumns: Record<string, string>;

  /**
   * Default sort key (must be a key in `allowedSortColumns`).
   */
  defaultSortKey: string;

  /**
   * Default sort order if not specified ('asc' or 'desc'). Defaults to 'desc'.
   */
  defaultOrder?: SortOrder;

  /**
   * Primary key or tiebreaker column to guarantee deterministic sorting.
   * Defaults to 'id'. Set to `null` to disable tiebreaker.
   */
  tiebreakerColumn?: string | null;
}

/**
 * SQL fragments and bound parameters produced by
 * {@link buildPaginationSqlFragment}.
 *
 * The fragments contain no interpolated client input: column names come from
 * the caller's whitelist and the direction is one of two literals, while
 * `limit` and `offset` are passed as bound parameters.
 */
export interface SqlPaginationResult {
  /**
   * Safe combined SQL clause, e.g. "ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
   */
  clauseSql: string;

  /**
   * ORDER BY fragment only, e.g. "ORDER BY created_at DESC, id DESC"
   */
  orderBySql: string;

  /**
   * LIMIT / OFFSET fragment only, e.g. "LIMIT ? OFFSET ?"
   */
  limitOffsetSql: string;

  /**
   * Parameters for the LIMIT and OFFSET bindings: `[limit, offset]`
   */
  params: [number, number];
}

/**
 * Builds safe `ORDER BY` and `LIMIT`/`OFFSET` fragments for a list endpoint.
 *
 * Column names cannot be bound as SQL parameters, so a sort key coming from the
 * query string would otherwise have to be interpolated into the statement. The
 * whitelist is what makes that safe: only a key the endpoint declared is
 * accepted, and the SQL carries the mapped column name rather than the client's
 * string.
 *
 * A tiebreaker column is appended unless it is already the sort column. Without
 * it, rows sharing a sort value have no defined order between them and the same
 * row can appear on two pages or on none. `id` is the default because
 * identifiers are UUIDv7 and therefore sort in creation order.
 *
 * `limit` and `offset` are clamped again here even though the DTO validated
 * them, since this function is also called with hand-built query objects.
 *
 * @returns The fragments plus the `[limit, offset]` parameters to append to the
 * statement's bindings.
 * @throws BadRequestException (400) when `query.sort` names a key that is not
 * in `allowedSortColumns`; the message lists the keys that are.
 * @throws Error when `defaultSortKey` is not in `allowedSortColumns`. That is a
 * programming mistake in the calling endpoint, not bad input.
 */
export function buildPaginationSqlFragment(
  options: SqlPaginationOptions,
): SqlPaginationResult {
  const {
    query,
    allowedSortColumns,
    defaultSortKey,
    defaultOrder = 'desc',
    tiebreakerColumn = 'id',
  } = options;

  const requestedSort = query.sort?.trim();
  let sortColumn: string;

  if (requestedSort) {
    if (
      !Object.prototype.hasOwnProperty.call(allowedSortColumns, requestedSort)
    ) {
      const allowedKeys = Object.keys(allowedSortColumns).join(', ');
      throw new BadRequestException(
        `Invalid sort field "${requestedSort}". Allowed sort fields: ${allowedKeys}`,
      );
    }
    sortColumn = allowedSortColumns[requestedSort];
  } else {
    if (
      !Object.prototype.hasOwnProperty.call(allowedSortColumns, defaultSortKey)
    ) {
      throw new Error(
        `Default sort key "${defaultSortKey}" is not in allowedSortColumns mapping`,
      );
    }
    sortColumn = allowedSortColumns[defaultSortKey];
  }

  const order = (query.order?.toLowerCase() as SortOrder) ?? defaultOrder;
  const orderUpper = order === 'asc' ? 'ASC' : 'DESC';

  const tiebreakerClause =
    tiebreakerColumn && sortColumn !== tiebreakerColumn
      ? `, ${tiebreakerColumn} ${orderUpper}`
      : '';

  const orderBySql = `ORDER BY ${sortColumn} ${orderUpper}${tiebreakerClause}`;
  const limitOffsetSql = `LIMIT ? OFFSET ?`;
  const clauseSql = `${orderBySql} ${limitOffsetSql}`;

  const limit = Math.min(Math.max(1, query.limit ?? 50), 100);
  const offset = Math.max(0, query.offset ?? 0);

  return {
    clauseSql,
    orderBySql,
    limitOffsetSql,
    params: [limit, offset],
  };
}

/**
 * Escapes characters with special meaning in SQLite LIKE patterns (`\`, `%`, `_`).
 *
 * Ensures a user-supplied search term is matched as a literal substring: without
 * it, typing `%` in a search box matches every row, and `_` matches any
 * character. Shared by every endpoint with a name filter, so the behaviour of
 * the search box does not depend on which list it is in.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/([\\%_])/g, '\\$1');
}
