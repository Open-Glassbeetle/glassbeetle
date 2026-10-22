import { ApiProperty } from '@nestjs/swagger';

/**
 * Standard paginated collection envelope returned by every list endpoint.
 *
 * One shape for all collections, so a client writes its list handling once.
 * Cursor pagination is deliberately not used: the database is local SQLite and
 * `LIMIT`/`OFFSET` over a UUIDv7 tiebreaker is both stable enough and far
 * simpler to consume.
 */
export interface PaginatedResponse<T> {
  /**
   * The requested slice of matching rows, in the requested sort order.
   */
  readonly items: readonly T[];
  /**
   * Number of rows matching the filters, ignoring `limit` and `offset`, so a
   * client can compute how many pages there are.
   */
  readonly total: number;
  /**
   * Page size actually applied, which may be lower than the client asked for.
   */
  readonly limit: number;
  /**
   * Index of the first returned row within the full filtered result.
   */
  readonly offset: number;
}

/**
 * Creates a standard paginated response envelope.
 *
 * Every list endpoint goes through this rather than assembling the object
 * itself, so the four fields cannot drift apart between resources.
 *
 * @param items - Rows for this page, already mapped to response DTOs.
 * @param total - Count of all rows matching the filters.
 * @param limit - Page size that was applied.
 * @param offset - Offset that was applied.
 */
export function createPaginatedResponse<T>(
  items: T[],
  total: number,
  limit: number,
  offset: number,
): PaginatedResponse<T> {
  return {
    items,
    total,
    limit,
    offset,
  };
}

/**
 * Class form of {@link PaginatedResponse}, used only to generate OpenAPI
 * metadata.
 *
 * Decorators cannot be attached to an interface, and the generic `items` array
 * has no schema of its own here. Each resource therefore declares a concrete
 * subclass that overrides `items` with its own response DTO type — see
 * `PaginatedAgentsResponseDto` — and nothing constructs this class directly.
 */
export class PaginatedResponseDto<T> implements PaginatedResponse<T> {
  @ApiProperty({ isArray: true, description: 'Items in the current page' })
  readonly items!: readonly T[];

  @ApiProperty({ example: 42, description: 'Total number of items matching filters' })
  readonly total!: number;

  @ApiProperty({ example: 50, description: 'Maximum number of items returned per page' })
  readonly limit!: number;

  @ApiProperty({ example: 0, description: 'Offset of the first item returned' })
  readonly offset!: number;
}
