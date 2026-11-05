import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Public API representation of an artifact resource.
 *
 * Artifacts represent work products produced by agents or supplied by users:
 * documents, code, files, or structured data. They link back to their originating
 * project, chat, and agent, and survive deletion of any or all of those parents.
 *
 * Security & representation rules:
 * - `file_path` is never exposed verbatim; `hasFile: boolean` signals whether a stored
 *   binary/large backing file exists.
 * - Inline `content` is included on item retrieval (`GET /artifacts/:artifactId`),
 *   creation, and update responses, but omitted from collection list items
 *   (`GET /artifacts`) to avoid transferring bulky text payloads over list views.
 * - Timestamps are ISO-8601 UTC strings.
 * - `version` is an integer revision counter (defaults to 1, auto-increments on changes).
 */
export class ArtifactResponseDto {
  @ApiProperty({
    description: 'Unique artifact identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  readonly id!: string;

  @ApiProperty({
    type: String,
    description: 'Identifier of the associated project (null if unfiled)',
    example: '018f3a9e-0000-7000-8000-000000000002',
    nullable: true,
  })
  readonly projectId!: string | null;

  @ApiProperty({
    type: String,
    description: 'Identifier of the originating chat session (null if unfiled)',
    example: '018f3a9e-0000-7000-8000-000000000003',
    nullable: true,
  })
  readonly chatId!: string | null;

  @ApiProperty({
    type: String,
    description: 'Identifier of the agent that produced the artifact (null if unassigned)',
    example: '018f3a9e-0000-7000-8000-000000000004',
    nullable: true,
  })
  readonly agentId!: string | null;

  @ApiProperty({
    description: 'Display title of the artifact',
    example: 'Architecture Diagram & Specification',
  })
  readonly title!: string;

  @ApiProperty({
    description: "Classification type ('document', 'code', 'file', 'structured')",
    example: 'document',
  })
  readonly type!: string;

  @ApiProperty({
    type: String,
    description: 'MIME type of the artifact format',
    example: 'text/markdown',
    nullable: true,
  })
  readonly mimeType!: string | null;

  @ApiPropertyOptional({
    type: String,
    description:
      'Inline text content for small text artifacts. Present on single item retrieval, creation, and update; omitted from collection list items.',
    example: '# Architecture Overview\n...',
    nullable: true,
  })
  readonly content?: string | null;

  @ApiProperty({
    description: 'Whether this artifact is backed by a stored binary/large file',
    example: false,
  })
  readonly hasFile!: boolean;

  @ApiProperty({
    type: 'integer',
    description: 'Monotonically increasing version counter for the artifact',
    example: 1,
  })
  readonly version!: number;

  @ApiProperty({
    description: 'Timestamp of artifact creation in ISO-8601 UTC format',
    example: '2026-09-21T09:30:52.123Z',
  })
  readonly createdAt!: string;

  @ApiProperty({
    description: 'Timestamp of last artifact update in ISO-8601 UTC format',
    example: '2026-09-21T09:30:52.123Z',
  })
  readonly updatedAt!: string;
}

/**
 * Readonly view of {@link ArtifactResponseDto}.
 */
export type ArtifactResponse = Readonly<ArtifactResponseDto>;

