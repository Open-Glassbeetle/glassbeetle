import { ApiProperty } from '@nestjs/swagger';

/**
 * Public API representation of an agent resource.
 *
 * Follows Glassbeetle API conventions:
 * - Identifiers are UUIDv7 strings.
 * - Timestamps are ISO-8601 UTC strings (`nowIso()`).
 * - Column names are mapped from SQLite `snake_case` to JSON `camelCase`.
 * - Nullable columns are emitted as `null`, never omitted.
 * - `picture_path` is never exposed directly; `hasPicture` indicates whether
 *   a profile picture has been uploaded.
 * - Foreign keys are exposed as IDs (`modelId`, `systemPromptId`) to avoid N+1 queries.
 */
export class AgentResponseDto {
  @ApiProperty({
    description: 'Unique agent identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  readonly id!: string;

  @ApiProperty({
    description: 'Display name of the agent',
    example: 'Research Assistant',
  })
  readonly name!: string;

  @ApiProperty({
    type: String,
    description: 'Free-text character description and behavioral demeanor',
    example: 'Friendly, inquisitive, and methodical researcher.',
    nullable: true,
  })
  readonly personality!: string | null;

  @ApiProperty({
    type: String,
    description:
      'Agent-specific instructions, appended to the base system prompt',
    example: 'Always provide citations and references in IEEE format.',
    nullable: true,
  })
  readonly instructions!: string | null;

  @ApiProperty({
    type: String,
    description:
      'Identifier of the linked system prompt template (or null if unlinked)',
    example: '018f3a9e-0000-7000-8000-000000000002',
    nullable: true,
  })
  readonly systemPromptId!: string | null;

  @ApiProperty({
    type: String,
    description: 'Identifier of the linked model (or null if unlinked)',
    example: '018f3a9e-0000-7000-8000-000000000003',
    nullable: true,
  })
  readonly modelId!: string | null;

  @ApiProperty({
    type: Number,
    description: 'Sampling temperature for completions (typically 0.0 to 2.0)',
    example: 0.7,
    nullable: true,
  })
  readonly temperature!: number | null;

  @ApiProperty({
    type: 'integer',
    description: 'Maximum number of tokens to generate in a completion',
    example: 4096,
    nullable: true,
  })
  readonly maxTokens!: number | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Arbitrary provider-specific additional parameters as a key-value object',
    example: { top_p: 0.9, frequency_penalty: 0.5 },
    nullable: true,
  })
  readonly modelParams!: Record<string, unknown> | null;

  @ApiProperty({
    description: 'Whether the agent has a custom profile picture stored',
    example: false,
  })
  readonly hasPicture!: boolean;

  @ApiProperty({
    description: 'Timestamp of agent creation in ISO-8601 UTC format',
    example: '2026-10-04T12:00:00.000Z',
  })
  readonly createdAt!: string;

  @ApiProperty({
    description: 'Timestamp of last agent update in ISO-8601 UTC format',
    example: '2026-10-04T12:00:00.000Z',
  })
  readonly updatedAt!: string;
}

/**
 * Interface representation of an agent resource.
 */
export type AgentResponse = Readonly<AgentResponseDto>;
