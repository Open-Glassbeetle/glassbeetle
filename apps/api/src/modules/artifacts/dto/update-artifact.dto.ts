import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
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
  MAX_ARTIFACT_CONTENT_LENGTH,
  MAX_ARTIFACT_MIME_TYPE_LENGTH,
  MAX_ARTIFACT_TITLE_LENGTH,
  trimString,
} from './artifact-validators.js';
import { CreateArtifactDto } from './create-artifact.dto.js';

/**
 * Request payload for partially updating an artifact (PATCH).
 *
 * Partial update semantics:
 * - Omitted (`undefined`): Field is not modified.
 * - Explicit `null`: Nullable fields (`mimeType`, `projectId`, `chatId`, `agentId`)
 *   are cleared to `null`.
 * - `title` and `type` cannot be cleared or set to empty string.
 * - `content` and `filePath` updates must preserve the invariant that exactly one
 *   remains set on the resource. Clearing one while setting the other is valid;
 *   clearing both or setting both is rejected with 400 Bad Request.
 * - Server-managed fields (`id`, `version`, `createdAt`, `updatedAt`) are forbidden.
 */
export class UpdateArtifactDto extends PartialType(CreateArtifactDto) {
  @ApiPropertyOptional({
    type: String,
    description: 'Display title of the artifact (cannot be null or empty)',
    example: 'Architecture Diagram v2',
    maxLength: MAX_ARTIFACT_TITLE_LENGTH,
  })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(trimString)
  @IsString({ message: 'title must be a string' })
  @IsNotEmpty({ message: 'title must not be empty' })
  @MaxLength(MAX_ARTIFACT_TITLE_LENGTH, {
    message: `title must not exceed ${MAX_ARTIFACT_TITLE_LENGTH} characters`,
  })
  override title?: string;

  @ApiPropertyOptional({
    type: String,
    description: "Classification of artifact product ('document', 'code', 'file', 'structured')",
    example: 'document',
    enum: ALLOWED_ARTIFACT_TYPES,
  })
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(trimString)
  @IsString({ message: 'type must be a string' })
  @IsIn(ALLOWED_ARTIFACT_TYPES, {
    message: `type must be one of: ${ALLOWED_ARTIFACT_TYPES.join(', ')}`,
  })
  override type?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'MIME type describing artifact format (explicit null clears it)',
    example: 'text/markdown',
    maxLength: MAX_ARTIFACT_MIME_TYPE_LENGTH,
    nullable: true,
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Transform(trimString)
  @IsString({ message: 'mimeType must be a string' })
  @MaxLength(MAX_ARTIFACT_MIME_TYPE_LENGTH, {
    message: `mimeType must not exceed ${MAX_ARTIFACT_MIME_TYPE_LENGTH} characters`,
  })
  @IsOptional()
  override mimeType?: string | null;

  @ApiPropertyOptional({
    type: String,
    description:
      'Inline text content (explicit null clears it if filePath is set)',
    example: '# Updated Content',
    maxLength: MAX_ARTIFACT_CONTENT_LENGTH,
    nullable: true,
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsString({ message: 'content must be a string' })
  @MaxLength(MAX_ARTIFACT_CONTENT_LENGTH, {
    message: `content must not exceed ${MAX_ARTIFACT_CONTENT_LENGTH} characters`,
  })
  @IsOptional()
  override content?: string | null;

  @ApiPropertyOptional({
    type: String,
    description:
      'Local storage relative path (explicit null clears it if content is set)',
    example: 'artifacts/new-version.bin',
    nullable: true,
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Transform(trimString)
  @IsString({ message: 'filePath must be a string' })
  @IsOptional()
  override filePath?: string | null;

  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Transform(trimString)
  @IsString({ message: 'file_path must be a string' })
  @IsOptional()
  override file_path?: string | null;

  @ApiPropertyOptional({
    type: String,
    description: 'Project ID assignment (explicit null unassigns the project)',
    example: '018f3a9e-0000-7000-8000-000000000002',
    nullable: true,
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Transform(trimString)
  @IsString({ message: 'projectId must be a string' })
  @IsNotEmpty({ message: 'projectId must not be empty' })
  @IsOptional()
  override projectId?: string | null;

  @ApiPropertyOptional({
    type: String,
    description: 'Chat ID assignment (explicit null unassigns the chat)',
    example: '018f3a9e-0000-7000-8000-000000000003',
    nullable: true,
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Transform(trimString)
  @IsString({ message: 'chatId must be a string' })
  @IsNotEmpty({ message: 'chatId must not be empty' })
  @IsOptional()
  override chatId?: string | null;

  @ApiPropertyOptional({
    type: String,
    description: 'Agent ID assignment (explicit null unassigns the agent)',
    example: '018f3a9e-0000-7000-8000-000000000004',
    nullable: true,
  })
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Transform(trimString)
  @IsString({ message: 'agentId must be a string' })
  @IsNotEmpty({ message: 'agentId must not be empty' })
  @IsOptional()
  override agentId?: string | null;
}

