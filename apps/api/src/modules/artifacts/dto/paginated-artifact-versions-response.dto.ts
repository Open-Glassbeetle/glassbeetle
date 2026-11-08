import { ApiProperty } from '@nestjs/swagger';
import type { PaginatedResponse } from '../../../common/pagination/paginated-response.dto.js';
import { ArtifactVersionResponseDto } from './artifact-version-response.dto.js';

/**
 * Paginated collection envelope for artifact version history.
 *
 * Implements `PaginatedResponse<ArtifactVersionResponseDto>` with Swagger annotations.
 */
export class PaginatedArtifactVersionsResponseDto implements PaginatedResponse<ArtifactVersionResponseDto> {
  @ApiProperty({
    type: [ArtifactVersionResponseDto],
    description: 'Version items in the current page',
  })
  readonly items!: readonly ArtifactVersionResponseDto[];

  @ApiProperty({
    example: 5,
    description: 'Total number of versions for this artifact',
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
