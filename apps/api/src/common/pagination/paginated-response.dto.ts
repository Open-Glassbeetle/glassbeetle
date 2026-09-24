import { ApiProperty } from '@nestjs/swagger';

/**
 * Standard paginated collection envelope interface.
 */
export interface PaginatedResponse<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/**
 * Creates a standard paginated response envelope.
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
 * Class helper for OpenAPI metadata generation on paginated DTOs.
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
