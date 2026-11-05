import { BadRequestException } from '@nestjs/common';
import { newId } from '../../../common/persistence/identifiers.js';
import { nowIso } from '../../../common/persistence/timestamps.js';
import {
  BOTH_CONTENT_AND_FILE_ERROR_MESSAGE,
  NEITHER_CONTENT_NOR_FILE_ERROR_MESSAGE,
} from './artifact-validators.js';
import type { ArtifactResponseDto } from './artifact-response.dto.js';
import type { CreateArtifactDto } from './create-artifact.dto.js';
import type { UpdateArtifactDto } from './update-artifact.dto.js';

/**
 * Raw row shape for the `artifacts` SQLite table.
 *
 * Mirrors the schema in `data/artifacts/artifacts.sql`:
 * - `id`: TEXT PRIMARY KEY
 * - `project_id`: TEXT NULLABLE (REFERENCES projects(id) ON DELETE SET NULL)
 * - `chat_id`: TEXT NULLABLE (REFERENCES chats(id) ON DELETE SET NULL)
 * - `agent_id`: TEXT NULLABLE (REFERENCES agents(id) ON DELETE SET NULL)
 * - `title`: TEXT NOT NULL
 * - `type`: TEXT NOT NULL ('document', 'code', 'file', 'structured')
 * - `mime_type`: TEXT NULLABLE
 * - `content`: TEXT NULLABLE (inline text content)
 * - `file_path`: TEXT NULLABLE (local storage relative reference)
 * - `version`: INTEGER NOT NULL (defaults to 1)
 * - `created_at`: TEXT NOT NULL
 * - `updated_at`: TEXT NOT NULL
 */
