import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Public API representation of a historical artifact version.
 *
 * Each version snapshot captures an artifact's state before an update or upload,
 * providing an immutable audit trail and allowing clients to inspect previous
 * drafts or roll forward to restore earlier work products.
 *
 * Representation rules:
 * - `file_path` is never exposed verbatim; `hasFile: boolean` signals whether a stored
 *   binary or large backing file exists for this version.
 * - Inline `content` is present on single version retrieval
 *   (`GET /artifacts/:artifactId/versions/:version`), but omitted from collection list
 *   items (`GET /artifacts/:artifactId/versions`) to keep pagination payloads lightweight.
 * - `version` is an integer revision number (1, 2, ...).
 * - `createdAt` is an ISO-8601 UTC timestamp recording when this version was created.
 */
export class ArtifactVersionResponseDto {
  @ApiProperty({
    description: 'Unique version record identifier (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000001',
  })
  readonly id!: string;

  @ApiProperty({
    description: 'Identifier of the parent artifact (UUIDv7)',
    example: '018f3a9e-0000-7000-8000-000000000002',
  })
  readonly artifactId!: string;

  @ApiProperty({
    type: 'integer',
    description: 'Historical version number',
    example: 1,
  })
  readonly version!: number;

  @ApiProperty({
    description: 'Display title of the artifact at this version',
    example: 'Architecture Diagram & Specification',
  })
  readonly title!: string;

  @ApiProperty({
    description:
      "Classification type ('document', 'code', 'file', 'structured')",
    example: 'document',
  })
  readonly type!: string;

  @ApiProperty({
    type: String,
    description: 'MIME type of the artifact format at this version',
    example: 'text/markdown',
    nullable: true,
  })
  readonly mimeType!: string | null;

  @ApiPropertyOptional({
    type: String,
    description:
      'Inline text content at this version. Present on single version retrieval; omitted from collection list items.',
    example: '# Architecture Overview\n...',
    nullable: true,
  })
  readonly content?: string | null;

  @ApiProperty({
    description: 'Whether this version is backed by a stored binary/large file',
    example: false,
  })
  readonly hasFile!: boolean;

  @ApiProperty({
    description:
      'Timestamp when this version was snapshotted in ISO-8601 UTC format',
    example: '2026-09-21T09:30:52.123Z',
  })
  readonly createdAt!: string;
}
