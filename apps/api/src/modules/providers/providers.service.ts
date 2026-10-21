import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import {
  fromDbBoolean,
  newId,
  nowIso,
  toDbBoolean,
} from '../../common/persistence/index.js';
import {
  buildPaginationSqlFragment,
} from '../../common/pagination/sql-query-builder.js';
import { createPaginatedResponse } from '../../common/pagination/paginated-response.dto.js';
import type {
  CreateProviderDto,
  ListProvidersQueryDto,
  ProviderDto,
  ProviderKind,
  ProviderRow,
  UpdateProviderDto,
} from './dto/provider.dto.js';
import {
  ALWAYS_LOCAL_KINDS,
  LOCAL_OR_CUSTOM_KINDS,
} from './dto/provider.dto.js';

/**
 * Allowed columns for list sorting.
 */
const SORT_COLUMNS: Record<string, string> = {
  id: 'id',
  name: 'name',
  kind: 'kind',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

@Injectable()
export class ProvidersService {
  constructor(private readonly db: DatabaseService) {}

  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------

  /**
   * Returns a paginated, filterable list of providers.
   *
   * Filters are applied with bound parameters only; the ORDER BY column is
   * whitelisted through {@link buildPaginationSqlFragment} so no SQL injection
   * is possible.
   */
  findAll(query: ListProvidersQueryDto) {
    const { clauseSql, params: paginationParams } = buildPaginationSqlFragment({
      query,
      allowedSortColumns: SORT_COLUMNS,
      defaultSortKey: 'createdAt',
      defaultOrder: 'desc',
    });

    const whereClauses: string[] = [];
    const filterParams: unknown[] = [];

    if (query.kind !== undefined) {
      whereClauses.push('kind = ?');
      filterParams.push(query.kind);
    }

    if (query.enabled !== undefined) {
      whereClauses.push('enabled = ?');
      filterParams.push(toDbBoolean(query.enabled));
    }

    if (query.isLocal !== undefined) {
      whereClauses.push('is_local = ?');
      filterParams.push(toDbBoolean(query.isLocal));
    }

    const where =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) AS total FROM providers ${where}`;
    const dataSql = `SELECT * FROM providers ${where} ${clauseSql}`;

    const countRow = this.db.get<{ total: number }>(countSql, filterParams);
    const rows = this.db.all<ProviderRow>(dataSql, [
      ...filterParams,
      ...paginationParams,
    ]);

    const limit = Math.min(Math.max(1, query.limit ?? 50), 100);
    const offset = Math.max(0, query.offset ?? 0);

    return createPaginatedResponse(
      rows.map(mapRow),
      countRow?.total ?? 0,
      limit,
      offset,
    );
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  /**
   * Creates a new provider.
   *
   * ### `isLocal` derivation
   * For `ollama` and `lmstudio` the flag is always forced to `true` regardless
   * of the client value: those runtimes are local by definition. For all other
   * kinds the client may supply the flag; it defaults to `false`.
   *
   * ### `baseUrl` validation
   * `baseUrl` is required when `kind` is `ollama`, `lmstudio`, or
   * `openai_compatible`. For the three managed remote kinds (`anthropic`,
   * `openai`, `google`) it is optional and acts as an endpoint override.
   *
   * ### `enabled` default
   * A newly created provider is enabled (`true`) by default so it is
   * immediately available for use.
   *
   * @throws BadRequestException when `baseUrl` is missing for a local/custom kind.
   */
  create(dto: CreateProviderDto): ProviderDto {
    this.assertBaseUrl(dto.kind, dto.baseUrl ?? null);

    const isLocal = deriveIsLocal(dto.kind, dto.isLocal);
    const enabled = dto.enabled ?? true;
    const id = newId();
    const now = nowIso();

    this.db.run(
      `INSERT INTO providers (id, name, kind, is_local, base_url, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, dto.name, dto.kind, toDbBoolean(isLocal), dto.baseUrl ?? null, toDbBoolean(enabled), now, now],
    );

    return this.findOneOrFail(id);
  }

  // ---------------------------------------------------------------------------
  // Retrieve
  // ---------------------------------------------------------------------------

  /**
   * Returns a single provider by ID.
   *
   * @throws NotFoundException when no provider with that ID exists.
   */
  findOne(id: string): ProviderDto {
    return this.findOneOrFail(id);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  /**
   * Partially updates a provider.
   *
   * Only the fields present in `dto` are changed; all others are left
   * untouched. The `updatedAt` timestamp is always refreshed.
   *
   * @throws NotFoundException when no provider with that ID exists.
   * @throws BadRequestException when the resulting `kind`/`baseUrl` combination
   *   is invalid.
   */
  update(id: string, dto: UpdateProviderDto): ProviderDto {
    const existing = this.findOneOrFail(id);

    const newKind: ProviderKind = dto.kind ?? existing.kind;
    const newBaseUrl: string | null =
      'baseUrl' in dto ? (dto.baseUrl ?? null) : existing.baseUrl;

    this.assertBaseUrl(newKind, newBaseUrl);

    const newIsLocal = deriveIsLocal(newKind, dto.isLocal ?? existing.isLocal);
    const newEnabled = dto.enabled ?? existing.enabled;
    const newName = dto.name ?? existing.name;
    const now = nowIso();

    this.db.run(
      `UPDATE providers
          SET name       = ?,
              kind       = ?,
              is_local   = ?,
              base_url   = ?,
              enabled    = ?,
              updated_at = ?
        WHERE id = ?`,
      [newName, newKind, toDbBoolean(newIsLocal), newBaseUrl, toDbBoolean(newEnabled), now, id],
    );

    return this.findOneOrFail(id);
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  /**
   * Deletes a provider by ID.
   *
   * ### Cascade chain (documented per issue requirement)
   * Deleting a provider triggers two `ON DELETE CASCADE` foreign keys and one
   * `ON DELETE SET NULL`:
   *
   * 1. **`models`** — every model whose `provider_id` references this provider
   *    is hard-deleted. There is no soft-delete; the rows are gone.
   * 2. **`provider_credentials`** — the credential row is destroyed along with
   *    the encrypted API key value and its nonce. The key cannot be recovered.
   * 3. **`agents`** — any agent whose `model_id` referenced one of the deleted
   *    models has its `model_id` set to `null`. The agent row is retained but
   *    will be unable to run until a new model is assigned.
   *
   * @throws NotFoundException when no provider with that ID exists.
   */
  remove(id: string): void {
    const existing = this.db.get<ProviderRow>(
      'SELECT id FROM providers WHERE id = ?',
      [id],
    );

    if (!existing) {
      throw new NotFoundException(`Provider '${id}' not found`);
    }

    this.db.run('DELETE FROM providers WHERE id = ?', [id]);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private findOneOrFail(id: string): ProviderDto {
    const row = this.db.get<ProviderRow>(
      'SELECT * FROM providers WHERE id = ?',
      [id],
    );

    if (!row) {
      throw new NotFoundException(`Provider '${id}' not found`);
    }

    return mapRow(row);
  }

  /**
   * Validates that `baseUrl` is present when required by `kind`.
   *
   * `ollama`, `lmstudio`, and `openai_compatible` have no canonical endpoint,
   * so `baseUrl` must be supplied. The three managed remote kinds have
   * well-known URLs and treat it as an optional override.
   */
  private assertBaseUrl(kind: ProviderKind, baseUrl: string | null): void {
    if (LOCAL_OR_CUSTOM_KINDS.has(kind) && !baseUrl) {
      throw new BadRequestException(
        `baseUrl is required when kind is '${kind}'`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

/**
 * Converts a raw SQLite row into the public {@link ProviderDto} shape.
 *
 * `is_local` and `enabled` are stored as `INTEGER` (0/1) and are mapped to
 * real booleans here so the JSON response never leaks storage artefacts.
 */
function mapRow(row: ProviderRow): ProviderDto {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as ProviderKind,
    isLocal: fromDbBoolean(row.is_local),
    baseUrl: row.base_url,
    enabled: fromDbBoolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Derives the `isLocal` value for the given kind.
 *
 * For `ollama` and `lmstudio` the flag is always `true` regardless of what
 * the client supplied. For all other kinds the client-supplied value is used,
 * falling back to `false` when absent.
 */
function deriveIsLocal(
  kind: ProviderKind,
  clientValue: boolean | undefined,
): boolean {
  if (ALWAYS_LOCAL_KINDS.has(kind)) {
    return true;
  }

  return clientValue ?? false;
}
