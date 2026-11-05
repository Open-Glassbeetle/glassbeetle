import { ApiProperty } from '@nestjs/swagger';
import type { PaginatedResponse } from '../../../common/pagination/paginated-response.dto.js';
import { ProjectResponseDto } from './project-response.dto.js';

/**
 * Paginated collection envelope for project resources.
 *
 * Restates the four envelope fields instead of extending
 * `PaginatedResponseDto`, because the generic `items` array needs a concrete
 * type for `@nestjs/swagger` to emit an item schema.
 */
export class PaginatedProjectsResponseDto
  implements PaginatedResponse<ProjectResponseDto>
{
  @ApiProperty({
    type: [ProjectResponseDto],
    description: 'Items in the current page',
  })
  readonly items!: readonly ProjectResponseDto[];

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

