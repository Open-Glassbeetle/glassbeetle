import { ApiProperty } from '@nestjs/swagger';
import { fromDbBoolean } from '../../../../common/persistence/index.js';

/**
 * Valid values for the `models.source` discriminator column.
 */
export type ModelSource = 'discovered' | 'manual';

/**
 * Public DTO representing an AI model.
 *
 * Mapped from the `models` SQLite table.
 */
export class ModelDto {
  @ApiProperty({
    description: 'Server-generated model identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  id!: string;

  @ApiProperty({
    description: 'Parent provider identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000002',
  })
  providerId!: string;

  @ApiProperty({
    description:
      'Exact model identifier string for provider API calls (e.g. claude-sonnet-5, qwen2.5:14b)',
    example: 'claude-sonnet-5',
  })
  modelIdentifier!: string;

  @ApiProperty({
    description: 'Human-facing display name',
    example: 'Claude Sonnet 3.5',
  })
  displayName!: string;

  @ApiProperty({
    description:
      'Origin of the model: automatically discovered or manually registered',
    enum: ['discovered', 'manual'],
    example: 'manual',
  })
  source!: ModelSource;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Maximum context window size in tokens, or null if unspecified',
    example: 200000,
  })
  contextWindow!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Default sampling temperature, or null if unspecified',
    example: 0.7,
  })
  defaultTemperature!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Default maximum completion tokens, or null if unspecified',
    example: 8192,
  })
  defaultMaxTokens!: number | null;

  @ApiProperty({
    description: 'Whether this model is active and selectable by agents',
    example: true,
  })
  enabled!: boolean;

  @ApiProperty({
    description: 'Creation timestamp in ISO-8601 UTC format',
    example: '2026-10-24T12:00:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    description: 'Last update timestamp in ISO-8601 UTC format',
    example: '2026-10-24T12:00:00.000Z',
  })
  updatedAt!: string;
}

/**
 * Raw row shape returned by SQLite for the models table.
 */
export interface ModelRow {
  id: string;
  provider_id: string;
  model_identifier: string;
  display_name: string;
  source: string;
  context_window: number | null;
  default_temperature: number | null;
  default_max_tokens: number | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

/**
 * Maps a SQLite `ModelRow` to the public `ModelDto`.
 */
export function mapModelRow(row: ModelRow): ModelDto {
  return {
    id: row.id,
    providerId: row.provider_id,
    modelIdentifier: row.model_identifier,
    displayName: row.display_name,
    source: row.source as ModelSource,
    contextWindow: row.context_window ?? null,
    defaultTemperature: row.default_temperature ?? null,
    defaultMaxTokens: row.default_max_tokens ?? null,
    enabled: fromDbBoolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
