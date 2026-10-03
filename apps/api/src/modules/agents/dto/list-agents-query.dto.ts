import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';

/**
 * Query parameters for collection endpoint GET /api/v1/agents.
 *
 * Inherits pagination and sorting parameters:
 * - `limit`: Maximum items per page (default: 50, max: 100)
 * - `offset`: Zero-based pagination offset (default: 0)
 * - `sort`: Field to sort by ('createdAt', 'name', 'id', 'updatedAt')
 * - `order`: Sort direction ('asc' or 'desc', default: 'desc')
 *
 * Supported filters:
 * - `modelId`: Filter by model ID. Pass `"null"` to filter for agents without an assigned model.
 * - `systemPromptId`: Filter by template ID. Pass `"null"` to filter for agents without an assigned template.
 * - `name`: Case-insensitive substring search matching agent name.
 * - `search`: Alias for `name` substring search.
 */
export class ListAgentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter by model ID. Pass "null" to filter for agents without an assigned model.',
    example: '018f3a9e-0000-7000-8000-000000000002',
  })
  @IsOptional()
  @IsString()
  modelId?: string;

  @ApiPropertyOptional({
    description:
      'Filter by system prompt template ID. Pass "null" to filter for agents without an assigned template.',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @IsOptional()
  @IsString()
  systemPromptId?: string;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring search matching agent name',
    example: 'researcher',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: 'Alias for name substring search',
    example: 'researcher',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
