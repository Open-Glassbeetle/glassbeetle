import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';

/**
 * Query parameters for collection endpoint `GET /api/v1/artifacts`.
 *
 * Inherits standard pagination and sorting parameters:
 * - `limit`: Maximum items per page (default: 50, max: 100)
 * - `offset`: Zero-based pagination offset (default: 0)
 * - `sort`: Field to sort by ('createdAt', 'updatedAt', 'title', 'type', 'version', 'id')
 * - `order`: Sort direction ('asc' or 'desc', default: 'desc')
 *
 * Supported filters:
 * - `projectId`: Filter by associated project ID. Pass `"null"` to filter for unfiled artifacts.
 * - `chatId`: Filter by originating chat ID. Pass `"null"` to filter for unfiled artifacts.
 * - `agentId`: Filter by producing agent ID. Pass `"null"` to filter for unassigned artifacts.
 * - `type`: Filter by classification type ('document', 'code', 'file', 'structured').
 * - `search` / `title`: Substring search matching artifact title.
 */
export class ListArtifactsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter by project ID. Pass "null" to filter for unfiled artifacts without an assigned project.',
    example: '018f3a9e-0000-7000-8000-000000000002',
  })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({
    description:
      'Filter by chat ID. Pass "null" to filter for artifacts without an originating chat.',
    example: '018f3a9e-0000-7000-8000-000000000003',
  })
  @IsOptional()
  @IsString()
  chatId?: string;

  @ApiPropertyOptional({
    description:
      'Filter by agent ID. Pass "null" to filter for artifacts without an assigned agent.',
    example: '018f3a9e-0000-7000-8000-000000000004',
  })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({
    description:
      "Filter by artifact classification type ('document', 'code', 'file', 'structured')",
    example: 'document',
  })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({
    description:
      'Substring search matching artifact title. Case-insensitive ASCII; `%` and `_` match literally.',
    example: 'architecture',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Alias for search substring matching artifact title.',
    example: 'architecture',
  })
  @IsOptional()
  @IsString()
  title?: string;
}

