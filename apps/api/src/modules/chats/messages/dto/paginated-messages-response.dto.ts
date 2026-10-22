import { ApiProperty } from '@nestjs/swagger';
import type { PaginatedResponse } from '../../../../common/pagination/paginated-response.dto.js';
import { MessageResponseDto } from './message-response.dto.js';

/**
 * Paginated collection envelope for chat message resources.
 *
 * Restates the four envelope fields instead of extending
 * `PaginatedResponseDto`, because the generic `items` array needs a concrete
 * type for `@nestjs/swagger` to emit an item schema.
 */
export class PaginatedMessagesResponseDto
  implements PaginatedResponse<MessageResponseDto>
{
  @ApiProperty({
    type: [MessageResponseDto],
    description: 'Messages in the current page',
  })
  readonly items!: readonly MessageResponseDto[];

  @ApiProperty({
    example: 42,
    description: 'Total number of messages matching filters',
  })
  readonly total!: number;

  @ApiProperty({
    example: 50,
    description: 'Maximum number of messages returned per page',
  })
  readonly limit!: number;

  @ApiProperty({
    example: 0,
    description: 'Offset of the first message returned',
  })
  readonly offset!: number;
}
