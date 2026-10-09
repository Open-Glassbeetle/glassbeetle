import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';

/**
 * Query parameters for `GET /api/v1/teams`.
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
