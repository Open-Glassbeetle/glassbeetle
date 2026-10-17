import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../../common/http/api-error.js';
import type { PaginatedResponse } from '../../../common/pagination/paginated-response.dto.js';
import { MessagesService } from './messages.service.js';
import {
  ListMessagesQueryDto,
  PaginatedMessagesResponseDto,
  type MessageResponseDto,
} from './dto/index.js';

/**
 * Controller for managing chat messages collection.
 * Mounted at `/api/v1/chats/:chatId/messages`.
 */
@ApiTags('chats')
@Controller('chats/:chatId/messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  @ApiOperation({
    summary: 'List chat messages',
    description:
      'Retrieves stored messages belonging to a chat in conversation order (sequence ascending by default). ' +
      'Supports sequence cursor pagination (before/after), offset pagination, order reversal (order=desc), ' +
      'and filtering by role, status, and agentId.',
  })
  @ApiParam({
    name: 'chatId',
    description: 'Unique chat identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  @ApiOkResponse({
    description:
      'The chat messages, ordered by sequence ascending by default (or empty array if no messages exist)',
    type: PaginatedMessagesResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid pagination, sorting, cursor, or filter parameters',
    type: ApiErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'No chat found with that ID',
    type: ApiErrorResponseDto,
  })
  async findAll(
    @Param('chatId') chatId: string,
    @Query() query: ListMessagesQueryDto,
  ): Promise<PaginatedResponse<MessageResponseDto>> {
    return this.messagesService.findAll(chatId, query);
  }
}
