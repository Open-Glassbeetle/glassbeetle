import { ApiProperty } from '@nestjs/swagger';

/**
 * Raw row shape for the `shared_memories` SQLite table.
 */
export interface SharedMemoryRow {
  readonly id: string;
  readonly content: string;
  readonly tags: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Public API representation of a shared memory resource.
 *
 * Follows Glassbeetle API conventions:
 * - Identifiers are UUIDv7 strings.
 * - Timestamps are ISO-8601 UTC strings.
 * - Snake_case columns (`created_at`, `updated_at`) are mapped to camelCase.
 * - `tags` is always exposed as an array of strings (`string[]`), never a JSON string or null.
 * - No agent scoping columns; shared memory is global.
 */
export class SharedMemoryResponseDto {
  @ApiProperty({
    description: 'Unique memory identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  readonly id!: string;

  @ApiProperty({
    description:
      'Memory content text (global facts, preferences, or conventions)',
    example: 'Always format code using Prettier and Oxlint.',
  })
  readonly content!: string;

  @ApiProperty({
    description: 'Array of classification or topic tags',
    example: ['conventions', 'style'],
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

export type SharedMemoryResponse = Readonly<SharedMemoryResponseDto>;
