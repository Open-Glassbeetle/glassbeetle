import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
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
import { DatabaseService } from '../../database/database.service.js';
import { FileStorageService } from '../../file-storage/file-storage.service.js';
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
 * Note on image removal asymmetry:
 * There is no dedicated `DELETE /projects/:projectId/image` endpoint designed in the API,
 * unlike agent pictures which support `DELETE /agents/:agentId/picture`. A project image can
 * thus be uploaded/replaced, but not cleared on its own without deleting the project.
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
}
