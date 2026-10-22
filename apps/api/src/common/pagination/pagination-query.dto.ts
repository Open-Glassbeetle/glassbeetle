import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Sort direction accepted by every list endpoint.
 */
export type SortOrder = 'asc' | 'desc';

/**
 * Base DTO for list endpoint pagination and sorting query parameters.
 *
 * Enforces:
 * - Default limit: 50
 * - Maximum limit: 100
 * - Default offset: 0
 * - Order: 'asc' or 'desc'
 */
export class PaginationQueryDto {
  /**
   * Maximum rows to return. Integer between 1 and 100; defaults to 50.
   *
   * The ceiling is a guard, not a preference: the database is local and a
   * client asking for everything at once would otherwise serialise the whole
   * table into one response.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(100, { message: 'limit must not exceed 100' })
  limit: number = 50;

  /**
   * Number of matching rows to skip. Non-negative integer; defaults to 0.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'offset must be an integer' })
  @Min(0, { message: 'offset must be at least 0' })
  offset: number = 0;

  /**
   * Client-facing name of the column to sort by, in camelCase.
   *
   * Validated as a plain string here and checked against each endpoint's own
   * whitelist in `buildPaginationSqlFragment`, because the set of sortable
   * columns differs per resource.
   */
  @IsOptional()
  @IsString()
  sort?: string;

  /**
   * Sort direction. Defaults per endpoint — usually `desc`, so the newest rows
   * come first.
   */
  @IsOptional()
  @IsEnum(['asc', 'desc'], { message: 'order must be asc or desc' })
  order?: SortOrder;
}
