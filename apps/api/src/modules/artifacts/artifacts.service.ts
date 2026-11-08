import type { Readable } from 'node:stream';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  createPaginatedResponse,
  type PaginatedResponse,
} from '../../common/pagination/paginated-response.dto.js';
import {
  buildPaginationSqlFragment,
  escapeLikePattern,
} from '../../common/pagination/sql-query-builder.js';
import { DatabaseService } from '../../database/database.service.js';
import { FileNotFoundError } from '../../file-storage/file-storage.errors.js';
import { FileStorageService } from '../../file-storage/file-storage.service.js';
import {
  applyArtifactUpdates,
  mapCreateArtifactDtoToRow,
  mapArtifactRowToResponse,
  type ArtifactResponseDto,
  type ArtifactRow,
  type CreateArtifactDto,
  type ListArtifactsQueryDto,
  type UpdateArtifactDto,
  BOTH_CONTENT_AND_FILE_ERROR_MESSAGE,
  NEITHER_CONTENT_NOR_FILE_ERROR_MESSAGE,
} from './dto/index.js';

/**
 * Whitelist of client-facing sort keys to their SQL column expressions.
 *
 * Supports both camelCase and snake_case timestamp keys.
 */
export const ALLOWED_ARTIFACT_SORT_COLUMNS: Readonly<Record<string, string>> = {
  createdAt: 'a.created_at',
  created_at: 'a.created_at',
  updatedAt: 'a.updated_at',
  updated_at: 'a.updated_at',
  title: 'a.title',
  type: 'a.type',
  version: 'a.version',
  id: 'a.id',
};

/**
 * Descriptor of an artifact's actual content for direct serving or streaming.
 */
export type ArtifactContent =
  | {
      readonly kind: 'inline';
      readonly id: string;
      readonly title: string;
      readonly version: number;
      readonly mimeType: string | null;
      readonly updatedAt: string;
      readonly content: string;
      readonly size: number;
    }
  | {
      readonly kind: 'file';
      readonly id: string;
      readonly title: string;
      readonly version: number;
      readonly mimeType: string | null;
      readonly updatedAt: string;
      readonly filePath: string;
      readonly size: number;
      readonly openStream: (range?: {
        start?: number;
        end?: number;
      }) => Promise<Readable>;
    };

/**
 * Service managing artifact entities and their persistence in SQLite.
 *
 * Artifacts are the first-class work products of the system (documents, code,
 * files, and structured data) produced by agents or supplied by users.
 *
 * Invariants & design decisions:
 * - Content vs File XOR Rule:
 *   An artifact holds either inline text content (`content`) or a stored file
 *   reference (`file_path`), never both and never neither.
 * - Privacy & Security:
 *   `file_path` is never exposed verbatim; `hasFile: boolean` is emitted instead.
 * - Content in List vs Retrieve:
 *   Inline `content` is included in item retrieval (`GET /artifacts/:artifactId`),
 *   creation, and update responses, but omitted from collection list items
 *   (`GET /artifacts`) to avoid large payloads when browsing collections.
 * - Foreign Key Lifecycles & Cascades:
 *   `project_id`, `chat_id`, and `agent_id` reference their respective tables
 *   with `ON DELETE SET NULL`. When a parent entity is deleted, artifacts survive
 *   unfiled with the reference set to null.
 * - Version Semantics:
 *   `version` starts at 1 and auto-increments by 1 on every successful update
 *   that modifies fields. Client attempts to specify `version` are rejected.
 * - File Cleanup:
 *   When an artifact is deleted, any backing file on disk (`file_path`) is unlinked
 *   via `FileStorageService`. File deletion errors are logged and do not fail the request.
 */
