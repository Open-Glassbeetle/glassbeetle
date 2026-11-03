import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChatResponseDto } from '../../dto/chat-response.dto.js';

/**
 * Response returned by the conversation compaction endpoint (`POST /api/v1/chats/:chatId/compact`).
 *
 * Emits the updated chat representation, including the generated `contextSummary`,
 * along with metrics on which messages were compacted.
 */
export class CompactChatResponseDto extends ChatResponseDto {
  @ApiProperty({
    type: 'integer',
    description:
      'Total number of messages from conversation history currently covered by the summary',
    example: 8,
  })
  readonly compactedMessagesCount!: number;

  @ApiPropertyOptional({
    type: 'integer',
    description:
      'Sequence boundary for context construction: messages with sequence < compactedBeforeSequence ' +
      'are represented by the context summary and pruned from active turns.',
    example: 9,
    nullable: true,
  })
  readonly compactedBeforeSequence!: number | null;
}
