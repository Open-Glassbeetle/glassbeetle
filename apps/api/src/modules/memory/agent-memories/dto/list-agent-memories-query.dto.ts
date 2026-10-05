import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../../common/pagination/pagination-query.dto.js';

/**
 * Query parameters for collection endpoint GET /api/v1/agents/:agentId/memories.
 *
 * Inherits pagination and sorting parameters:
 * - `limit`: Maximum items per page (default: 50, max: 100)
 * - `offset`: Zero-based pagination offset (default: 0)
 * - `sort` / `sortBy`: Field to sort by ('createdAt', 'updatedAt', 'id', 'content')
 * - `order`: Sort direction ('asc' or 'desc', default: 'desc')
 *
 * Optional filter parameters:
 * - `tag`: Filter memories that include this specific tag.
 * - `content`: Substring search matching memory content.
 * - `search`: Alias for `content` substring search.
 */
export class ListAgentMemoriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Field to sort by (alias for sort parameter)',
    example: 'createdAt',
  })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({
    description: 'Filter memories that contain this exact tag',
    example: 'preference',
  })
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring search matching memory content',
    example: 'TypeScript',
  })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({
    description: 'Alias for content substring search',
    example: 'TypeScript',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
