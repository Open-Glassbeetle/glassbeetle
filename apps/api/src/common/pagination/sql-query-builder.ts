import { BadRequestException } from '@nestjs/common';
import type { PaginationQueryDto, SortOrder } from './pagination-query.dto.js';

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
 * Builds safe, whitelisted SQL fragments for sorting and pagination with bound parameters.
 * Throws a 400 BadRequestException if an un-whitelisted sort field is supplied.
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
      !Object.prototype.hasOwnProperty.call(
        allowedSortColumns,
        requestedSort,
      )
    ) {
      const allowedKeys = Object.keys(allowedSortColumns).join(', ');
      throw new BadRequestException(
        `Invalid sort field "${requestedSort}". Allowed sort fields: ${allowedKeys}`,
      );
    }
    sortColumn = allowedSortColumns[requestedSort];
  } else {
    if (
      !Object.prototype.hasOwnProperty.call(
        allowedSortColumns,
        defaultSortKey,
      )
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
