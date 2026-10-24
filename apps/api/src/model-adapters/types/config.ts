import type { ProviderKind } from '../../modules/providers/dto/provider.dto.js';

/**
 * Configuration supplied when instantiating a model adapter.
 *
 * ## Security Notice:
 * - `apiKey` is the decrypted plaintext secret for this provider.
 * - Adapters **MUST NEVER** log, print, cache to disk, or return `apiKey`.
 * - Adapters **MUST NEVER** attach `apiKey` or this configuration object to
 *   thrown `Error` or `ModelAdapterError` objects or their `cause`/`details`
 *   properties to prevent credential leaks in application error logs.
 */
export interface AdapterConfig {
  /** Identifier of the parent provider (UUIDv7) */
  readonly providerId: string;

  /** Provider kind (e.g. 'anthropic', 'openai', 'ollama', etc.) */
  readonly providerKind: ProviderKind;

  /**
   * Base URL for provider requests.
   * Required for local runtimes (`ollama`, `lmstudio`) and custom endpoints (`openai_compatible`).
   * Optional endpoint override for hosted providers (`anthropic`, `openai`, `google`).
   */
  readonly baseUrl?: string | null;

  /**
   * Decrypted API key or authentication secret.
   * Undefined for unauthenticated local runtimes (e.g. default Ollama / LM Studio).
   */
  readonly apiKey?: string;

  /**
   * Specific model identifier (e.g. 'claude-sonnet-5', 'gpt-4o') if scoped to a model row.
   */
  readonly modelIdentifier?: string;
}
