import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';

/**
 * Query parameters for `GET /api/v1/teams`.
 *
 * Adds a name filter to the inherited pagination and sorting parameters. The
 * sortable keys are `createdAt`, `updatedAt`, `name` and `id`; see
 * `ALLOWED_TEAM_SORT_COLUMNS`.
 */
export class ListTeamsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  name?: string;

  /** Alias for `name`, so the command palette and the list share one parameter. */
  @IsOptional()
  @IsString()
  search?: string;
}
