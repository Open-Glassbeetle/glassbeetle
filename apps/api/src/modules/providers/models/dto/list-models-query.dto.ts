import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { TransformBoolean } from '../../../../common/pagination/boolean-query.decorator.js';
import { PaginationQueryDto } from '../../../../common/pagination/pagination-query.dto.js';
import { MODEL_SOURCES } from './list-provider-models-query.dto.js';
import type { ModelSource } from './model.dto.js';

/**
 * Query parameters for `GET /api/v1/models`.
 *
 * Extends standard pagination and sorting with filters for `providerId`,
 * `enabled`, and `source`.
 */
export class ListModelsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter models by provider ID (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @IsOptional()
  @IsString({ message: 'providerId must be a string' })
  providerId?: string;

  @ApiPropertyOptional({
    description:
      'Filter models by enabled status (?enabled=true or ?enabled=false)',
    example: true,
  })
  @IsOptional()
  @TransformBoolean()
  @IsBoolean({ message: 'enabled must be a boolean' })
  enabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Filter models by source (?source=manual or ?source=discovered)',
    enum: MODEL_SOURCES,
    example: 'manual',
  })
  @IsOptional()
  @IsEnum(MODEL_SOURCES, {
    message: 'source must be one of: discovered, manual',
  })
  source?: ModelSource;
}
