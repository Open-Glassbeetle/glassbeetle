import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';

/**
 * Query parameters for `GET /api/v1/projects`.
 *
 * Adds an optional name substring filter to the inherited pagination and sorting
 * parameters. Allowed sort keys are `createdAt`, `updatedAt`, `name` and `id`;
 * see `ALLOWED_PROJECT_SORT_COLUMNS`.
 */
export class ListProjectsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  name?: string;

  /** Alias for `name`, so command palettes and filter bars share one parameter. */
  @IsOptional()
  @IsString()
  search?: string;
}

