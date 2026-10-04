import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  createPaginatedResponse,
  type PaginatedResponse,
} from '../../common/pagination/paginated-response.dto.js';
import { buildPaginationSqlFragment } from '../../common/pagination/sql-query-builder.js';
import { newId } from '../../common/persistence/identifiers.js';
import { nowIso } from '../../common/persistence/timestamps.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { DEFAULT_MAX_PICTURE_SIZE_BYTES } from '../../config/app.config.js';
import { DatabaseService } from '../../database/database.service.js';
import { detectContentType } from '../../file-storage/content-type.js';
import { FileStorageService } from '../../file-storage/file-storage.service.js';
import type { AgentResponseDto } from './dto/agent-response.dto.js';
import {
  applyAgentUpdates,
  mapAgentRowToResponse,
  mapCreateAgentDtoToRow,
  type AgentRow,
} from './dto/agent.mapper.js';
import type { CreateAgentDto } from './dto/create-agent.dto.js';
import type { ListAgentsQueryDto } from './dto/list-agents-query.dto.js';
import type { UpdateAgentDto } from './dto/update-agent.dto.js';

/**
 * Whitelist of allowed sort columns for the agents collection endpoint.
 * Maps client-facing camelCase keys to safe database column names.
 */
export const ALLOWED_AGENT_SORT_COLUMNS: Readonly<Record<string, string>> = {
  createdAt: 'created_at',
  name: 'name',
  id: 'id',
  updatedAt: 'updated_at',
};

/**
 * Allowed MIME types for agent profile pictures.
 *
 * Excludes SVG and HTML types to protect against stored XSS attacks
 * within the Tauri desktop application webview.
 */
export const ALLOWED_PICTURE_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