export interface ArtifactRow {
  readonly id: string;
  readonly project_id: string | null;
  readonly chat_id: string | null;
  readonly agent_id: string | null;
  readonly title: string;
  readonly type: string;
  readonly mime_type: string | null;
  readonly content: string | null;
  readonly file_path: string | null;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Maps a SQLite `artifacts` row to the public `ArtifactResponseDto`.
 *
 * Invariants:
 * - `file_path` is never exposed verbatim; `hasFile: boolean` is emitted instead.
 * - Nullable fields (`projectId`, `chatId`, `agentId`, `mimeType`) are emitted
 *   as `null`, never `undefined`.
 * - `content` is included for single-item retrieve/create/update, but omitted
 *   from collection list items when `includeContent` is false.
 */
export function mapArtifactRowToResponse(
  row: ArtifactRow,
  options?: { readonly includeContent?: boolean },
): ArtifactResponseDto {
  const includeContent = options?.includeContent ?? true;

  const base: ArtifactResponseDto = {
    id: row.id,
    projectId: row.project_id ?? null,
    chatId: row.chat_id ?? null,
    agentId: row.agent_id ?? null,
    title: row.title,
    type: row.type,
    mimeType: row.mime_type ?? null,
    hasFile: Boolean(row.file_path),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (includeContent) {
    return {
      ...base,
      content: row.content ?? null,
    };
  }

  return base;
}

/**
 * Options when mapping a `CreateArtifactDto` to a database row.
 */
export interface CreateArtifactRowOptions {
  /** Optional ID override (defaults to generating a new UUIDv7). */
  readonly id?: string;
  /** Optional timestamp override (defaults to nowIso()). */
  readonly now?: string;
  /** Optional version override (defaults to 1). */
  readonly version?: number;
}

/**
 * Maps a validated `CreateArtifactDto` to a fresh `ArtifactRow` for insertion.
 */
export function mapCreateArtifactDtoToRow(
  dto: CreateArtifactDto,
  options?: CreateArtifactRowOptions,
): ArtifactRow {
  const timestamp = options?.now ?? nowIso();
  const effectiveFilePath = dto.filePath ?? dto.file_path ?? null;

  return {
    id: options?.id ?? newId(),
    project_id: dto.projectId ?? null,
    chat_id: dto.chatId ?? null,
    agent_id: dto.agentId ?? null,
    title: dto.title,
    type: dto.type,
    mime_type: dto.mimeType ?? null,
    content: dto.content ?? null,
    file_path: effectiveFilePath,
    version: options?.version ?? 1,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

/**
 * Result of evaluating an `UpdateArtifactDto` against an existing `ArtifactRow`.
 */
export interface ArtifactUpdateResult {
  /** The prospective row state after applying updates. */
  readonly updatedRow: ArtifactRow;
  /** True if at least one column has changed value. */
  readonly hasChanges: boolean;
  /** Map of column names to new values for SQL UPDATE. */
  readonly changedColumns: Readonly<Record<string, unknown>>;
  /** SQL SET clauses (e.g. `["title = ?", "version = ?", "updated_at = ?"]`). */
  readonly setClauses: readonly string[];
  /** Parameter values matching `setClauses`. */
  readonly setParams: readonly unknown[];
  /** Previous file_path that became orphaned/superseded and should be unlinked. */
  readonly unlinkedFilePath?: string | null;
}

/**
 * Applies an `UpdateArtifactDto` to an existing `ArtifactRow`.
 *
 * Implements partial update semantics:
 * - Omitted (`undefined`): Column is untouched.
 * - Explicit `null`: Nullable fields (`mimeType`, `projectId`, `chatId`, `agentId`)
 *   are set to `null`.
 * - `title` and `type` cannot be set to empty string or null.
 * - `content` and `filePath`: Ensures the XOR invariant remains satisfied.
 *   Clearing one while setting the other is valid; clearing both or setting both throws 400.
 * - `version`: Increments by 1 if any field was modified; left untouched on no-op updates.
 * - `updated_at`: Updated to current timestamp if any field was modified.
 * - `id` and `created_at` are immutable and never modified.
 */
export function applyArtifactUpdates(
  existingRow: ArtifactRow,
  dto: UpdateArtifactDto,
  options?: { readonly now?: string },
): ArtifactUpdateResult {
  const changedColumns: Record<string, unknown> = {};
  const setClauses: string[] = [];
  const setParams: unknown[] = [];

  function recordChange(column: keyof ArtifactRow, value: unknown): void {
    changedColumns[column] = value;
    setClauses.push(`${column} = ?`);
    setParams.push(value);
  }

  if (dto.title !== undefined && dto.title !== existingRow.title) {
    recordChange('title', dto.title);
  }

  if (dto.type !== undefined && dto.type !== existingRow.type) {
    recordChange('type', dto.type);
  }

  if (dto.mimeType !== undefined) {
    const nextMime = dto.mimeType ?? null;
    if (nextMime !== existingRow.mime_type) {
      recordChange('mime_type', nextMime);
    }
  }

  if (dto.projectId !== undefined) {
    const nextProject = dto.projectId ?? null;
    if (nextProject !== existingRow.project_id) {
      recordChange('project_id', nextProject);
    }
  }

  if (dto.chatId !== undefined) {
    const nextChat = dto.chatId ?? null;
    if (nextChat !== existingRow.chat_id) {
      recordChange('chat_id', nextChat);
    }
  }

  if (dto.agentId !== undefined) {
    const nextAgent = dto.agentId ?? null;
    if (nextAgent !== existingRow.agent_id) {
      recordChange('agent_id', nextAgent);
    }
  }

  // Handle content vs filePath XOR rule
  const contentSpecified = dto.content !== undefined;
  const dtoFilePath = dto.filePath !== undefined ? dto.filePath : dto.file_path;
  const filePathSpecified = dtoFilePath !== undefined;

  let nextContent = existingRow.content;
  let nextFilePath = existingRow.file_path;

  if (contentSpecified) {
    nextContent = dto.content ?? null;
  }
  if (filePathSpecified) {
    nextFilePath = dtoFilePath ?? null;
  }

  if (contentSpecified || filePathSpecified) {
    const hasContent = nextContent !== null && nextContent !== undefined;
    const hasFilePath = nextFilePath !== null && nextFilePath !== undefined;

    if (hasContent && hasFilePath) {
      throw new BadRequestException({
        code: 'INVALID_ARTIFACT_CONTENT',
        message: BOTH_CONTENT_AND_FILE_ERROR_MESSAGE,
      });
    }

    if (!hasContent && !hasFilePath) {
      throw new BadRequestException({
        code: 'INVALID_ARTIFACT_CONTENT',
        message: NEITHER_CONTENT_NOR_FILE_ERROR_MESSAGE,
      });
    }

    if (nextContent !== existingRow.content) {
      recordChange('content', nextContent);
    }
    if (nextFilePath !== existingRow.file_path) {
      recordChange('file_path', nextFilePath);
    }
  }

  const hasChanges = setClauses.length > 0;
  const updatedAt = hasChanges
    ? (options?.now ?? nowIso())
    : existingRow.updated_at;
  const nextVersion = hasChanges ? existingRow.version + 1 : existingRow.version;

  if (hasChanges) {
    changedColumns.version = nextVersion;
    setClauses.push('version = ?');
    setParams.push(nextVersion);

    changedColumns.updated_at = updatedAt;
    setClauses.push('updated_at = ?');
    setParams.push(updatedAt);
  }

  const updatedRow: ArtifactRow = {
    ...existingRow,
    ...(changedColumns as Partial<ArtifactRow>),
    version: nextVersion,
    updated_at: updatedAt,
  };

  // If existing file_path was replaced or unlinked, mark it for cleanup
  let unlinkedFilePath: string | null = null;
  if (
    existingRow.file_path &&
    nextFilePath !== existingRow.file_path
  ) {
    unlinkedFilePath = existingRow.file_path;
  }

  return {
    updatedRow,
    hasChanges,
    changedColumns,
    setClauses,
    setParams,
    unlinkedFilePath,
  };
}

