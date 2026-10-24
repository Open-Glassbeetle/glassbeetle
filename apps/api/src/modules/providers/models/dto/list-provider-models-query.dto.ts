import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { TransformBoolean } from '../../../../common/pagination/boolean-query.decorator.js';
import { PaginationQueryDto } from '../../../../common/pagination/pagination-query.dto.js';
import type { ModelSource } from './model.dto.js';

export const MODEL_SOURCES = ['discovered', 'manual'] as const;

/**
 * Query parameters for `GET /api/v1/providers/:providerId/models`.
 *
 * Extends the standard pagination query with filters for `enabled` and `source`.
 */
export class ListProviderModelsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter models by enabled status (?enabled=true or ?enabled=false)',
    example: true,
  })
  @IsOptional()
  @TransformBoolean()
  @IsBoolean({ message: 'enabled must be a boolean' })
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Filter models by source (?source=manual or ?source=discovered)',
    enum: MODEL_SOURCES,
    example: 'manual',
  })
  @IsOptional()
  @IsEnum(MODEL_SOURCES, {
    message: 'source must be one of: discovered, manual',
  })
  source?: ModelSource;
}
