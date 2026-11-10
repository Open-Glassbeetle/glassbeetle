import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import {
  createPaginatedResponse,
  type PaginatedResponse,
} from '../../common/pagination/paginated-response.dto.js';
import {
  buildPaginationSqlFragment,
  escapeLikePattern,
} from '../../common/pagination/sql-query-builder.js';
import { newId } from '../../common/persistence/identifiers.js';
import { nowIso } from '../../common/persistence/timestamps.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { DEFAULT_MAX_PICTURE_SIZE_BYTES } from '../../config/app.config.js';
import { DatabaseService } from '../../database/database.service.js';
import { FileNotFoundError } from '../../file-storage/file-storage.errors.js';
import { FileStorageService } from '../../file-storage/file-storage.service.js';
import {
  ALLOWED_PICTURE_MIME_TYPES,
  assertUploadablePicture,
} from '../../file-storage/picture-uploads.js';
import {
  applyProjectUpdates,
  mapCreateProjectDtoToRow,
  mapProjectRowToResponse,
  type CreateProjectDto,
  type ListProjectsQueryDto,
  type ProjectResponseDto,
  type ProjectRow,
  type ProjectRowWithCounts,
  type UpdateProjectDto,
} from './dto/index.js';

/**
 * Whitelist of client-facing sort keys to their SQL column expressions.
 *
 * Both camelCase and snake_case timestamp keys are accepted.
 */
export const ALLOWED_PROJECT_SORT_COLUMNS: Readonly<Record<string, string>> = {
  createdAt: 'p.created_at',
  created_at: 'p.created_at',
  updatedAt: 'p.updated_at',
  updated_at: 'p.updated_at',
  name: 'p.name',
  id: 'p.id',
};

/**
 * Service managing project entities and their persistence in SQLite.
 *
 * A project is an organizing container for related chats and artifacts.
 * The schema has no outgoing foreign keys, and references to a project
 * (`chats.project_id` and `artifacts.project_id`) use `ON DELETE SET NULL`.
 *
 * Image file cleanup:
 * When a project is deleted, its associated image file (if present) is unlinked
 * from storage via `FileStorageService`. Row deletion occurs first; any file deletion
 * failure is logged as a warning and does not fail the request.
 *
 * Counts decision:
 * Associated chat and artifact counts (`chatCount`, `artifactCount`) are computed
 * via cheap scalar subqueries utilizing `idx_chats_project_id` and `idx_artifacts_project_id`.
 * This gives consumers immediate insight into project size and contents when deciding whether
 * to delete a project or when rendering project lists.
 */
