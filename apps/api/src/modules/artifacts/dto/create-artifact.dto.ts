import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  ALLOWED_ARTIFACT_TYPES,
  ContentOrFilePathXor,
  DisallowField,
  MAX_ARTIFACT_MIME_TYPE_LENGTH,
  MAX_ARTIFACT_TITLE_LENGTH,
  trimString,
} from './artifact-validators.js';

/**
 * Request payload for creating an artifact.
 *
 * Requirements:
 * - `title` is required (non-empty string up to 200 characters).
 * - `type` is required and must be one of: 'document', 'code', 'file', 'structured'.
 * - Exactly one of `content` (inline text) or `filePath` (stored file) must be provided.
 *   Supplying both or neither is rejected with 400 Bad Request.
 * - `projectId`, `chatId`, and `agentId` are optional references. When provided,
 *   they must point to existing entities or a 422 Unprocessable Entity is returned.
 * - Server-managed fields (`id`, `version`, `createdAt`, `updatedAt`) and internal
 *   flags (`hasFile`) are rejected if supplied by the client.
 */
export class CreateArtifactDto {
  @ApiProperty({
    description: 'Display title of the artifact',
    example: 'Architecture Diagram & Specification',
    maxLength: MAX_ARTIFACT_TITLE_LENGTH,
  })
  @Transform(trimString)
  @IsString({ message: 'title must be a string' })
  @IsNotEmpty({ message: 'title must not be empty' })
  @MaxLength(MAX_ARTIFACT_TITLE_LENGTH, {
    message: `title must not exceed ${MAX_ARTIFACT_TITLE_LENGTH} characters`,
  })
  title!: string;

  @ApiProperty({
    description: "Classification of artifact product ('document', 'code', 'file', 'structured')",
    example: 'document',
    enum: ALLOWED_ARTIFACT_TYPES,
  })
  @Transform(trimString)
  @IsString({ message: 'type must be a string' })
  @IsIn(ALLOWED_ARTIFACT_TYPES, {
    message: `type must be one of: ${ALLOWED_ARTIFACT_TYPES.join(', ')}`,
  })
  type!: string;

  @ApiPropertyOptional({
    type: String,
    description: 'MIME type describing artifact format (e.g. text/markdown, application/json)',
    example: 'text/markdown',
    maxLength: MAX_ARTIFACT_MIME_TYPE_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Transform(trimString)
  @IsString({ message: 'mimeType must be a string' })
  @MaxLength(MAX_ARTIFACT_MIME_TYPE_LENGTH, {
    message: `mimeType must not exceed ${MAX_ARTIFACT_MIME_TYPE_LENGTH} characters`,
  })
  mimeType?: string | null;

  @ApiPropertyOptional({
    type: String,
    description:
      'Inline text content for small/text artifacts (mutually exclusive with filePath)',
    example: '# Technical Specifications\n\nSystem overview...',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString({ message: 'content must be a string' })
  content?: string | null;

  @ApiPropertyOptional({
    type: String,
    description:
      'Local storage relative path for large/binary artifacts (mutually exclusive with content)',
    example: 'artifacts/018f3a9e-0000-7000-8000-000000000001.bin',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Transform(trimString)
  @IsString({ message: 'filePath must be a string' })
  filePath?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Transform(trimString)
  @IsString({ message: 'file_path must be a string' })
  file_path?: string | null;

  @ApiPropertyOptional({
    type: String,
    description: 'Identifier of the project this artifact belongs to (or null if unassigned)',
    example: '018f3a9e-0000-7000-8000-000000000002',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Transform(trimString)
  @IsString({ message: 'projectId must be a string' })
  @IsNotEmpty({ message: 'projectId must not be empty' })
  projectId?: string | null;

  @ApiPropertyOptional({
    type: String,
    description:
      'Identifier of the chat session this artifact was created in (or null if unassigned)',
    example: '018f3a9e-0000-7000-8000-000000000003',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Transform(trimString)
  @IsString({ message: 'chatId must be a string' })
  @IsNotEmpty({ message: 'chatId must not be empty' })
  chatId?: string | null;

  @ApiPropertyOptional({
    type: String,
    description:
      'Identifier of the agent that produced this artifact (or null if unassigned)',
    example: '018f3a9e-0000-7000-8000-000000000004',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Transform(trimString)
  @IsString({ message: 'agentId must be a string' })
  @IsNotEmpty({ message: 'agentId must not be empty' })
  agentId?: string | null;

  @ContentOrFilePathXor()
  protected readonly _contentXorFilePathRule?: unknown;

  @DisallowField('id is server-managed and cannot be supplied by the client')
  id?: unknown;

  @DisallowField('version is server-managed and cannot be supplied by the client')
  version?: unknown;

  @DisallowField('hasFile is a computed property and cannot be supplied by the client')
  hasFile?: unknown;

  @DisallowField('createdAt is server-managed and cannot be supplied by the client')
  createdAt?: unknown;

  @DisallowField('created_at is server-managed and cannot be supplied by the client')
  created_at?: unknown;

  @DisallowField('updatedAt is server-managed and cannot be supplied by the client')
  updatedAt?: unknown;

  @DisallowField('updated_at is server-managed and cannot be supplied by the client')
  updated_at?: unknown;
}

