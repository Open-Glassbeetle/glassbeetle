import { ApiProperty } from '@nestjs/swagger';
import type { PaginatedResponse } from '../../../common/pagination/paginated-response.dto.js';
import { AgentResponseDto } from './agent-response.dto.js';

/**
 * Paginated collection envelope for agent resources.
 */
export class PaginatedAgentsResponseDto implements PaginatedResponse<AgentResponseDto> {
  @ApiProperty({
    type: [AgentResponseDto],
    description: 'Items in the current page',
  })
  readonly items!: readonly AgentResponseDto[];

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
