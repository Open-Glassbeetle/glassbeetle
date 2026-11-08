import type { Readable } from 'node:stream';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { newId } from '../../common/persistence/identifiers.js';
import { nowIso } from '../../common/persistence/timestamps.js';
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
import { DEFAULT_MAX_ARTIFACT_FILE_SIZE_BYTES } from './artifact-upload.interceptor.js';
import {
  applyArtifactUpdates,
  mapCreateArtifactDtoToRow,
  mapArtifactRowToResponse,
  mapArtifactVersionRowToResponse,
  type ArtifactResponseDto,
  type ArtifactRow,
  type ArtifactVersionResponseDto,
  type ArtifactVersionRow,
  type CreateArtifactDto,
  type ListArtifactVersionsQueryDto,
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
 * Whitelist of client-facing sort keys for artifact version history.
 */
export const ALLOWED_ARTIFACT_VERSION_SORT_COLUMNS: Readonly<
  Record<string, string>
> = {
  version: 'av.version',
  createdAt: 'av.created_at',
  created_at: 'av.created_at',
  title: 'av.title',
  type: 'av.type',
  id: 'av.id',
};

/**
 * Maximum historical versions retained per artifact.
 *
 * When an artifact exceeds 20 historical versions, the oldest version records
 * are pruned from `artifact_versions` and any backing files that are no longer
 * referenced by the active artifact or remaining versions are unlinked.
 */
export const MAX_ARTIFACT_VERSIONS_RETAINED = 20;

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

    let orphanedFiles: string[] = [];

    this.db.transaction(() => {
      this.snapshotVersion(existing);

      this.db.run(
        `UPDATE artifacts SET ${updateResult.setClauses.join(', ')} WHERE id = ?`,
        [...updateResult.setParams, id],
      );

      orphanedFiles = this.pruneVersionsSync(id);
    });

    await this.unlinkOrphanedFiles(orphanedFiles);

    return mapArtifactRowToResponse(updateResult.updatedRow, {
      includeContent: true,
    });
  }

  /**
   * Uploads file content for an artifact (`PUT /artifacts/:artifactId/content`).
   *
   * Stores the binary file in the `artifacts/` bucket via `FileStorageService`,
   * snapshots the previous active artifact state into `artifact_versions`, bumps
   * the artifact's version, updates `updated_at`, and enforces the 20-version retention ceiling.
   *
   * @throws NotFoundException (404) if artifact does not exist.
   * @throws PayloadTooLargeError (413) if uploaded file exceeds 100 MiB.
   */
  async uploadContent(
    id: string,
    file: Express.Multer.File,
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

    if (!this.fileStorage) {
      throw new Error(
        'FileStorageService is required for artifact content uploads',
      );
    }

    const stored = await this.fileStorage.write('artifacts', file.buffer, {
      maxBytes: DEFAULT_MAX_ARTIFACT_FILE_SIZE_BYTES,
    });

    const now = nowIso();
    const nextVersion = existing.version + 1;
    // The uploaded bytes are the authority for the artifact's type: a client's
    // earlier `mimeType` (or one inferred from the previous inline content)
    // must not outlive the file that replaced it.
    const nextMimeType = stored.contentType || existing.mime_type;

    let orphanedFiles: string[] = [];
    const updatedRow: ArtifactRow = {
      ...existing,
      content: null,
      file_path: stored.reference,
      mime_type: nextMimeType,
      version: nextVersion,
      updated_at: now,
    };

    try {
      this.db.transaction(() => {
        this.snapshotVersion(existing);

        this.db.run(
          `UPDATE artifacts
           SET content = NULL, file_path = ?, mime_type = ?, version = ?, updated_at = ?
           WHERE id = ?`,
          [stored.reference, nextMimeType, nextVersion, now, id],
        );

        orphanedFiles = this.pruneVersionsSync(id);
      });
    } catch (err) {
      await this.fileStorage.delete(stored.reference).catch(() => {});
      throw err;
    }

    await this.unlinkOrphanedFiles(orphanedFiles);

    return mapArtifactRowToResponse(updatedRow, { includeContent: true });
  }

  /**
   * Retrieves a paginated collection of historical versions for an artifact.
   *
   * Inline `content` is omitted to maintain lightweight payload sizes.
   *
   * @throws NotFoundException (404) if parent artifact does not exist.
   */
  async findAllVersions(
    artifactId: string,
    query: ListArtifactVersionsQueryDto,
  ): Promise<PaginatedResponse<ArtifactVersionResponseDto>> {
    const artifact = this.db.get<{ id: string }>(
      'SELECT id FROM artifacts WHERE id = ?',
      [artifactId],
    );

    if (!artifact) {
      throw new NotFoundException({
        code: 'ARTIFACT_NOT_FOUND',
        message: `Artifact "${artifactId}" not found`,
      });
    }

    const totalRow = this.db.get<{ total: number }>(
      'SELECT COUNT(*) as total FROM artifact_versions av WHERE av.artifact_id = ?',
      [artifactId],
    );
    const total = totalRow?.total ?? 0;

    const sqlFragment = buildPaginationSqlFragment({
      query,
      allowedSortColumns: ALLOWED_ARTIFACT_VERSION_SORT_COLUMNS,
      defaultSortKey: 'version',
      defaultOrder: 'desc',
      tiebreakerColumn: 'av.id',
    });

    const rows = this.db.all<ArtifactVersionRow>(
      `SELECT av.id, av.artifact_id, av.version, av.title, av.type, av.mime_type, NULL as content, av.file_path, av.created_at
       FROM artifact_versions av
       WHERE av.artifact_id = ?
       ${sqlFragment.clauseSql}`,
      [artifactId, ...sqlFragment.params],
    );

    const items = rows.map((row) =>
      mapArtifactVersionRowToResponse(row, { includeContent: false }),
    );

    return createPaginatedResponse(
      items,
      total,
      sqlFragment.params[0],
      sqlFragment.params[1],
    );
  }

  /**
   * Retrieves metadata and inline content (if present) for a specific historical version.
   *
   * @throws NotFoundException (404) if parent artifact or version does not exist.
   */
  async findOneVersion(
    artifactId: string,
    version: number,
  ): Promise<ArtifactVersionResponseDto> {
    const artifact = this.db.get<{ id: string }>(
      'SELECT id FROM artifacts WHERE id = ?',
      [artifactId],
    );

    if (!artifact) {
      throw new NotFoundException({
        code: 'ARTIFACT_NOT_FOUND',
        message: `Artifact "${artifactId}" not found`,
      });
    }

    const row = this.db.get<ArtifactVersionRow>(
      `SELECT av.id, av.artifact_id, av.version, av.title, av.type, av.mime_type, av.content, av.file_path, av.created_at
       FROM artifact_versions av
       WHERE av.artifact_id = ? AND av.version = ?`,
      [artifactId, version],
    );

    if (!row) {
      throw new NotFoundException({
        code: 'ARTIFACT_VERSION_NOT_FOUND',
        message: `Version ${version} not found for artifact "${artifactId}"`,
      });
    }

    return mapArtifactVersionRowToResponse(row, { includeContent: true });
  }

  /**
   * Retrieves a content descriptor for a historical version to stream or serve inline.
   *
   * @throws NotFoundException (404) if artifact, version, content, or backing file is missing.
   */
  async openVersionContent(
    artifactId: string,
    version: number,
  ): Promise<ArtifactContent> {
    const artifact = this.db.get<{ id: string }>(
      'SELECT id FROM artifacts WHERE id = ?',
      [artifactId],
    );

    if (!artifact) {
      throw new NotFoundException({
        code: 'ARTIFACT_NOT_FOUND',
        message: `Artifact "${artifactId}" not found`,
      });
    }

    const row = this.db.get<ArtifactVersionRow>(
      `SELECT av.id, av.artifact_id, av.version, av.title, av.type, av.mime_type, av.content, av.file_path, av.created_at
       FROM artifact_versions av
       WHERE av.artifact_id = ? AND av.version = ?`,
      [artifactId, version],
    );

    if (!row) {
      throw new NotFoundException({
        code: 'ARTIFACT_VERSION_NOT_FOUND',
        message: `Version ${version} not found for artifact "${artifactId}"`,
      });
    }

    const hasContent = row.content !== null && row.content !== undefined;
    const hasFilePath = row.file_path !== null && row.file_path !== undefined;

    if (!hasContent && !hasFilePath) {
      throw new NotFoundException({
        code: 'ARTIFACT_CONTENT_NOT_FOUND',
        message: `Version ${version} of artifact "${artifactId}" has neither inline content nor backing file`,
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
        updatedAt: row.created_at,
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
          `Version ${version} of artifact "${artifactId}" references file "${filePath}" that is missing from storage`,
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
      updatedAt: row.created_at,
      filePath,
      size: stat.size,
      openStream: (range?: { start?: number; end?: number }) =>
        fileStorage.createReadStream(filePath, range),
    };
  }

  /**
   * Restores a historical version by rolling forward: snapshots the current active
   * version into `artifact_versions` and creates a new current version increment
   * (`version = current.version + 1`) carrying the restored content and metadata.
   *
   * @throws NotFoundException (404) if parent artifact or requested version does not exist.
   */
  async restoreVersion(
    artifactId: string,
    version: number,
  ): Promise<ArtifactResponseDto> {
    const existing = this.db.get<ArtifactRow>(
      'SELECT * FROM artifacts WHERE id = ?',
      [artifactId],
    );

    if (!existing) {
      throw new NotFoundException({
        code: 'ARTIFACT_NOT_FOUND',
        message: `Artifact "${artifactId}" not found`,
      });
    }

    const historical = this.db.get<ArtifactVersionRow>(
      `SELECT av.id, av.artifact_id, av.version, av.title, av.type, av.mime_type, av.content, av.file_path, av.created_at
       FROM artifact_versions av
       WHERE av.artifact_id = ? AND av.version = ?`,
      [artifactId, version],
    );

    if (!historical) {
      throw new NotFoundException({
        code: 'ARTIFACT_VERSION_NOT_FOUND',
        message: `Version ${version} not found for artifact "${artifactId}"`,
      });
    }

    const now = nowIso();
    const nextVersion = existing.version + 1;

    let orphanedFiles: string[] = [];
    const updatedRow: ArtifactRow = {
      ...existing,
      title: historical.title,
      type: historical.type,
      mime_type: historical.mime_type,
      content: historical.content,
      file_path: historical.file_path,
      version: nextVersion,
      updated_at: now,
    };

    this.db.transaction(() => {
      this.snapshotVersion(existing);

      this.db.run(
        `UPDATE artifacts
         SET title = ?, type = ?, mime_type = ?, content = ?, file_path = ?, version = ?, updated_at = ?
         WHERE id = ?`,
        [
          historical.title,
          historical.type,
          historical.mime_type,
          historical.content,
          historical.file_path,
          nextVersion,
          now,
          artifactId,
        ],
      );

      orphanedFiles = this.pruneVersionsSync(artifactId);
    });

    await this.unlinkOrphanedFiles(orphanedFiles);

    return mapArtifactRowToResponse(updatedRow, { includeContent: true });
  }

  /**
   * Permanently deletes an artifact, all of its historical version records,
   * and unlinks all backing files referenced across active artifact and versions.
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

    const historicalRows = this.db.all<{ file_path: string | null }>(
      'SELECT file_path FROM artifact_versions WHERE artifact_id = ?',
      [id],
    );

    const filesToConsider = [
      existing.file_path,
      ...historicalRows.map((r) => r.file_path),
    ].filter((fp): fp is string => fp !== null && fp !== undefined);

    this.db.transaction(() => {
      this.db.run('DELETE FROM artifact_versions WHERE artifact_id = ?', [id]);
      this.db.run('DELETE FROM artifacts WHERE id = ?', [id]);
    });

    await this.unlinkOrphanedFiles(filesToConsider);
  }

  /**
   * Snapshots an existing active artifact row into `artifact_versions`.
   */
  private snapshotVersion(row: ArtifactRow): void {
    const versionId = newId();
    this.db.run(
      `INSERT INTO artifact_versions (id, artifact_id, version, title, type, mime_type, content, file_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        versionId,
        row.id,
        row.version,
        row.title,
        row.type,
        row.mime_type,
        row.content,
        row.file_path,
        row.updated_at,
      ],
    );
  }

  /**
   * Enforces the maximum 20-version retention ceiling for an artifact synchronously
   * within a database transaction.
   *
   * Returns backing file paths belonging to pruned records that may need unlinking.
   */
  private pruneVersionsSync(artifactId: string): string[] {
    const versions = this.db.all<{
      id: string;
      version: number;
      file_path: string | null;
    }>(
      'SELECT id, version, file_path FROM artifact_versions WHERE artifact_id = ? ORDER BY version DESC',
      [artifactId],
    );

    if (versions.length <= MAX_ARTIFACT_VERSIONS_RETAINED) {
      return [];
    }

    const excess = versions.slice(MAX_ARTIFACT_VERSIONS_RETAINED);
    const excessIds = excess.map((v) => v.id);
    const placeholders = excessIds.map(() => '?').join(', ');

    this.db.run(
      `DELETE FROM artifact_versions WHERE id IN (${placeholders})`,
      excessIds,
    );

    return excess
      .map((v) => v.file_path)
      .filter((fp): fp is string => fp !== null && fp !== undefined);
  }

  /**
   * Checks candidate file paths and unlinks any that are no longer referenced by
   * any active artifact or any remaining historical version.
   */
  private async unlinkOrphanedFiles(
    filePaths: readonly string[],
  ): Promise<void> {
    if (!this.fileStorage || filePaths.length === 0) return;

    const uniquePaths = Array.from(new Set(filePaths));
    for (const filePath of uniquePaths) {
      const activeRef = this.db.get<{ id: string }>(
        'SELECT id FROM artifacts WHERE file_path = ? LIMIT 1',
        [filePath],
      );
      if (activeRef) continue;

      const versionRef = this.db.get<{ id: string }>(
        'SELECT id FROM artifact_versions WHERE file_path = ? LIMIT 1',
        [filePath],
      );
      if (versionRef) continue;

      try {
        await this.fileStorage.delete(filePath);
      } catch (err) {
        this.logger.warn(
          `Failed to clean up unreferenced artifact file "${filePath}": ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
}
