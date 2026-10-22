import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request values carried through the async call tree.
 */
export interface RequestStore {
  /**
   * Id shared by every log line of one request and returned to the client in
   * the `X-Request-Id` response header.
   */
  correlationId: string;
}

/**
 * Async-local store holding the current request's {@link RequestStore}.
 *
 * `AsyncLocalStorage` is what lets code far from the request — a service, or
 * the global exception filter — tag its output with the correlation id without
 * every function in between taking a context parameter.
 *
 * Entered once per request by `RequestLoggingMiddleware`; read through
 * {@link getCorrelationId} rather than directly.
 */
export const requestLocalStorage = new AsyncLocalStorage<RequestStore>();

/**
 * Retrieves the correlation ID for the current async execution context,
 * or undefined if running outside a request context.
 */
export function getCorrelationId(): string | undefined {
  return requestLocalStorage.getStore()?.correlationId;
}