/**
 * Escapes characters with special meaning in SQLite LIKE patterns (`\`, `%`, `_`).
 * This ensures user-supplied search terms are treated strictly as literal substrings.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/([\\%_])/g, '\\$1');
}

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly fileStorage?: FileStorageService,
    @Optional() private readonly appConfigService?: AppConfigService,
  ) {}

  /**
   * Retrieves a paginated list of agents matching optional query filters.
   */
  async findAll(
    query: ListAgentsQueryDto,
  ): Promise<PaginatedResponse<AgentResponseDto>> {
    const conditions: string[] = [];
    const filterParams: unknown[] = [];

    // Filter by modelId: supports exact ID match or string "null" for unassigned models
    if (query.modelId !== undefined) {
      if (query.modelId === 'null') {
        conditions.push('model_id IS NULL');
      } else {
        conditions.push('model_id = ?');
        filterParams.push(query.modelId);
      }
    }

    // Filter by systemPromptId: supports exact ID match or string "null" for unassigned prompts
    if (query.systemPromptId !== undefined) {
      if (query.systemPromptId === 'null') {
        conditions.push('system_prompt_id IS NULL');
      } else {
        conditions.push('system_prompt_id = ?');
        filterParams.push(query.systemPromptId);
      }
    }

    // Substring search on name (case-insensitive in SQLite by default for ASCII)
    const nameSearch = query.name ?? query.search;
    if (nameSearch !== undefined && nameSearch.trim() !== '') {
      conditions.push("name LIKE ? ESCAPE '\\'");
      filterParams.push(`%${escapeLikePattern(nameSearch.trim())}%`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count matching rows for the pagination envelope
    const countSql = `SELECT COUNT(*) AS total FROM agents ${whereClause}`;
    const countRow = this.db.get<{ total: number }>(countSql, filterParams);
    const total = countRow?.total ?? 0;

    // Build safe sorting and pagination clause (validates sort key against whitelist)
    const pagination = buildPaginationSqlFragment({
      query,
      allowedSortColumns: ALLOWED_AGENT_SORT_COLUMNS,
      defaultSortKey: 'createdAt',
      defaultOrder: 'desc',
    });

    // Query the requested slice of rows with bound parameters
    const selectSql = `SELECT * FROM agents ${whereClause} ${pagination.clauseSql}`;
    const rows = this.db.all<AgentRow>(selectSql, [
      ...filterParams,
      ...pagination.params,
    ]);

    return createPaginatedResponse(
      rows.map(mapAgentRowToResponse),
      total,
      pagination.params[0],
      pagination.params[1],
    );
  }

  /**
   * Retrieves a single agent by ID, or null if not found.
   */
  async findById(id: string): Promise<AgentResponseDto | null> {
    const row = this.db.get<AgentRow>('SELECT * FROM agents WHERE id = ?', [
      id,
    ]);
    if (!row) {
      return null;
    }
    return mapAgentRowToResponse(row);
  }

  /**
   * Retrieves a single agent by ID.
   * Throws NotFoundException if no agent exists with the given ID.
   */
  async findOne(id: string): Promise<AgentResponseDto> {
    const agent = await this.findById(id);
    if (!agent) {
      throw new NotFoundException({
        code: 'AGENT_NOT_FOUND',
        message: `Agent with ID "${id}" not found`,
      });
    }
    return agent;
  }

  /**
   * Creates a new agent within an atomic transaction.
   *
   * Validates that supplied foreign keys exist before insertion to return
   * specific 422 errors naming the invalid reference.
   */
  async create(dto: CreateAgentDto): Promise<AgentResponseDto> {
    return this.db.transaction(() => {
      // Validate modelId foreign key if supplied
      if (dto.modelId) {
        const modelRow = this.db.get<{ id: string }>(
          'SELECT id FROM models WHERE id = ?',
          [dto.modelId],
        );
        if (!modelRow) {
          throw new UnprocessableEntityException({
            code: 'MODEL_NOT_FOUND',
            message: `Referenced modelId "${dto.modelId}" does not exist`,
          });
        }
      }

      // Validate systemPromptId foreign key if supplied
      if (dto.systemPromptId) {
        const promptRow = this.db.get<{ id: string }>(
          'SELECT id FROM system_prompts WHERE id = ?',
          [dto.systemPromptId],
        );
        if (!promptRow) {
          throw new UnprocessableEntityException({
            code: 'SYSTEM_PROMPT_NOT_FOUND',
            message: `Referenced systemPromptId "${dto.systemPromptId}" does not exist`,
          });
        }
      }

      const id = newId();
      const now = nowIso();
      const row = mapCreateAgentDtoToRow(dto, { id, now });

      try {
        this.db.run(
          `INSERT INTO agents (
            id,
            name,
            personality,
            instructions,
            system_prompt_id,
            model_id,
            temperature,
            max_tokens,
            model_params,
            picture_path,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.id,
            row.name,
            row.personality,
            row.instructions,
            row.system_prompt_id,
            row.model_id,
            row.temperature,
            row.max_tokens,
            row.model_params,
            row.picture_path,
            row.created_at,
            row.updated_at,
          ],
        );
      } catch (error: any) {
        if (error?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
          throw new UnprocessableEntityException({
            code: 'FOREIGN_KEY_VIOLATION',
            message: 'Referenced foreign key constraint failed',
          });
        }
        throw error;
      }

      const persisted = this.db.get<AgentRow>(
        'SELECT * FROM agents WHERE id = ?',
        [row.id],
      );

      if (!persisted) {
        throw new Error('Failed to retrieve agent after insert');
      }

      return mapAgentRowToResponse(persisted);
    });
  }

  /**
   * Updates an existing agent partially within an atomic transaction.
   *
   * Validates that the agent exists, validates supplied foreign keys (modelId, systemPromptId),
   * applies only the provided mutable fields, updates updated_at, and returns the persisted row.
   *
   * If no changes are needed (e.g. empty body or identical values), returns the existing row
   * without bumping updated_at.
   */
  async update(id: string, dto: UpdateAgentDto): Promise<AgentResponseDto> {
    return this.db.transaction(() => {
      const existing = this.db.get<AgentRow>(
        'SELECT * FROM agents WHERE id = ?',
        [id],
      );

      if (!existing) {
        throw new NotFoundException({
          code: 'AGENT_NOT_FOUND',
          message: `Agent with ID "${id}" not found`,
        });
      }

      // Validate modelId foreign key if supplied and not null
      if (dto.modelId !== undefined && dto.modelId !== null) {
        const modelRow = this.db.get<{ id: string }>(
          'SELECT id FROM models WHERE id = ?',
          [dto.modelId],
        );
        if (!modelRow) {
          throw new UnprocessableEntityException({
            code: 'MODEL_NOT_FOUND',
            message: `Referenced modelId "${dto.modelId}" does not exist`,
          });
        }
      }

      // Validate systemPromptId foreign key if supplied and not null
      if (dto.systemPromptId !== undefined && dto.systemPromptId !== null) {
        const promptRow = this.db.get<{ id: string }>(
          'SELECT id FROM system_prompts WHERE id = ?',
          [dto.systemPromptId],
        );
        if (!promptRow) {
          throw new UnprocessableEntityException({
            code: 'SYSTEM_PROMPT_NOT_FOUND',
            message: `Referenced systemPromptId "${dto.systemPromptId}" does not exist`,
          });
        }
      }

      const updateResult = applyAgentUpdates(existing, dto);

      if (!updateResult.hasChanges) {
        return mapAgentRowToResponse(existing);
      }

      const sql = `UPDATE agents SET ${updateResult.setClauses.join(', ')} WHERE id = ?`;
      const params = [...updateResult.setParams, id];

      try {
        this.db.run(sql, params);
      } catch (error: any) {
        if (error?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
          throw new UnprocessableEntityException({
            code: 'FOREIGN_KEY_VIOLATION',
            message: 'Referenced foreign key constraint failed',
          });
        }
        throw error;
      }

      const persisted = this.db.get<AgentRow>(
        'SELECT * FROM agents WHERE id = ?',
        [id],
      );

      if (!persisted) {
        throw new Error('Failed to retrieve agent after update');
      }

      return mapAgentRowToResponse(persisted);
    });
  }

  /**
   * Permanently deletes an agent by ID.
   *
   * Database cascades automatically remove referencing rows:
   * - `agent_memories`: CASCADE — private memories are destroyed.
   * - `team_members`: CASCADE — team memberships are removed.
   * - `messages`: SET NULL — messages survive, attribution lost.
   * - `artifacts`: SET NULL — artifacts survive, attribution lost.
   * - `usage_events`: SET NULL — analytics history survives, attribution lost.
   * - `chats`: ON DELETE SET NULL on `chats.agent_id` violates the `chats` table CHECK constraint
   *   requiring either `agent_id` or `team_id` to be non-null. Therefore, deleting an agent
   *   with agent-owned chats fails with SQLITE_CONSTRAINT_CHECK.
   *
   * If a picture file exists on disk, it is unlinked after the database row is deleted.
   * Missing files or unlinking errors are logged as warnings and do not fail the request.
   *
   * Throws NotFoundException (404) if no agent with the given ID exists.
   */
  async delete(id: string): Promise<void> {
    const deletedRow = this.db.get<{ picture_path: string | null }>(
      'DELETE FROM agents WHERE id = ? RETURNING picture_path',
      [id],
    );

    if (!deletedRow) {
      throw new NotFoundException({
        code: 'AGENT_NOT_FOUND',
        message: `Agent with ID "${id}" not found`,
      });
    }

    if (deletedRow.picture_path && this.fileStorage) {
      try {
        await this.fileStorage.delete(deletedRow.picture_path);
      } catch (error) {
        this.logger.warn(
          `Failed to delete picture file "${deletedRow.picture_path}" for agent "${id}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Uploads and stores a new profile picture for an agent, replacing any existing picture.
   *
   * Constraints:
   * - Agent must exist (throws 404 NotFoundException if not).
   * - Content type is determined from actual file bytes (magic bytes), not client headers.
   * - Only JPEG, PNG, WebP, and GIF images are permitted (SVG excluded to prevent XSS in Tauri webview).
   * - Maximum file size is enforced from configuration.
   * - The stored filename is generated via UUIDv7 and never derived from client-supplied names.
   * - The file is stored via FileStorageService in the 'pictures' bucket.
   * - Replaces and deletes any previously stored picture file without leaking files.
   * - Updates `agents.picture_path` and `updated_at`.
   * - Never returns the raw `picture_path` in the response (maps to AgentResponseDto with `hasPicture: true`).
   *
   * Failure order:
   * 1. Validate file (type, size).
   * 2. Verify agent exists.
   * 3. Write new file to storage.
   * 4. Update database row (`picture_path`, `updated_at`).
   * 5. Delete old file from storage (logged on failure, harmless if unreferenced).
   */
  async uploadPicture(
    id: string,
    file: Express.Multer.File,
  ): Promise<AgentResponseDto> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException({
        code: 'MISSING_FILE',
        message: 'No file uploaded or file is empty',
      });
    }

    const existing = this.db.get<{ id: string; picture_path: string | null }>(
      'SELECT id, picture_path FROM agents WHERE id = ?',
      [id],
    );

    if (!existing) {
      throw new NotFoundException({
        code: 'AGENT_NOT_FOUND',
        message: `Agent with ID "${id}" not found`,
      });
    }

    const maxBytes =
      this.appConfigService?.maxPictureSizeBytes ??
      DEFAULT_MAX_PICTURE_SIZE_BYTES;

    if (file.buffer.length > maxBytes) {
      throw new PayloadTooLargeException({
        code: 'FILE_TOO_LARGE',
        message: `File size (${file.buffer.length} bytes) exceeds the maximum allowed limit of ${maxBytes} bytes`,
      });
    }

    const detected = detectContentType(file.buffer);

    if (!ALLOWED_PICTURE_MIME_TYPES.includes(detected.mime)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: `Unsupported image format '${detected.mime}'. Allowed formats: ${ALLOWED_PICTURE_MIME_TYPES.join(', ')}`,
      });
    }

    if (!this.fileStorage) {
      throw new Error('FileStorageService is required for picture uploads');
    }

    // Write new file to 'pictures' bucket (generates internal UUIDv7 filename, ignores client originalname)
    const stored = await this.fileStorage.write('pictures', file.buffer, {
      maxBytes,
      allowedMimeTypes: ALLOWED_PICTURE_MIME_TYPES,
    });

    const now = nowIso();

    // Update database row
    this.db.run(
      'UPDATE agents SET picture_path = ?, updated_at = ? WHERE id = ?',
      [stored.reference, now, id],
    );

    // Delete previous picture file if one existed
    if (existing.picture_path) {
      try {
        await this.fileStorage.delete(existing.picture_path);
      } catch (err) {
        this.logger.warn(
          `Failed to delete previous picture "${existing.picture_path}" for agent "${id}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const updated = this.db.get<AgentRow>(
      'SELECT * FROM agents WHERE id = ?',
      [id],
    );

    if (!updated) {
      throw new Error('Failed to retrieve agent after picture upload');
    }

    return mapAgentRowToResponse(updated);
  }

  /**
   * Removes an agent's profile picture and deletes the stored file.
   *
   * Idempotency Decision:
   * - If the agent exists and has a picture: deletes the file from storage, sets `picture_path = NULL`,
   *   refreshes `updated_at`, and returns 204.
   * - If the agent exists but has NO picture: returns 204 No Content (idempotent operation).
   * - If the agent does NOT exist: throws 404 NotFoundException.
   */
  async deletePicture(id: string): Promise<void> {
    const existing = this.db.get<{ id: string; picture_path: string | null }>(
      'SELECT id, picture_path FROM agents WHERE id = ?',
      [id],
    );

    if (!existing) {
      throw new NotFoundException({
        code: 'AGENT_NOT_FOUND',
        message: `Agent with ID "${id}" not found`,
      });
    }

    // Idempotent: if agent exists and has no picture, return without error (204)
    if (!existing.picture_path) {
      return;
    }

    const now = nowIso();
    this.db.run(
      'UPDATE agents SET picture_path = NULL, updated_at = ? WHERE id = ?',
      [now, id],
    );

    if (this.fileStorage) {
      try {
        await this.fileStorage.delete(existing.picture_path);
      } catch (err) {
        this.logger.warn(
          `Failed to delete picture "${existing.picture_path}" for agent "${id}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}



