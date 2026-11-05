import { ApiProperty } from '@nestjs/swagger';
import type { PaginatedResponse } from '../../../common/pagination/paginated-response.dto.js';
import { ArtifactResponseDto } from './artifact-response.dto.js';

/**
 * Paginated collection envelope for artifact resources.
 *
 * Implements `PaginatedResponse<ArtifactResponseDto>` with Swagger annotations.
 */
export class PaginatedArtifactsResponseDto
  implements PaginatedResponse<ArtifactResponseDto>
{
  @ApiProperty({
    type: [ArtifactResponseDto],
    description: 'Items in the current page',
  })
  readonly items!: readonly ArtifactResponseDto[];

  @ApiProperty({
    example: 12,
    description: 'Total number of items matching filters',
  })
  readonly total!: number;

  @ApiProperty({
    example: 50,
    description: 'Maximum number of items returned per page',
  })
  readonly limit!: number;

  @ApiProperty({ example: 0, description: 'Offset of the first item returned' })
  readonly offset!: number;
}