@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly fileStorage?: FileStorageService,
    @Optional() private readonly appConfigService?: AppConfigService,
  ) {}

  /**
   * Retrieves a paginated list of projects matching optional filter criteria.
   */
  async findAll(
    query: ListProjectsQueryDto,
  ): Promise<PaginatedResponse<ProjectResponseDto>> {
    const conditions: string[] = [];
    const filterParams: unknown[] = [];

    const nameSearch = query.name ?? query.search;
    if (nameSearch !== undefined && nameSearch.trim() !== '') {
      conditions.push("p.name LIKE ? ESCAPE '\\'");
      filterParams.push(`%${escapeLikePattern(nameSearch.trim())}%`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) AS total FROM projects p ${whereClause}`;
    const countRow = this.db.get<{ total: number }>(countSql, filterParams);
    const total = countRow?.total ?? 0;

    const pagination = buildPaginationSqlFragment({
      query,
      allowedSortColumns: ALLOWED_PROJECT_SORT_COLUMNS,
      defaultSortKey: 'createdAt',
      defaultOrder: 'desc',
      tiebreakerColumn: 'p.id',
    });

    const selectSql = `
      SELECT
        p.id,
        p.name,
        p.description,
        p.image_path,
        p.created_at,
        p.updated_at,
        (SELECT COUNT(*) FROM chats c WHERE c.project_id = p.id) AS chat_count,
        (SELECT COUNT(*) FROM artifacts a WHERE a.project_id = p.id) AS artifact_count
      FROM projects p
      ${whereClause}
      ${pagination.clauseSql}
    `;

    const rows = this.db.all<ProjectRowWithCounts>(selectSql, [
      ...filterParams,
      ...pagination.params,
    ]);

    return createPaginatedResponse(
      rows.map(mapProjectRowToResponse),
      total,
      pagination.params[0],
      pagination.params[1],
    );
  }

  /**
   * Retrieves a single project by ID along with its chat and artifact counts,
   * or returns null if not found.
   */
  async findById(id: string): Promise<ProjectResponseDto | null> {
    const row = this.db.get<ProjectRowWithCounts>(
      `SELECT
        p.id,
        p.name,
        p.description,
        p.image_path,
        p.created_at,
        p.updated_at,
        (SELECT COUNT(*) FROM chats c WHERE c.project_id = p.id) AS chat_count,
        (SELECT COUNT(*) FROM artifacts a WHERE a.project_id = p.id) AS artifact_count
      FROM projects p
      WHERE p.id = ?`,
      [id],
    );

    if (!row) {
      return null;
    }

    return mapProjectRowToResponse(row);
  }

  /**
   * Retrieves a single project by ID.
   * Throws NotFoundException (404) if no project exists with the given ID.
   */
  async findOne(id: string): Promise<ProjectResponseDto> {
    const project = await this.findById(id);
    if (!project) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: `Project with ID "${id}" not found`,
      });
    }
    return project;
  }

  /**
   * Creates a new project with server-generated ID and timestamps.
   */
  async create(dto: CreateProjectDto): Promise<ProjectResponseDto> {
    const id = newId();
    const now = nowIso();
    const row = mapCreateProjectDtoToRow(dto, { id, now });

    this.db.run(
      `INSERT INTO projects (id, name, description, image_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.name,
        row.description,
        row.image_path,
        row.created_at,
        row.updated_at,
      ],
    );

    return mapProjectRowToResponse({
      ...row,
      chat_count: 0,
      artifact_count: 0,
    });
  }

  /**
   * Partially updates an existing project within an atomic transaction.
   *
   * Only supplied fields are updated. If no fields changed (or empty body `{}`),
   * returns the existing row without bumping `updated_at`.
   * `created_at` and `id` are immutable.
   *
   * Throws NotFoundException (404) if no project with the given ID exists.
   */
  async update(
    id: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectResponseDto> {
    return this.db.transaction(() => {
      const existing = this.db.get<ProjectRow>(
        'SELECT * FROM projects WHERE id = ?',
        [id],
      );

      if (!existing) {
        throw new NotFoundException({
          code: 'PROJECT_NOT_FOUND',
          message: `Project with ID "${id}" not found`,
        });
      }

      const updateResult = applyProjectUpdates(existing, dto);

      if (updateResult.hasChanges) {
        const sql = `UPDATE projects SET ${updateResult.setClauses.join(', ')} WHERE id = ?`;
        const result = this.db.run(sql, [...updateResult.setParams, id]);

        if (result.changes === 0) {
          throw new NotFoundException({
            code: 'PROJECT_NOT_FOUND',
            message: `Project with ID "${id}" not found`,
          });
        }
      }

      const persisted = this.db.get<ProjectRowWithCounts>(
        `SELECT
          p.id,
          p.name,
          p.description,
          p.image_path,
          p.created_at,
          p.updated_at,
          (SELECT COUNT(*) FROM chats c WHERE c.project_id = p.id) AS chat_count,
          (SELECT COUNT(*) FROM artifacts a WHERE a.project_id = p.id) AS artifact_count
        FROM projects p
        WHERE p.id = ?`,
        [id],
      );

      if (!persisted) {
        throw new NotFoundException({
          code: 'PROJECT_NOT_FOUND',
          message: `Project with ID "${id}" not found`,
        });
      }

      return mapProjectRowToResponse(persisted);
    });
  }

  /**
   * Permanently deletes a project by ID.
   *
   * Cascade and Foreign Key Behavior:
   * Both referencing tables configure foreign keys with `ON DELETE SET NULL`:
   * - `chats.project_id` → SET NULL (chats survive intact, unfiled)
   * - `artifacts.project_id` → SET NULL (artifacts survive intact, unfiled)
   *
   * Nothing is destroyed: deleting a project as an organizing container does not
   * delete the work (chats, messages, artifacts) created within it.
   *
   * Image file cleanup:
   * If an image file was stored on disk, it is unlinked from storage after the
   * database row is successfully deleted. A failed file deletion is logged as a
   * warning rather than failing the request.
   *
   * Throws NotFoundException (404) if no project exists with the given ID.
   */
  async delete(id: string): Promise<void> {
    const existing = this.db.get<{ image_path: string | null }>(
      'SELECT image_path FROM projects WHERE id = ?',
      [id],
    );

    const result = this.db.run('DELETE FROM projects WHERE id = ?', [id]);

    if (result.changes === 0) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: `Project with ID "${id}" not found`,
      });
    }

    if (existing?.image_path && this.fileStorage) {
      try {
        await this.fileStorage.delete(existing.image_path);
      } catch (error) {
        this.logger.warn(
          `Failed to delete image file "${existing.image_path}" for project "${id}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async openImage(id: string): Promise<{
    contentType: string;
    size: number;
    etag: string;
    open: () => Promise<Readable>;
  }> {
    const existing = this.db.get<{
      image_path: string | null;
      updated_at: string;
    }>('SELECT image_path, updated_at FROM projects WHERE id = ?', [id]);

    if (!existing) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: `Project with ID "${id}" not found`,
      });
    }
    if (!existing.image_path) {
      throw this.imageNotFound();
    }
    if (!this.fileStorage) {
      throw new Error('FileStorageService is required to serve images');
    }

    const reference = existing.image_path;
    const fileStorage = this.fileStorage;
    try {
      const stat = await fileStorage.stat(reference);
      return {
        contentType: stat.contentType,
        size: stat.size,
        etag: `"${existing.updated_at}-${stat.size}"`,
        open: () => fileStorage.createReadStream(reference),
      };
    } catch (err) {
      if (err instanceof FileNotFoundError) {
        this.logger.warn(`Project "${id}" names an image that is no longer in storage`);
        throw this.imageNotFound();
      }
      throw err;
    }
  }

  async deleteImage(id: string): Promise<void> {
    const existing = this.db.get<{ image_path: string | null }>(
      'SELECT image_path FROM projects WHERE id = ?',
      [id],
    );
    if (!existing) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: `Project with ID "${id}" not found`,
      });
    }
    if (!existing.image_path) return;

    this.db.run(
      'UPDATE projects SET image_path = NULL, updated_at = ? WHERE id = ?',
      [nowIso(), id],
    );
    if (this.fileStorage) {
      try {
        await this.fileStorage.delete(existing.image_path);
      } catch (err) {
        this.logger.warn(
          `Failed to delete image "${existing.image_path}" for project "${id}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private imageNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'IMAGE_NOT_FOUND',
      message: 'No project image is stored',
    });
  }

  /**
   * Uploads and stores a new image for a project, replacing any existing image.
   *
   * Constraints:
   * - Project must exist (throws 404 NotFoundException if not).
   * - Content type is determined from actual file bytes (magic bytes), not client headers.
   * - Only JPEG, PNG, WebP, and GIF images are permitted (SVG excluded to prevent XSS in Tauri webview).
   * - Maximum file size is enforced from configuration.
   * - The stored filename is generated via UUIDv7 and never derived from client-supplied names.
   * - The file is stored via FileStorageService in the 'project-images' bucket.
   * - Replaces and deletes any previously stored image file without leaking files.
   * - Updates `projects.image_path` and `updated_at`.
   * - Never returns the raw `image_path` in the response (maps to ProjectResponseDto with `hasImage: true`).
   *
   * Ordering on replacement:
   * 1. Validate file (type, size).
   * 2. Verify project exists.
   * 3. Write new file to storage ('project-images' bucket).
   * 4. Update database row (`image_path`, `updated_at`).
   * 5. Delete old file from storage (logged on failure, harmless if unreferenced).
   */
  async uploadImage(
    id: string,
    file?: Express.Multer.File,
  ): Promise<ProjectResponseDto> {
    const maxBytes =
      this.appConfigService?.maxPictureSizeBytes ??
      DEFAULT_MAX_PICTURE_SIZE_BYTES;

    assertUploadablePicture(file, maxBytes);

    const existing = this.db.get<{ id: string; image_path: string | null }>(
      'SELECT id, image_path FROM projects WHERE id = ?',
      [id],
    );

    if (!existing) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: `Project with ID "${id}" not found`,
      });
    }

    if (!this.fileStorage) {
      throw new Error('FileStorageService is required for image uploads');
    }

    // Write new file to 'project-images' bucket (generates internal UUIDv7 filename, ignores client originalname)
    const stored = await this.fileStorage.write(
      'project-images',
      (file as Express.Multer.File).buffer,
      {
        maxBytes,
        allowedMimeTypes: ALLOWED_PICTURE_MIME_TYPES,
      },
    );

    const now = nowIso();

    // Update database row
    this.db.run(
      'UPDATE projects SET image_path = ?, updated_at = ? WHERE id = ?',
      [stored.reference, now, id],
    );

    // Delete previous image file if one existed
    if (existing.image_path) {
      try {
        await this.fileStorage.delete(existing.image_path);
      } catch (err) {
        this.logger.warn(
          `Failed to delete previous image "${existing.image_path}" for project "${id}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return this.findOne(id);
  }
}
