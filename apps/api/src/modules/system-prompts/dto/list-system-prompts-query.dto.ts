import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';

/**
 * Query parameters for collection endpoint GET /api/v1/system-prompts.
 *
 * Inherits pagination and sorting parameters:
 * - `limit`: Maximum items per page (default: 50, max: 100)
 * - `offset`: Zero-based pagination offset (default: 0)
 * - `sort`: Field to sort by ('createdAt', 'name', 'id', 'updatedAt')
 * - `order`: Sort direction ('asc' or 'desc', default: 'desc')
 *
 * Optional filter parameters:
 * - `name`: Substring search matching prompt name.
 * - `search`: Alias for `name` substring search.
 */
export class ListSystemPromptsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
