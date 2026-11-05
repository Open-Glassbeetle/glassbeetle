import { ApiProperty } from '@nestjs/swagger';

/**
 * Public API representation of a project resource.
 *
 * Follows Glassbeetle API conventions:
 * - Identifiers are UUIDv7 strings.
 * - Timestamps are ISO-8601 UTC strings (`nowIso()`).
 * - Column names are mapped from SQLite `snake_case` to JSON `camelCase`.
 * - Nullable columns are emitted as `null`, never omitted.
 * - `image_path` is a local filesystem path and is never exposed verbatim;
 *   `hasImage: boolean` indicates whether a project image exists.
 * - `chatCount` and `artifactCount` indicate how many chats and artifacts belong
 *   to this project, backed by index scans on `idx_chats_project_id` and
 *   `idx_artifacts_project_id`.
 */
export class ProjectResponseDto {
  @ApiProperty({
    description: 'Unique project identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  readonly id!: string;

  @ApiProperty({
    description: 'Display name of the project',
    example: 'NextGen Compiler',
  })
  readonly name!: string;

  @ApiProperty({
    type: String,
    description: 'Detailed description of the project',
    example: 'Optimising compiler infrastructure for intermediate representation analysis.',
    nullable: true,
  })
  readonly description!: string | null;

  @ApiProperty({
    description: 'Whether the project has an associated image stored',
    example: false,
  })
  readonly hasImage!: boolean;

  @ApiProperty({
    type: 'integer',
    description: 'Number of chats associated with this project',
    example: 3,
  })
  readonly chatCount!: number;

  @ApiProperty({
    type: 'integer',
    description: 'Number of artifacts associated with this project',
    example: 5,
  })
  readonly artifactCount!: number;

  @ApiProperty({
    description: 'Timestamp of project creation in ISO-8601 UTC format',
    example: '2026-09-21T09:30:52.123Z',
  })
  readonly createdAt!: string;

  @ApiProperty({
    description: 'Timestamp of last project update in ISO-8601 UTC format',
    example: '2026-09-21T09:30:52.123Z',
  })
  readonly updatedAt!: string;
}

/**
 * Readonly view of {@link ProjectResponseDto} for callers that only consume one.
 */
export type ProjectResponse = Readonly<ProjectResponseDto>;

