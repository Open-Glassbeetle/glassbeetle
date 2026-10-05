import { ApiProperty } from '@nestjs/swagger';

/**
 * Raw row shape for the `agent_memories` SQLite table.
 */
export interface AgentMemoryRow {
  readonly id: string;
  readonly agent_id: string;
  readonly content: string;
  readonly tags: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Public API representation of an agent memory resource.
 *
 * Follows Glassbeetle API conventions:
 * - Identifiers are UUIDv7 strings.
 * - Timestamps are ISO-8601 UTC strings.
 * - Snake_case columns (`agent_id`, `created_at`, `updated_at`) are mapped to camelCase.
 * - `tags` is always exposed as an array of strings (`string[]`), never a JSON string or null.
 */
export class AgentMemoryResponseDto {
  @ApiProperty({
    description: 'Unique memory identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  readonly id!: string;

  @ApiProperty({
    description: 'Identifier of the owning agent',
    example: '018f3a9e-0000-7000-8000-000000000002',
  })
  readonly agentId!: string;

  @ApiProperty({
    description: 'Memory content text (facts, preferences, or context)',
    example: 'Prefers TypeScript over Python for backend services.',
  })
  readonly content!: string;

  @ApiProperty({
    description: 'Array of classification or topic tags',
    example: ['project-x', 'preference'],
    type: [String],
  })
  readonly tags!: string[];

  @ApiProperty({
    description: 'Timestamp of memory creation in ISO-8601 UTC format',
    example: '2026-10-04T12:00:00.000Z',
  })
  readonly createdAt!: string;

  @ApiProperty({
    description: 'Timestamp of last memory update in ISO-8601 UTC format',
    example: '2026-10-04T12:00:00.000Z',
  })
  readonly updatedAt!: string;
}

export type AgentMemoryResponse = Readonly<AgentMemoryResponseDto>;
