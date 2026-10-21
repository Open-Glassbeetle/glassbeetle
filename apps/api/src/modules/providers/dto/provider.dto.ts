import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { TransformBoolean } from '../../../common/pagination/boolean-query.decorator.js';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';

/**
 * The six provider kinds supported by Glassbeetle.
 *
 * `ollama` and `lmstudio` are always local runtimes; `anthropic`, `openai` and
 * `google` are always remote; `openai_compatible` may be either.
 */
export const PROVIDER_KINDS = [
  'anthropic',
  'openai',
  'google',
  'ollama',
  'lmstudio',
  'openai_compatible',
] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/**
 * Kinds that require a `base_url` because they have no fixed endpoint.
 *
 * `anthropic`, `openai` and `google` have well-known URLs and therefore treat
 * `base_url` as an optional override. `ollama`, `lmstudio` and
 * `openai_compatible` have no canonical address — the user must supply one.
 */
export const LOCAL_OR_CUSTOM_KINDS: ReadonlySet<ProviderKind> = new Set([
  'ollama',
  'lmstudio',
  'openai_compatible',
]);

/**
 * Kinds that are always local runtimes.
 *
 * `is_local` is **derived** for `ollama` and `lmstudio`; the client value is
 * ignored for these kinds and the field is forced to `true`. For every other
 * kind, the client may set `isLocal` explicitly (default `false`).
 *
 * Rationale: Ollama and LM Studio are desktop applications that only ever bind
 * to the local machine. Storing a client-supplied `false` for them would be
 * misleading and could affect routing decisions in adapter code.
 */
export const ALWAYS_LOCAL_KINDS: ReadonlySet<ProviderKind> = new Set([
  'ollama',
  'lmstudio',
]);

/**
 * The JSON shape returned by every provider endpoint.
 *
 * `isLocal` and `enabled` are always booleans here; they are stored as
 * `INTEGER` (0/1) in SQLite and converted by the service.
 */
export interface ProviderDto {
  id: string;
  name: string;
  kind: ProviderKind;
  /** `true` for local runtimes (Ollama, LM Studio). Derived for always-local kinds. */
  isLocal: boolean;
  /** `null` for remote providers that use their default endpoint. */
  baseUrl: string | null;
  /** Whether the provider is active. New providers default to `true`. */
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Body accepted by `POST /api/v1/providers`.
 *
 * ### `baseUrl` rule
 * Required when `kind` is `ollama`, `lmstudio`, or `openai_compatible` because
 * those kinds have no canonical endpoint. For `anthropic`, `openai`, and
 * `google` it is optional and acts as a per-provider URL override (useful for
 * proxies or private deployments).
 *
 * `baseUrl` must be a valid HTTP or HTTPS URL when supplied. Other schemes
 * (e.g. `grpc://`) are rejected with 400.
 *
 * ### `isLocal` rule
 * For `ollama` and `lmstudio` the field is always forced to `true` regardless
 * of what the client sends. For all other kinds the client may set it
 * explicitly; it defaults to `false`.
 *
 * ### `enabled` rule
 * Defaults to `true`: a newly created provider is immediately live. If you
 * want to configure credentials before the provider is used, create it and
 * then `PATCH` `enabled: false`, or create it as disabled from the start.
 *
 * ### Cascade on delete
 * Deleting a provider cascades to:
 * 1. **`models`** — every model belonging to the provider is hard-deleted.
 * 2. **`provider_credentials`** — the encrypted API key (and its nonce) is
 *    destroyed and cannot be recovered.
 * 3. **`agents`** — any agent whose `modelId` pointed at one of those deleted
 *    models has its `modelId` set to `null` (`ON DELETE SET NULL`), leaving it
 *    unable to run until a new model is assigned.
 */
export class CreateProviderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsEnum(PROVIDER_KINDS, {
    message: `kind must be one of: ${PROVIDER_KINDS.join(', ')}`,
  })
  kind!: ProviderKind;

  /**
   * Required when kind is `ollama`, `lmstudio`, or `openai_compatible`.
   * Optional (override) for `anthropic`, `openai`, and `google`.
   * Must be an http or https URL.
   */
  @ValidateIf(
    (dto: CreateProviderDto) =>
      LOCAL_OR_CUSTOM_KINDS.has(dto.kind) || dto.baseUrl !== undefined,
  )
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true, require_tld: false },
    { message: 'baseUrl must be a valid http or https URL' },
  )
  @IsOptional()
  baseUrl?: string;

  /**
   * Whether this provider connects to a local runtime. Ignored (forced to
   * `true`) when kind is `ollama` or `lmstudio`.
   */
  @IsOptional()
  @IsBoolean()
  isLocal?: boolean;

  /**
   * Whether the provider is active immediately after creation.
   * Defaults to `true`.
   */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * Body accepted by `PATCH /api/v1/providers/:providerId`.
 *
 * All fields are optional; only supplied fields are changed.
 */
export class UpdateProviderDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsEnum(PROVIDER_KINDS, {
    message: `kind must be one of: ${PROVIDER_KINDS.join(', ')}`,
  })
  kind?: ProviderKind;

  /**
   * Set `null` explicitly to clear the base URL (only valid for
   * non-local kinds). The same validation rules as on create apply.
   */
  @IsOptional()
  @ValidateIf(
    (dto: UpdateProviderDto) =>
      dto.baseUrl !== null && dto.baseUrl !== undefined,
  )
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true, require_tld: false },
    { message: 'baseUrl must be a valid http or https URL' },
  )
  baseUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  isLocal?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * Query parameters accepted by `GET /api/v1/providers`.
 *
 * Extends the base pagination DTO with provider-specific filters.
 */
export class ListProvidersQueryDto extends PaginationQueryDto {
  /**
   * Filter to a single provider kind, e.g. `?kind=anthropic`.
   */
  @IsOptional()
  @IsEnum(PROVIDER_KINDS, {
    message: `kind must be one of: ${PROVIDER_KINDS.join(', ')}`,
  })
  kind?: ProviderKind;

  /**
   * Filter by enabled state, e.g. `?enabled=true`.
   */
  @IsOptional()
  @TransformBoolean()
  @IsBoolean()
  enabled?: boolean;

  /**
   * Filter by local-runtime flag, e.g. `?isLocal=true`.
   */
  @IsOptional()
  @TransformBoolean()
  @IsBoolean()
  isLocal?: boolean;
}

/**
 * Raw row shape returned by SQLite for the providers table.
 */
export interface ProviderRow {
  id: string;
  name: string;
  kind: string;
  is_local: number;
  base_url: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}
