import { ApiProperty } from '@nestjs/swagger';

/**
 * Public API representation of a chat resource.
 *
 * Follows Glassbeetle API conventions:
 * - Identifiers are UUIDv7 strings.
 * - Timestamps are ISO-8601 UTC strings (`nowIso()`).
 * - Column names are mapped from SQLite `snake_case` to JSON `camelCase`.
 * - Nullable columns are emitted as `null`, never omitted.
 * - Every chat belongs to either an agent or a team (or neither if the owner was deleted).
 * - `contextSummary` is returned in responses, but read-only on CRUD writes.
 */
export class ChatResponseDto {
  @ApiProperty({
    description: 'Unique chat identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  readonly id!: string;

  @ApiProperty({
    type: String,
    description: 'Display title of the chat',
    example: 'Project Kickoff Discussion',
    nullable: true,
  })
  readonly title!: string | null;

  @ApiProperty({
    type: String,
    description: 'Unique identifier of the project this chat belongs to (or null if outside any project)',
    example: '018f3a9e-0000-7000-8000-000000000002',
    nullable: true,
  })
  readonly projectId!: string | null;

  @ApiProperty({
    type: String,
    description: 'Unique identifier of the owning agent (null if owned by a team or deleted)',
    example: '018f3a9e-0000-7000-8000-000000000003',
    nullable: true,
  })
  readonly agentId!: string | null;

  @ApiProperty({
    type: String,
    description: 'Unique identifier of the owning team (null if owned by an agent or deleted)',
    example: '018f3a9e-0000-7000-8000-000000000004',
    nullable: true,
  })
  readonly teamId!: string | null;

  @ApiProperty({
    type: String,
    description: 'Compacted conversation summary written by the compaction endpoint',
    example: 'Summary of earlier messages in the conversation...',
    nullable: true,
  })
  readonly contextSummary!: string | null;

  @ApiProperty({
    description: 'Timestamp of chat creation in ISO-8601 UTC format',
    example: '2026-10-15T08:00:00.000Z',
  })
  readonly createdAt!: string;

  @ApiProperty({
    description: 'Timestamp of last chat update in ISO-8601 UTC format',
    example: '2026-10-15T08:00:00.000Z',
  })
  readonly updatedAt!: string;
}

/** Readonly view of {@link ChatResponseDto} for callers that only consume one. */
export type ChatResponse = Readonly<ChatResponseDto>;
