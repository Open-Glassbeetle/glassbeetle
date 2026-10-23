import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';

/**
 * Query parameters for collection endpoint GET /api/v1/chats.
 *
 * Inherits pagination and sorting parameters:
 * - `limit`: Maximum items per page (default: 50, max: 100)
 * - `offset`: Zero-based pagination offset (default: 0)
 * - `sort`: Field to sort by ('createdAt', 'updatedAt', 'title', 'id')
 * - `order`: Sort direction ('asc' or 'desc', default: 'desc')
 *
 * Supported filters:
 * - `projectId`: Filter by project ID. Pass `"null"` to filter for chats without an assigned project.
 * - `agentId`: Filter by owning agent ID.
 * - `teamId`: Filter by owning team ID.
 * - `search`: Substring search matching chat title.
 */
export class ListChatsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter by project ID. Pass "null" to filter for chats without an assigned project.',
    example: '018f3a9e-0000-7000-8000-000000000002',
  })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({
    description: 'Filter by owning agent ID',
    example: '018f3a9e-0000-7000-8000-000000000003',
  })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({
    description: 'Filter by owning team ID',
    example: '018f3a9e-0000-7000-8000-000000000004',
  })
  @IsOptional()
  @IsString()
  teamId?: string;

  @ApiPropertyOptional({
    description:
      'Substring search matching chat title. Case-insensitive for ASCII letters only, like the other list endpoints; `%` and `_` match literally.',
    example: 'release plan',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