@Injectable()
export class ArtifactsService {
  private readonly logger = new Logger(ArtifactsService.name);

  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly fileStorage?: FileStorageService,
  ) {}

  /**
   * Retrieves a paginated list of artifacts matching optional filter criteria.
   *
   * Content is omitted from list items to maintain lightweight collection payloads.
   */
  async findAll(
    query: ListArtifactsQueryDto,
  ): Promise<PaginatedResponse<ArtifactResponseDto>> {
    const conditions: string[] = [];
    const filterParams: unknown[] = [];

    if (query.projectId !== undefined) {
      if (query.projectId === 'null' || query.projectId === '') {
        conditions.push('a.project_id IS NULL');
      } else {
        conditions.push('a.project_id = ?');
        filterParams.push(query.projectId);
      }
    }

    if (query.chatId !== undefined) {
      if (query.chatId === 'null' || query.chatId === '') {
        conditions.push('a.chat_id IS NULL');
      } else {
        conditions.push('a.chat_id = ?');
        filterParams.push(query.chatId);
      }
    }

    if (query.agentId !== undefined) {
      if (query.agentId === 'null' || query.agentId === '') {
        conditions.push('a.agent_id IS NULL');
      } else {
        conditions.push('a.agent_id = ?');
        filterParams.push(query.agentId);
      }
    }

    if (query.type !== undefined && query.type.trim() !== '') {
      conditions.push('a.type = ?');
      filterParams.push(query.type.trim());
    }

    const titleSearch = query.title ?? query.search;
    if (titleSearch !== undefined && titleSearch.trim() !== '') {
      conditions.push("a.title LIKE ? ESCAPE '\\'");
      filterParams.push(`%${escapeLikePattern(titleSearch.trim())}%`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const totalRow = this.db.get<{ total: number }>(
      `SELECT COUNT(*) as total FROM artifacts a ${whereClause}`,
      filterParams,
    );
    const total = totalRow?.total ?? 0;

    const sqlFragment = buildPaginationSqlFragment({
      query,
      allowedSortColumns: ALLOWED_ARTIFACT_SORT_COLUMNS,
      defaultSortKey: 'createdAt',
      defaultOrder: 'desc',
      tiebreakerColumn: 'a.id',
    });

    const rows = this.db.all<ArtifactRow>(
      `SELECT a.id, a.project_id, a.chat_id, a.agent_id, a.title, a.type, a.mime_type, NULL as content, a.file_path, a.version, a.created_at, a.updated_at
       FROM artifacts a ${whereClause} ${sqlFragment.clauseSql}`,
      [...filterParams, ...sqlFragment.params],
    );

    const items = rows.map((row) =>
      mapArtifactRowToResponse(row, { includeContent: false }),
    );
    return createPaginatedResponse(
      items,
      total,
      sqlFragment.params[0],
      sqlFragment.params[1],
    );
  }

  /**
   * Retrieves a single artifact by ID, including its inline content if present.
   *
   * @throws NotFoundException (404) if no artifact exists with the given ID.
   */
  async findOne(id: string): Promise<ArtifactResponseDto> {
    const row = this.db.get<ArtifactRow>(
      `SELECT a.id, a.project_id, a.chat_id, a.agent_id, a.title, a.type, a.mime_type, a.content, a.file_path, a.version, a.created_at, a.updated_at
       FROM artifacts a WHERE a.id = ?`,
      [id],
    );

    if (!row) {
      throw new NotFoundException({
        code: 'ARTIFACT_NOT_FOUND',
        message: `Artifact "${id}" not found`,
      });
    }

    return mapArtifactRowToResponse(row, { includeContent: true });
  }

  /**
   * Retrieves an artifact's content descriptor for streaming or direct inline serving.
   *
   * All file operations are delegated to `FileStorageService` for containment checks.
   *
   * Error Handling / Status Codes:
   * - `ARTIFACT_NOT_FOUND` (404): No database row exists with the specified ID.
   * - `ARTIFACT_CONTENT_NOT_FOUND` (404): The row exists but has neither inline content nor a file reference.
   * - `ARTIFACT_FILE_NOT_FOUND` (404): The row references a file that is missing from storage.
   *   404 is chosen over 410 (Gone) or 500 because the missing backing file means the requested
   *   content sub-resource does not exist; 404 with a distinct code is honest, standard REST,
   *   and consistent with missing stored agent pictures.
   * - `InvalidPathError` (400): Backing file reference contains traversal sequences or escapes root.
   *
   * @throws NotFoundException (404)
   * @throws InvalidPathError (400)
   */
  async openContent(id: string): Promise<ArtifactContent> {
    const row = this.db.get<ArtifactRow>(
      `SELECT a.id, a.project_id, a.chat_id, a.agent_id, a.title, a.type, a.mime_type, a.content, a.file_path, a.version, a.created_at, a.updated_at
       FROM artifacts a WHERE a.id = ?`,
      [id],
    );

    if (!row) {
      throw new NotFoundException({
        code: 'ARTIFACT_NOT_FOUND',
        message: `Artifact "${id}" not found`,
      });
    }

    const hasContent = row.content !== null && row.content !== undefined;
    const hasFilePath = row.file_path !== null && row.file_path !== undefined;

    if (!hasContent && !hasFilePath) {
      throw new NotFoundException({
        code: 'ARTIFACT_CONTENT_NOT_FOUND',
        message: `Artifact "${id}" has neither inline content nor backing file`,
      });
    }

    if (hasContent) {
      const content = row.content!;
      return {
        kind: 'inline',
        id: row.id,
        title: row.title,
        version: row.version,
        mimeType: row.mime_type,
        updatedAt: row.updated_at,
        content,
        size: Buffer.byteLength(content, 'utf-8'),
      };
    }

    if (!this.fileStorage) {
      throw new Error(
        'FileStorageService is required to retrieve file artifact content',
      );
    }

    const filePath = row.file_path!;
    let stat;
    try {
      stat = await this.fileStorage.stat(filePath);
    } catch (err) {
      if (err instanceof FileNotFoundError) {
        this.logger.warn(
          `Artifact "${id}" references file "${filePath}" that is missing from storage`,
        );
        throw new NotFoundException({
          code: 'ARTIFACT_FILE_NOT_FOUND',
          message: `Artifact backing file not found in storage: ${filePath}`,
        });
      }
      throw err;
    }

    const fileStorage = this.fileStorage;
    return {
      kind: 'file',
      id: row.id,
      title: row.title,
      version: row.version,
      mimeType: row.mime_type,
      updatedAt: row.updated_at,
      filePath,
      size: stat.size,
      openStream: (range?: { start?: number; end?: number }) =>
        fileStorage.createReadStream(filePath, range),
    };
  }

  /**
   * Creates a new artifact record after validating foreign keys and content rules.
   *
   * @throws BadRequestException (400) if content/filePath rule is violated.
   * @throws UnprocessableEntityException (422) if projectId, chatId or agentId do not exist.
   */
  async create(dto: CreateArtifactDto): Promise<ArtifactResponseDto> {
    const hasContent = dto.content !== undefined && dto.content !== null;
    const effectiveFilePath = dto.filePath ?? dto.file_path;
    const hasFilePath =
      effectiveFilePath !== undefined && effectiveFilePath !== null;

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

    return this.db.transaction(() => {
      if (dto.projectId) {
        const project = this.db.get<{ id: string }>(
          'SELECT id FROM projects WHERE id = ?',
          [dto.projectId],
        );
        if (!project) {
          throw new UnprocessableEntityException({
            code: 'PROJECT_NOT_FOUND',
            message: `Referenced projectId "${dto.projectId}" does not exist`,
          });
        }
      }

      if (dto.chatId) {
        const chat = this.db.get<{ id: string }>(
          'SELECT id FROM chats WHERE id = ?',
          [dto.chatId],
        );
        if (!chat) {
          throw new UnprocessableEntityException({
            code: 'CHAT_NOT_FOUND',
            message: `Referenced chatId "${dto.chatId}" does not exist`,
          });
        }
      }

      if (dto.agentId) {
        const agent = this.db.get<{ id: string }>(
          'SELECT id FROM agents WHERE id = ?',
          [dto.agentId],
        );
        if (!agent) {
          throw new UnprocessableEntityException({
            code: 'AGENT_NOT_FOUND',
            message: `Referenced agentId "${dto.agentId}" does not exist`,
          });
        }
      }

      const row = mapCreateArtifactDtoToRow(dto);

      this.db.run(
        `INSERT INTO artifacts (id, project_id, chat_id, agent_id, title, type, mime_type, content, file_path, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.project_id,
          row.chat_id,
          row.agent_id,
          row.title,
          row.type,
          row.mime_type,
          row.content,
          row.file_path,
          row.version,
          row.created_at,
          row.updated_at,
        ],
      );

      return mapArtifactRowToResponse(row, { includeContent: true });
    });
  }

  /**
   * Partially updates an existing artifact.
   *
   * @throws NotFoundException (404) if artifact does not exist.
   * @throws BadRequestException (400) if content/filePath XOR rule is violated.
   * @throws UnprocessableEntityException (422) if updated parent references do not exist.
   */
  async update(
    id: string,
    dto: UpdateArtifactDto,
  ): Promise<ArtifactResponseDto> {
    const existing = this.db.get<ArtifactRow>(
      'SELECT * FROM artifacts WHERE id = ?',
      [id],
    );

    if (!existing) {
      throw new NotFoundException({
        code: 'ARTIFACT_NOT_FOUND',
        message: `Artifact "${id}" not found`,
      });
    }

    if (dto.projectId !== undefined && dto.projectId !== null) {
      const project = this.db.get<{ id: string }>(
        'SELECT id FROM projects WHERE id = ?',
        [dto.projectId],
      );
      if (!project) {
        throw new UnprocessableEntityException({
          code: 'PROJECT_NOT_FOUND',
          message: `Referenced projectId "${dto.projectId}" does not exist`,
        });
      }
    }

    if (dto.chatId !== undefined && dto.chatId !== null) {
      const chat = this.db.get<{ id: string }>(
        'SELECT id FROM chats WHERE id = ?',
        [dto.chatId],
      );
      if (!chat) {
        throw new UnprocessableEntityException({
          code: 'CHAT_NOT_FOUND',
          message: `Referenced chatId "${dto.chatId}" does not exist`,
        });
      }
    }

    if (dto.agentId !== undefined && dto.agentId !== null) {
      const agent = this.db.get<{ id: string }>(
        'SELECT id FROM agents WHERE id = ?',
        [dto.agentId],
      );
      if (!agent) {
        throw new UnprocessableEntityException({
          code: 'AGENT_NOT_FOUND',
          message: `Referenced agentId "${dto.agentId}" does not exist`,
        });
      }
    }

    const updateResult = applyArtifactUpdates(existing, dto);

    if (!updateResult.hasChanges) {
      return mapArtifactRowToResponse(existing, { includeContent: true });
    }

    this.db.run(
      `UPDATE artifacts SET ${updateResult.setClauses.join(', ')} WHERE id = ?`,
      [...updateResult.setParams, id],
    );

    if (updateResult.unlinkedFilePath && this.fileStorage) {
      try {
        await this.fileStorage.delete(updateResult.unlinkedFilePath);
      } catch (error) {
        this.logger.warn(
          `Failed to delete superseded artifact file "${updateResult.unlinkedFilePath}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return mapArtifactRowToResponse(updateResult.updatedRow, {
      includeContent: true,
    });
  }

  /**
   * Permanently deletes an artifact and cleans up its backing file if present.
   *
   * @throws NotFoundException (404) if artifact does not exist.
   */
  async delete(id: string): Promise<void> {
    const existing = this.db.get<ArtifactRow>(
      'SELECT * FROM artifacts WHERE id = ?',
      [id],
    );

    if (!existing) {
      throw new NotFoundException({
        code: 'ARTIFACT_NOT_FOUND',
        message: `Artifact "${id}" not found`,
      });
    }

    this.db.run('DELETE FROM artifacts WHERE id = ?', [id]);

    if (existing.file_path && this.fileStorage) {
      try {
        await this.fileStorage.delete(existing.file_path);
      } catch (error) {
        this.logger.warn(
          `Failed to clean up artifact file "${existing.file_path}" after deleting artifact "${id}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
