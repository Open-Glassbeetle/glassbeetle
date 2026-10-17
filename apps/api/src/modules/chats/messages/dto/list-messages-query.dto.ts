import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../../common/pagination/pagination-query.dto.js';
import {
  MESSAGE_ROLES,
  MESSAGE_STATUSES,
  type MessageRole,
  type MessageStatus,
} from './message-response.dto.js';

/**
 * Query parameters for collection endpoint GET /api/v1/chats/:chatId/messages.
 *
 * Inherits pagination and sorting parameters:
 * - `limit`: Maximum items per page (default: 50, max: 100)
 * - `offset`: Zero-based pagination offset (default: 0)
 * - `sort`: Field to sort by ('sequence', default: 'sequence')
 * - `order`: Sort direction ('asc' or 'desc', default: 'asc')
 *
 * Sequence cursor parameters:
 * - `before`: Return messages with sequence < before (for fetching earlier messages)
 * - `after`: Return messages with sequence > after (for fetching later messages)
 *
 * Supported filters:
 * - `role`: Filter by sender role ('user', 'assistant', 'system', 'tool')
 * - `status`: Filter by generation status ('pending', 'streaming', 'complete', 'error')
 * - `agentId`: Filter by producing agent ID. Pass "null" to filter for messages without an assigned agent.
 */
export class ListMessagesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter messages by sender role',
    enum: MESSAGE_ROLES,
    example: 'user',
  })
  @IsOptional()
  @IsIn(MESSAGE_ROLES, {
    message: 'role must be one of user, assistant, system, tool',
  })
  role?: MessageRole;

  @ApiPropertyOptional({
    description: 'Filter messages by generation status',
    enum: MESSAGE_STATUSES,
    example: 'complete',
  })
  @IsOptional()
  @IsIn(MESSAGE_STATUSES, {
    message: 'status must be one of pending, streaming, complete, error',
  })
  status?: MessageStatus;

  @ApiPropertyOptional({
    description:
      'Filter messages by producing agent ID. Pass "null" to filter for messages without an assigned agent.',
    example: '018f3a9e-0000-7000-8000-000000000003',
  })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({
    description:
      'Cursor: return messages with sequence strictly less than this value (earlier messages)',
    example: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'before must be an integer' })
  @Min(1, { message: 'before must be at least 1' })
  before?: number;

  @ApiPropertyOptional({
    description:
      'Cursor: return messages with sequence strictly greater than this value (later messages)',
    example: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'after must be an integer' })
  @Min(0, { message: 'after must be at least 0' })
  after?: number;
}
