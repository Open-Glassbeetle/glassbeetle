import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestStore {
  correlationId: string;
}

export const requestLocalStorage = new AsyncLocalStorage<RequestStore>();

/**
 * Retrieves the correlation ID for the current async execution context,
 * or undefined if running outside a request context.
 */
export function getCorrelationId(): string | undefined {
  return requestLocalStorage.getStore()?.correlationId;
}
