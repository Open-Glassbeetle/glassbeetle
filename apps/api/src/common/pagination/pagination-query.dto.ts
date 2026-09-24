import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

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
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(100, { message: 'limit must not exceed 100' })
  limit: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'offset must be an integer' })
  @Min(0, { message: 'offset must be at least 0' })
  offset: number = 0;

  @IsOptional()
  @IsString()
  sort?: string;

  @IsOptional()
  @IsEnum(['asc', 'desc'], { message: 'order must be asc or desc' })
  order?: SortOrder;
}
