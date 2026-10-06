import { HttpErrorResponse } from '@angular/common/http';

/**
 * The error envelope every Glassbeetle endpoint returns
 * (`docs/api-conventions.md` → "Error responses").
 */
export interface ApiErrorBody {
  readonly statusCode: number;
  readonly error: string;
  /** Stable, machine-readable code. Clients branch on this, not on `message`. */
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly timestamp?: string;
  /** Present only for validation failures: one string per failing constraint. */
  readonly details?: readonly string[];
}

/** A normalised API failure, whatever shape the transport error arrived in. */
export interface ApiError {
  /** 0 when the request never reached the API (server down, CORS, offline). */
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details: readonly string[];
  /** True when the API could not be reached at all. */
  readonly offline: boolean;
}

const OFFLINE_MESSAGE = 'Could not reach the Glassbeetle API. Is it running on port 3000?';

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ApiErrorBody).code === 'string' &&
    typeof (value as ApiErrorBody).message === 'string'
  );
}

/**
 * Normalises an `HttpErrorResponse` into an `ApiError`.
 *
 * A status of 0 means the browser never got a response — the API is down, the
 * machine is offline, or CORS rejected the request. That is reported as a
 * connection problem rather than as whatever empty body came back, because the
 * remedy is different from any error the API raised deliberately.
 */
export function toApiError(error: unknown): ApiError {
  if (!(error instanceof HttpErrorResponse)) {
    return {
      status: 0,
      code: 'UNKNOWN',
      message: error instanceof Error ? error.message : 'Something went wrong.',
      details: [],
      offline: false,
    };
  }

  if (error.status === 0) {
    return {
      status: 0,
      code: 'API_UNREACHABLE',
      message: OFFLINE_MESSAGE,
      details: [],
      offline: true,
    };
  }

  if (isApiErrorBody(error.error)) {
    return {
      status: error.status,
      code: error.error.code,
      message: error.error.message,
      details: error.error.details ?? [],
      offline: false,
    };
  }

  return {
    status: error.status,
    code: 'UNKNOWN',
    message: error.message || `Request failed with status ${error.status}.`,
    details: [],
    offline: false,
  };
}

/**
 * A single human-readable line for an error, including validation details.
 *
 * Validation failures carry one `details` entry per failing constraint, and the
 * top-level `message` for them is a generic "Validation failed" — so the
 * details are what the user actually needs to see.
 */
export function describeApiError(error: ApiError): string {
  if (error.details.length > 0) {
    return error.details.join(' · ');
  }

  return error.message;
}
