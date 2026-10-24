import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  createPaginatedResponse,
  type PaginatedResponse,
} from '../../../common/pagination/paginated-response.dto.js';
import { buildPaginationSqlFragment } from '../../../common/pagination/sql-query-builder.js';
import {
  newId,
  nowIso,
  toDbBoolean,
} from '../../../common/persistence/index.js';
import { DatabaseService } from '../../../database/database.service.js';
import {
  type ListProviderModelsQueryDto,
  type ModelDto,
  type ModelRow,
  type RegisterModelDto,
  mapModelRow,
} from './dto/index.js';

/**
 * Whitelist of client-facing sort keys mapped to safe SQL column names.
 *
 * Appends `id` tiebreaker to guarantee stable pagination ordering.
 */
export const ALLOWED_MODEL_SORT_COLUMNS: Readonly<Record<string, string>> = {
  id: 'id',
  modelIdentifier: 'model_identifier',
  displayName: 'display_name',
  source: 'source',
  contextWindow: 'context_window',
  defaultTemperature: 'default_temperature',
  defaultMaxTokens: 'default_max_tokens',
  enabled: 'enabled',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

/**
 * Owns the `models` table.
 *
 * Models represent the discrete AI models offered by a provider. Models are
 * referenced by agents via `agents.model_id` (`ON DELETE SET NULL`).
 *
 * A model originates either via automated discovery (`source = 'discovered'`)
 * or explicit manual registration (`source = 'manual'`). This service implements
 * provider-scoped model listing and manual registration.
 *
 * ### Architectural Decisions:
 * 1. **Conflict over Upsert**: Registering an already existing `(provider_id, model_identifier)`
 *    returns 409 Conflict rather than silently upserting or overwriting configuration.
 *    Modifications to existing models belong on model-specific update endpoints.
 * 2. **Boundary Validation**: Context window and token limits are validated as positive
 *    integers with no hardcoded upper ceiling, preventing date-sensitive bounds while
 *    disallowing nonsense negative values.
 * 3. **No Outbound Calls**: Registration does not ping or validate model existence against
 *    remote provider APIs.
 */
@Injectable()
export class ModelsService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Returns a paginated, filterable collection of models belonging to a provider.
   *
   * @param providerId - Parent provider UUIDv7.
   * @param query - Pagination, sorting, and filter options (`enabled`, `source`).
   * @throws NotFoundException (404) when the provider does not exist.
   */
  listByProvider(
    providerId: string,
    query: ListProviderModelsQueryDto,
  ): PaginatedResponse<ModelDto> {
    this.assertProviderExists(providerId);

    const { clauseSql, params: paginationParams } = buildPaginationSqlFragment({
      query,
      allowedSortColumns: ALLOWED_MODEL_SORT_COLUMNS,
      defaultSortKey: 'createdAt',
      defaultOrder: 'desc',
      tiebreakerColumn: 'id',
    });

    const whereClauses: string[] = ['provider_id = ?'];
    const filterParams: unknown[] = [providerId];

    if (query.enabled !== undefined) {
      whereClauses.push('enabled = ?');
      filterParams.push(toDbBoolean(query.enabled));
    }

    if (query.source !== undefined) {
      whereClauses.push('source = ?');
      filterParams.push(query.source);
    }

    const where = `WHERE ${whereClauses.join(' AND ')}`;
    const countSql = `SELECT COUNT(*) AS total FROM models ${where}`;
    const dataSql = `SELECT * FROM models ${where} ${clauseSql}`;

    const countRow = this.db.get<{ total: number }>(countSql, filterParams);
    const rows = this.db.all<ModelRow>(dataSql, [
      ...filterParams,
      ...paginationParams,
    ]);

    const limit = Math.min(Math.max(1, query.limit ?? 50), 100);
    const offset = Math.max(0, query.offset ?? 0);

    return createPaginatedResponse(
      rows.map(mapModelRow),
      countRow?.total ?? 0,
      limit,
      offset,
    );
  }

  /**
   * Manually registers a model under the given provider.
   *
   * Forces `source = 'manual'`. Validates that the model identifier does not
   * already exist under this provider (`UNIQUE (provider_id, model_identifier)`).
   *
   * @param providerId - Parent provider UUIDv7.
   * @param dto - Model registration parameters.
   * @throws NotFoundException (404) when the provider does not exist.
   * @throws ConflictException (409) when `modelIdentifier` is already registered for this provider.
   */
  createManual(providerId: string, dto: RegisterModelDto): ModelDto {
    this.assertProviderExists(providerId);

    const existing = this.db.get<{ id: string }>(
      'SELECT id FROM models WHERE provider_id = ? AND model_identifier = ?',
      [providerId, dto.modelIdentifier],
    );
    if (existing) {
      throw new ConflictException(
        `A model with identifier '${dto.modelIdentifier}' already exists for provider '${providerId}'`,
      );
    }

    const id = newId();
    const now = nowIso();
    const enabled = dto.enabled ?? true;

    try {
      this.db.run(
        `INSERT INTO models (
          id,
          provider_id,
          model_identifier,
          display_name,
          source,
          context_window,
          default_temperature,
          default_max_tokens,
          enabled,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          providerId,
          dto.modelIdentifier,
          dto.displayName,
          'manual',
          dto.contextWindow ?? null,
          dto.defaultTemperature ?? null,
          dto.defaultMaxTokens ?? null,
          toDbBoolean(enabled),
          now,
          now,
        ],
      );
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (
        err?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        err?.code === 'SQLITE_CONSTRAINT' ||
        (typeof err?.message === 'string' &&
          err.message.includes('UNIQUE constraint failed'))
      ) {
        throw new ConflictException(
          `A model with identifier '${dto.modelIdentifier}' already exists for provider '${providerId}'`,
        );
      }
      throw error;
    }

    return this.findOneOrFail(id);
  }

  /**
   * Retrieves a single model by ID.
   *
   * @param id - Model UUIDv7.
   * @throws NotFoundException (404) when no model with that ID exists.
   */
  findOne(id: string): ModelDto {
    return this.findOneOrFail(id);
  }

  /**
   * Internal helper asserting provider existence.
   *
   * @throws NotFoundException (404) when provider does not exist.
   */
  private assertProviderExists(providerId: string): void {
    const provider = this.db.get<{ id: string }>(
      'SELECT id FROM providers WHERE id = ?',
      [providerId],
    );
    if (!provider) {
      throw new NotFoundException(`Provider '${providerId}' not found`);
    }
  }

  /**
   * Reads one model row by ID or throws.
   *
   * @throws NotFoundException (404) when model does not exist.
   */
  private findOneOrFail(id: string): ModelDto {
    const row = this.db.get<ModelRow>(
      'SELECT * FROM models WHERE id = ?',
      [id],
    );
    if (!row) {
      throw new NotFoundException(`Model '${id}' not found`);
    }
    return mapModelRow(row);
  }
}
