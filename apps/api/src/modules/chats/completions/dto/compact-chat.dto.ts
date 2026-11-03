import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

/**
 * Optional payload for conversation compaction (`POST /api/v1/chats/:chatId/compact`).
 *
 * Compaction condenses prior conversation turns into `chats.context_summary`
 * so the conversation can proceed indefinitely without exceeding model context limits.
 *
 * Retention policy:
 * All summarised messages are retained in the database in plain text, remaining readable
 * in full history views. Compaction is an in-context window optimisation rather than
 * a data-deletion retention policy.
 */
export class CompactChatDto {
  @ApiPropertyOptional({
    type: String,
    description:
      'Optional override for the model to invoke for summarisation (UUIDv7 model identifier). ' +
      'Defaults to the model configured on the chat assigned agent.',
    example: '018f3a9e-0000-7000-8000-000000000002',
  })
  @IsOptional()
  @IsString({ message: 'modelId must be a string' })
  @IsNotEmpty({ message: 'modelId must not be empty' })
  modelId?: string;

  @ApiPropertyOptional({
    type: 'integer',
    description:
      'Number of most recent messages to preserve uncompacted in history. ' +
      'Preserving recent turns maintains the immediate conversational thread verbatim. ' +
      'Defaults to 2.',
    example: 2,
    minimum: 0,
    default: 2,
  })
  @IsOptional()
  @IsInt({ message: 'preserveRecentCount must be an integer' })
  @Min(0, { message: 'preserveRecentCount must be at least 0' })
  preserveRecentCount?: number;
}
