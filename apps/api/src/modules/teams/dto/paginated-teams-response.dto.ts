import { ApiProperty } from '@nestjs/swagger';
import type { PaginatedResponse } from '../../../common/pagination/paginated-response.dto.js';
import { TeamResponseDto } from './team-response.dto.js';

/**
 * Paginated collection envelope for team resources.
 *
 * Restates the four envelope fields instead of extending
 * `PaginatedResponseDto`, because the generic `items` array needs a concrete
 * type for `@nestjs/swagger` to emit an item schema.
 */
export class PaginatedTeamsResponseDto implements PaginatedResponse<TeamResponseDto> {
  @ApiProperty({
    type: [TeamResponseDto],
    description: 'Items in the current page',
  })
  readonly items!: readonly TeamResponseDto[];

  @ApiProperty({
    example: 4,
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
