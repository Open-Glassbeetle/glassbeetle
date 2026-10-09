import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../../common/pagination/pagination-query.dto.js';
import type { TagFilterMode } from '../../tags/index.js';

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
 * - `tags`: Filter memories that include multiple comma-separated tags.
 * - `tagMode`: Multi-tag matching mode: 'all' (default, intersection) or 'any' (union).
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
    description: 'Filter memories that contain this tag (case-insensitive)',
    example: 'preference',
  })
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional({
    description:
      'Filter memories matching comma-separated tags (case-insensitive)',
    example: 'preference,language',
  })
  @IsOptional()
  @IsString()
  tags?: string;

  @ApiPropertyOptional({
    description:
      'Matching mode when filtering by tags: "all" requires all tags, "any" matches at least one. Default is "all".',
    enum: ['all', 'any'],
    example: 'all',
  })
  @IsOptional()
  @IsIn(['all', 'any'], { message: 'tagMode must be either "all" or "any"' })
  tagMode?: TagFilterMode;

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
