/**
 * Execution options passed to adapter calls (`complete`, `stream`, `discoverModels`).
 */
export interface CompletionOptions {
  /**
   * Signal to abort an in-flight request when a client disconnects, when the
   * user clicks 'Stop generation', or on timeout.
   */
  readonly signal?: AbortSignal;

  /**
   * Optional HTTP headers (e.g. correlation `X-Request-Id`) to forward.
   */
  readonly headers?: Record<string, string>;
}

/**
 * Options for model discovery queries.
 */
export interface DiscoveryOptions {
  /**
   * Signal to abort model discovery on timeout or user cancellation.
   */
  readonly signal?: AbortSignal;

  /**
   * Optional HTTP headers to forward.
   */
  readonly headers?: Record<string, string>;
}
