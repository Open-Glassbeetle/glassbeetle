import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { REDACTED_TEXT } from '../../../common/logging/redact.js';
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
import { AdapterFactoryService } from '../../../model-adapters/adapter-factory/adapter-factory.service.js';
import {
  RequestAbortedError,
  UnsupportedCapabilityError,
  UnsupportedProviderKindError,
} from '../../../model-adapters/errors/index.js';
import type { ModelAdapter } from '../../../model-adapters/model-adapter.interface.js';
import type { DiscoveredModel } from '../../../model-adapters/types/index.js';
import { CredentialsService } from '../credentials/credentials.service.js';
import {
  LOCAL_OR_CUSTOM_KINDS,
  type ProviderKind,
  type ProviderRow,
} from '../dto/provider.dto.js';
import {
  type DiscoverModelsDto,
  type ListModelsQueryDto,
  type ListProviderModelsQueryDto,
  type ModelDiscoverySummaryDto,
  type ModelDto,
  type ModelRow,
  type RegisterModelDto,
  type UpdateModelDto,
  mapModelRow,
} from './dto/index.js';

/**
 * Whitelist of client-facing sort keys mapped to safe SQL column names.
 *
 * Appends `id` tiebreaker to guarantee stable pagination ordering.
 */
export const ALLOWED_MODEL_SORT_COLUMNS: Readonly<Record<string, string>> = {
  id: 'id',
  providerId: 'provider_id',
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
 * Whitelist of client-facing sort keys for the global models list, with table qualification
 * to prevent ambiguous column errors in queries joining `providers`.
 */
export const ALLOWED_GLOBAL_MODEL_SORT_COLUMNS: Readonly<Record<string, string>> = {
  id: 'models.id',
  providerId: 'models.provider_id',
  modelIdentifier: 'models.model_identifier',
  displayName: 'models.display_name',
  source: 'models.source',
  contextWindow: 'models.context_window',
  defaultTemperature: 'models.default_temperature',
  defaultMaxTokens: 'models.default_max_tokens',
  enabled: 'models.enabled',
  createdAt: 'models.created_at',
  updatedAt: 'models.updated_at',
};

/**
 * Owns the `models` table.
 *
 * Models represent the discrete AI models offered by a provider. Models are
 * referenced by agents via `agents.model_id` (`ON DELETE SET NULL`).
 *
 * A model originates either via automated discovery (`source = 'discovered'`)
 * or explicit manual registration (`source = 'manual'`). This service implements
 * provider-scoped model listing, manual registration, and automated discovery
 * reconciliation.
 *
 * ### Architectural Decisions:
 * 1. **Conflict over Upsert**: Registering an already existing `(provider_id, model_identifier)`
 *    returns 409 Conflict rather than silently upserting or overwriting configuration.
 * 2. **Reconciliation over Replacement**: Discovery never deletes missing models.
 *    Because `agents.model_id` is configured with `ON DELETE SET NULL`, deleting
 *    missing models would silently detach agents and break workflows. Missing
 *    discovered models are disabled (`enabled = 0`), preserving FK references.
 * 3. **Manual Model Preservation**: Models with `source = 'manual'` are never
 *    modified, overwritten, or disabled by discovery.
 * 4. **Idempotency & Transactionality**: Discovery runs inside a SQLite transaction.
 *    Running discovery repeatedly with identical upstream output writes nothing
 *    and reports all models as unchanged.
 */
@Injectable()
export class ModelsService {
  private readonly logger = new Logger(ModelsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly credentialsService: CredentialsService,
    private readonly adapterFactory: AdapterFactoryService,
  ) {}

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
   * Discovers models available from the provider's remote API and reconciles
   * them into the local `models` table.
   *
   * ### Reconciliation Rules:
   * 1. **New models**: Inserted with `source = 'discovered'` and `enabled = 1`.
   * 2. **Existing discovered models**: Metadata updated and `enabled = 1` refreshed.
   * 3. **Manual models**: Never modified or deleted by discovery.
   * 4. **Missing models**: Discovered models absent from upstream response are
   *    disabled (`enabled = 0`) to preserve references from `agents.model_id`.
   * 5. **Idempotency**: Repeated runs with identical upstream data perform zero writes.
   * 6. **Transactionality**: All writes occur inside a single SQLite transaction.
   *
   * @param providerId - Parent provider UUIDv7.
   * @param options - Optional discovery settings (e.g. timeoutMs).
   * @returns Model discovery summary with diff counts and the full model list.
   * @throws NotFoundException (404) if the provider does not exist.
   * @throws BadRequestException (400) if required base_url or credentials are not configured.
   * @throws NotImplementedException (501) if provider kind lacks discovery support.
   * @throws GatewayTimeoutException (504) if provider call times out.
   * @throws BadGatewayException (502) on upstream connection or response errors.
   */
  async discover(
    providerId: string,
    options?: DiscoverModelsDto,
  ): Promise<ModelDiscoverySummaryDto> {
    const provider = this.db.get<ProviderRow>(
      'SELECT * FROM providers WHERE id = ?',
      [providerId],
    );
    if (!provider) {
      throw new NotFoundException(`Provider '${providerId}' not found`);
    }

    const isLocalOrCustom = LOCAL_OR_CUSTOM_KINDS.has(
      provider.kind as ProviderKind,
    );

    // Local / custom providers require a base_url
    if (isLocalOrCustom) {
      if (!provider.base_url || provider.base_url.trim().length === 0) {
        throw new BadRequestException(
          `Provider '${providerId}' is not configured for discovery: base_url is required for kind '${provider.kind}'`,
        );
      }
    }

    // Hosted providers require credentials configured
    let apiKey: string | undefined;
    try {
      apiKey = this.credentialsService.getDecryptedCredential(providerId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        if (!isLocalOrCustom) {
          throw new BadRequestException(
            `Provider '${providerId}' is not configured for discovery: credentials are required for hosted provider kind '${provider.kind}'`,
          );
        }
        apiKey = undefined;
      } else {
        throw error;
      }
    }

    if (!this.adapterFactory.isSupported(provider.kind)) {
      throw new NotImplementedException({
        message: `Provider kind '${provider.kind}' does not support model discovery`,
        code: 'DISCOVERY_NOT_SUPPORTED',
      });
    }

    let adapter: ModelAdapter;
    try {
      adapter = this.adapterFactory.create({
        providerId: provider.id,
        providerKind: provider.kind as ProviderKind,
        baseUrl: provider.base_url ?? undefined,
        apiKey,
      });
    } catch (error) {
      if (
        error instanceof UnsupportedProviderKindError ||
        error instanceof UnsupportedCapabilityError
      ) {
        throw new NotImplementedException({
          message: `Provider kind '${provider.kind}' does not support model discovery`,
          code: 'DISCOVERY_NOT_SUPPORTED',
        });
      }
      throw error;
    }

    if (
      !adapter.capabilities?.supportsDiscovery ||
      typeof adapter.discoverModels !== 'function'
    ) {
      throw new NotImplementedException({
        message: `Provider kind '${provider.kind}' does not support model discovery`,
        code: 'DISCOVERY_NOT_SUPPORTED',
      });
    }

    const timeoutMs = options?.timeoutMs ?? 10_000;
    const abortController = new AbortController();
    let timeoutTriggered = false;
    const timeoutId = setTimeout(() => {
      timeoutTriggered = true;
      abortController.abort();
    }, timeoutMs);

    let rawDiscoveredModels: DiscoveredModel[];
    try {
      rawDiscoveredModels = await adapter.discoverModels({
        signal: abortController.signal,
      });
    } catch (error: unknown) {
      if (
        timeoutTriggered ||
        abortController.signal.aborted ||
        error instanceof RequestAbortedError ||
        (error as Error)?.name === 'AbortError'
      ) {
        throw new GatewayTimeoutException({
          message: `Model discovery timed out after ${timeoutMs}ms for provider '${providerId}'`,
          code: 'GATEWAY_TIMEOUT',
        });
      }

      if (error instanceof UnsupportedCapabilityError) {
        throw new NotImplementedException({
          message: `Provider kind '${provider.kind}' does not support model discovery`,
          code: 'DISCOVERY_NOT_SUPPORTED',
        });
      }

      if (error instanceof HttpException) {
        throw error;
      }

      // Safe logging without leaking credentials or raw upstream response bodies
      const rawMessage =
        error instanceof Error ? error.message : 'Unknown upstream error';
      const safeMessage = apiKey
        ? rawMessage.replaceAll(apiKey, REDACTED_TEXT)
        : rawMessage;
      this.logger.warn(
        `Model discovery failed upstream for provider '${providerId}' (${provider.kind}): ${safeMessage}`,
      );

      throw new BadGatewayException({
        message: `Failed to discover models from provider '${providerId}': upstream communication error`,
        code: 'BAD_GATEWAY',
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!Array.isArray(rawDiscoveredModels)) {
      throw new BadGatewayException({
        message: `Provider '${providerId}' returned malformed model discovery data`,
        code: 'BAD_GATEWAY',
      });
    }

    for (const item of rawDiscoveredModels) {
      if (
        !item ||
        typeof item !== 'object' ||
        typeof item.modelIdentifier !== 'string' ||
        item.modelIdentifier.trim().length === 0 ||
        typeof item.displayName !== 'string' ||
        item.displayName.trim().length === 0
      ) {
        throw new BadGatewayException({
          message: `Provider '${providerId}' returned malformed model discovery item`,
          code: 'BAD_GATEWAY',
        });
      }
    }

    // Deduplicate upstream models by modelIdentifier (keep first occurrence)
    const seenIdentifiers = new Set<string>();
    const deduplicatedUpstream: DiscoveredModel[] = [];
    for (const item of rawDiscoveredModels) {
      if (!seenIdentifiers.has(item.modelIdentifier)) {
        seenIdentifiers.add(item.modelIdentifier);
        deduplicatedUpstream.push(item);
      }
    }

    // Transactional reconciliation
    return this.db.transaction(() => {
      const existingRows = this.db.all<ModelRow>(
        'SELECT * FROM models WHERE provider_id = ?',
        [providerId],
      );
      const existingMap = new Map<string, ModelRow>(
        existingRows.map((row) => [row.model_identifier, row]),
      );

      let added = 0;
      let updated = 0;
      let unchanged = 0;
      let disabled = 0;

      for (const item of deduplicatedUpstream) {
        const existing = existingMap.get(item.modelIdentifier);

        if (!existing) {
          const id = newId();
          const now = nowIso();
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
             ) VALUES (?, ?, ?, ?, 'discovered', ?, ?, ?, 1, ?, ?)`,
            [
              id,
              providerId,
              item.modelIdentifier,
              item.displayName,
              item.contextWindow ?? null,
              item.defaultTemperature ?? null,
              item.defaultMaxTokens ?? null,
              now,
              now,
            ],
          );
          added++;
        } else if (existing.source === 'manual') {
          // Manually-registered models are deliberate user choices and never overwritten
          unchanged++;
        } else {
          // Existing discovered model: update metadata and ensure enabled = 1
          const targetDisplayName = item.displayName;
          const targetContextWindow = item.contextWindow ?? null;
          const targetDefaultTemperature = item.defaultTemperature ?? null;
          const targetDefaultMaxTokens = item.defaultMaxTokens ?? null;
          const targetEnabled = 1;

          const hasChanged =
            existing.display_name !== targetDisplayName ||
            existing.context_window !== targetContextWindow ||
            existing.default_temperature !== targetDefaultTemperature ||
            existing.default_max_tokens !== targetDefaultMaxTokens ||
            existing.enabled !== targetEnabled;

          if (hasChanged) {
            const now = nowIso();
            this.db.run(
              `UPDATE models
               SET display_name = ?,
                   context_window = ?,
                   default_temperature = ?,
                   default_max_tokens = ?,
                   enabled = ?,
                   updated_at = ?
               WHERE id = ?`,
              [
                targetDisplayName,
                targetContextWindow,
                targetDefaultTemperature,
                targetDefaultMaxTokens,
                targetEnabled,
                now,
                existing.id,
              ],
            );
            updated++;
          } else {
            unchanged++;
          }
        }
      }

      // Check for models in DB that were absent from upstream response
      for (const [identifier, existing] of existingMap.entries()) {
        if (seenIdentifiers.has(identifier)) {
          continue;
        }

        if (existing.source === 'manual') {
          // Manual models are left alone completely
          unchanged++;
        } else if (existing.enabled === 1) {
          // Disappeared discovered model: disable to preserve agent references
          const now = nowIso();
          this.db.run(
            `UPDATE models
             SET enabled = 0,
                 updated_at = ?
             WHERE id = ?`,
            [now, existing.id],
          );
          disabled++;
        } else {
          // Already disabled from a previous discovery run; no change in this run
          unchanged++;
        }
      }

      const allRows = this.db.all<ModelRow>(
        'SELECT * FROM models WHERE provider_id = ? ORDER BY created_at ASC, id ASC',
        [providerId],
      );

      return {
        added,
        updated,
        unchanged,
        disabled,
        models: allRows.map(mapModelRow),
      };
    });
  }

  /**
   * Returns a paginated, filterable collection of models across all providers.
   *
   * Includes embedded parent provider summary (id, name, kind) on each model.
   *
   * @param query - Pagination, sorting, and filter options (`providerId`, `enabled`, `source`).
   */
  listAll(query: ListModelsQueryDto): PaginatedResponse<ModelDto> {
    const { clauseSql, params: paginationParams } = buildPaginationSqlFragment({
      query,
      allowedSortColumns: ALLOWED_GLOBAL_MODEL_SORT_COLUMNS,
      defaultSortKey: 'createdAt',
      defaultOrder: 'desc',
      tiebreakerColumn: 'models.id',
    });

    const whereClauses: string[] = [];
    const filterParams: unknown[] = [];

    if (query.providerId !== undefined) {
      whereClauses.push('models.provider_id = ?');
      filterParams.push(query.providerId);
    }

    if (query.enabled !== undefined) {
      whereClauses.push('models.enabled = ?');
      filterParams.push(toDbBoolean(query.enabled));
    }

    if (query.source !== undefined) {
      whereClauses.push('models.source = ?');
      filterParams.push(query.source);
    }

    const where =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*) AS total FROM models ${where}`;
    const dataSql = `SELECT
        models.*,
        providers.name AS provider_name,
        providers.kind AS provider_kind
      FROM models
      LEFT JOIN providers ON providers.id = models.provider_id
      ${where} ${clauseSql}`;

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
   * Retrieves a single model by ID, including embedded provider summary.
   *
   * @param id - Model UUIDv7.
   * @throws NotFoundException (404) when no model with that ID exists.
   */
  findOne(id: string): ModelDto {
    const row = this.db.get<ModelRow>(
      `SELECT
         models.*,
         providers.name AS provider_name,
         providers.kind AS provider_kind
       FROM models
       LEFT JOIN providers ON providers.id = models.provider_id
       WHERE models.id = ?`,
      [id],
    );
    if (!row) {
      throw new NotFoundException(`Model '${id}' not found`);
    }
    return mapModelRow(row);
  }

  /**
   * Partially updates a model's mutable configuration.
   *
   * Rejects changes to immutable fields (`providerId`, `modelIdentifier`, `source`) with 400.
   *
   * @param id - Model UUIDv7.
   * @param dto - Partial update fields (displayName, contextWindow, defaultTemperature, defaultMaxTokens, enabled).
   * @throws NotFoundException (404) if the model does not exist.
   * @throws BadRequestException (400) if client attempts to modify immutable fields.
   */
  update(id: string, dto: UpdateModelDto): ModelDto {
    if (
      'providerId' in (dto as Record<string, unknown>) ||
      'provider_id' in (dto as Record<string, unknown>) ||
      'modelIdentifier' in (dto as Record<string, unknown>) ||
      'model_identifier' in (dto as Record<string, unknown>) ||
      'source' in (dto as Record<string, unknown>)
    ) {
      throw new BadRequestException(
        'providerId, modelIdentifier, and source are immutable and cannot be updated',
      );
    }

    const existing = this.db.get<ModelRow>(
      'SELECT * FROM models WHERE id = ?',
      [id],
    );
    if (!existing) {
      throw new NotFoundException(`Model '${id}' not found`);
    }

    const setClauses: string[] = [];
    const setParams: unknown[] = [];

    if (dto.displayName !== undefined) {
      setClauses.push('display_name = ?');
      setParams.push(dto.displayName);
    }
    if (dto.contextWindow !== undefined) {
      setClauses.push('context_window = ?');
      setParams.push(dto.contextWindow);
    }
    if (dto.defaultTemperature !== undefined) {
      setClauses.push('default_temperature = ?');
      setParams.push(dto.defaultTemperature);
    }
    if (dto.defaultMaxTokens !== undefined) {
      setClauses.push('default_max_tokens = ?');
      setParams.push(dto.defaultMaxTokens);
    }
    if (dto.enabled !== undefined) {
      setClauses.push('enabled = ?');
      setParams.push(toDbBoolean(dto.enabled));
    }

    if (setClauses.length > 0) {
      const now = nowIso();
      setClauses.push('updated_at = ?');
      setParams.push(now);

      const result = this.db.run(
        `UPDATE models SET ${setClauses.join(', ')} WHERE id = ?`,
        [...setParams, id],
      );
      if (result.changes === 0) {
        throw new NotFoundException(`Model '${id}' not found`);
      }
    }

    return this.findOne(id);
  }

  /**
   * Permanently deletes a model by ID.
   *
   * Referenced tables behavior:
   * - `agents.model_id` is configured with `ON DELETE SET NULL`. Dependent agents
   *   lose their model reference and can no longer run until reconfigured.
   *   Logs a warning with the count of affected agents so operators are aware.
   * - `usage_events.model_id` is configured with `ON DELETE SET NULL`. Historical
   *   records survive with attribution lost.
   *
   * @param id - Model UUIDv7.
   * @throws NotFoundException (404) when the model does not exist.
   */
  delete(id: string): void {
    const existing = this.db.get<ModelRow>(
      'SELECT id, display_name FROM models WHERE id = ?',
      [id],
    );
    if (!existing) {
      throw new NotFoundException(`Model '${id}' not found`);
    }

    const dependentAgents = this.db.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM agents WHERE model_id = ?',
      [id],
    );
    const affectedAgents = dependentAgents?.count ?? 0;
    if (affectedAgents > 0) {
      this.logger.warn(
        `Deleting model '${id}' ('${existing.display_name}') unlinked ${affectedAgents} dependent agent(s) (agents.model_id set to NULL). Consider disabling the model (enabled = 0) if agent references should be preserved.`,
      );
    }

    const result = this.db.run('DELETE FROM models WHERE id = ?', [id]);
    if (result.changes === 0) {
      throw new NotFoundException(`Model '${id}' not found`);
    }
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
   * Reads one model row by ID without joins (for provider-scoped operations).
   *
   * @throws NotFoundException (404) when model does not exist.
   */
  private findOneOrFail(id: string): ModelDto {
    const row = this.db.get<ModelRow>('SELECT * FROM models WHERE id = ?', [
      id,
    ]);
    if (!row) {
      throw new NotFoundException(`Model '${id}' not found`);
    }
    return mapModelRow(row);
  }
}
