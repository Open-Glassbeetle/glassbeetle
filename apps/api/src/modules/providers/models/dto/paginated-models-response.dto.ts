import { ApiProperty } from '@nestjs/swagger';
import type { PaginatedResponse } from '../../../../common/pagination/paginated-response.dto.js';
import { ModelDto } from './model.dto.js';

/**
 * Paginated collection envelope for model resources.
 */
export class PaginatedModelsResponseDto implements PaginatedResponse<ModelDto> {
  @ApiProperty({
    type: [ModelDto],
    description: 'Items in the current page',
  })
  readonly items!: readonly ModelDto[];

  @ApiProperty({
    example: 42,
    description: 'Total number of items matching filters',
  })
  readonly total!: number;

  @ApiProperty({
    example: 50,
    description: 'Maximum number of items returned per page',
  })
  readonly limit!: number;

  @ApiProperty({
    example: 0,
    description: 'Offset of the first item returned',
  })
  readonly offset!: number;
}
