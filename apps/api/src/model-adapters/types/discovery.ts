/**
 * Normalised representation of an AI model discovered from a provider's remote API.
 *
 * Mapped to the `models` table columns (`data/providers/models.sql`) for persistence
 * with `source = 'discovered'`.
 */
export interface DiscoveredModel {
  /**
   * The exact identifier string expected by the provider's API
   * (e.g. "claude-sonnet-5", "qwen2.5:14b", "gpt-4o").
   */
  readonly modelIdentifier: string;

  /**
   * Human-facing display name (e.g. "Claude Sonnet 3.5").
   */
  readonly displayName: string;

  /**
   * Context window size in tokens, if reported by the provider.
   */
  readonly contextWindow?: number | null;

  /**
   * Recommended default sampling temperature, if reported by the provider.
   */
  readonly defaultTemperature?: number | null;

  /**
   * Maximum completion output tokens, if reported by the provider.
   */
  readonly defaultMaxTokens?: number | null;
}
