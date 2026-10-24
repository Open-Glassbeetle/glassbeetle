/**
 * Standardised error codes for model adapter failures.
 */
export type ModelAdapterErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'INVALID_REQUEST'
  | 'MODEL_NOT_FOUND'
  | 'CONTEXT_LENGTH_EXCEEDED'
  | 'PROVIDER_UNAVAILABLE'
  | 'REQUEST_ABORTED'
  | 'UNSUPPORTED_PROVIDER_KIND'
  | 'UNSUPPORTED_CAPABILITY'
  | 'UNKNOWN_ERROR';

/**
 * Options for constructing a {@link ModelAdapterError}.
 */
export interface ModelAdapterErrorOptions {
  /** Human-readable explanation of the error */
  readonly message: string;
  /** Normalised error code */
  readonly code: ModelAdapterErrorCode;
  /** Suggested HTTP status code */
  readonly statusCode?: number;
  /** Whether the request can be safely retried */
  readonly retryable?: boolean;
  /** The provider kind encountering the error */
  readonly providerKind?: string;
  /** Root underlying error (sanitized; never containing secrets) */
  readonly cause?: unknown;
}

/**
 * Base normalised error thrown by all model adapters.
 *
 * Prevents vendor-specific exception types from leaking into application
 * and orchestration layers.
 */
export class ModelAdapterError extends Error {
  readonly code: ModelAdapterErrorCode;
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly providerKind?: string;

  constructor(options: ModelAdapterErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = this.constructor.name;
    this.code = options.code;
    this.statusCode = options.statusCode ?? 500;
    this.retryable = options.retryable ?? false;
    this.providerKind = options.providerKind;
  }
}

/**
 * Thrown when credentials fail authentication with the provider.
 */
export class AuthenticationError extends ModelAdapterError {
  constructor(message = 'Provider authentication failed. Check credentials.', providerKind?: string) {
    super({
      message,
      code: 'AUTHENTICATION_FAILED',
      statusCode: 401,
      retryable: false,
      providerKind,
    });
  }
}

/**
 * Thrown when provider rate limits or quota are exceeded.
 */
export class RateLimitError extends ModelAdapterError {
  constructor(message = 'Provider rate limit exceeded.', providerKind?: string) {
    super({
      message,
      code: 'RATE_LIMIT_EXCEEDED',
      statusCode: 429,
      retryable: true,
      providerKind,
    });
  }
}

/**
 * Thrown when the model request parameters or format are rejected by the provider.
 */
export class InvalidRequestError extends ModelAdapterError {
  constructor(message: string, providerKind?: string) {
    super({
      message,
      code: 'INVALID_REQUEST',
      statusCode: 400,
      retryable: false,
      providerKind,
    });
  }
}

/**
 * Thrown when the requested model identifier is not offered by the provider.
 */
export class ModelNotFoundError extends ModelAdapterError {
  constructor(modelIdentifier: string, providerKind?: string) {
    super({
      message: `Model "${modelIdentifier}" was not found for provider${providerKind ? ` "${providerKind}"` : ''}.`,
      code: 'MODEL_NOT_FOUND',
      statusCode: 404,
      retryable: false,
      providerKind,
    });
  }
}

/**
 * Thrown when message tokens exceed the model's context window.
 */
export class ContextLengthExceededError extends ModelAdapterError {
  constructor(message = 'Context length exceeded for the specified model.', providerKind?: string) {
    super({
      message,
      code: 'CONTEXT_LENGTH_EXCEEDED',
      statusCode: 400,
      retryable: false,
      providerKind,
    });
  }
}

/**
 * Thrown when the provider network endpoint is unreachable, timed out, or returned 5xx.
 */
export class ProviderUnavailableError extends ModelAdapterError {
  constructor(message = 'Provider service is unavailable or unreachable.', providerKind?: string, cause?: unknown) {
    super({
      message,
      code: 'PROVIDER_UNAVAILABLE',
      statusCode: 503,
      retryable: true,
      providerKind,
      cause,
    });
  }
}

/**
 * Thrown when an in-flight request is aborted via `AbortSignal`.
 */
export class RequestAbortedError extends ModelAdapterError {
  constructor(message = 'The model request was aborted.', providerKind?: string) {
    super({
      message,
      code: 'REQUEST_ABORTED',
      statusCode: 499,
      retryable: false,
      providerKind,
    });
  }
}

/**
 * Thrown when an unknown or unregistered provider kind is requested from the factory.
 */
export class UnsupportedProviderKindError extends ModelAdapterError {
  constructor(kind: string, registeredKinds: readonly string[] = []) {
    const list = registeredKinds.length > 0 ? ` Registered kinds: ${registeredKinds.join(', ')}` : '';
    super({
      message: `Unsupported provider kind "${kind}".${list}`,
      code: 'UNSUPPORTED_PROVIDER_KIND',
      statusCode: 400,
      retryable: false,
      providerKind: kind,
    });
  }
}

/**
 * Thrown when an operation is attempted that the adapter does not support (e.g. streaming or discovery).
 */
export class UnsupportedCapabilityError extends ModelAdapterError {
  constructor(capability: string, providerKind?: string) {
    super({
      message: `Provider${providerKind ? ` "${providerKind}"` : ''} does not support capability: ${capability}.`,
      code: 'UNSUPPORTED_CAPABILITY',
      statusCode: 400,
      retryable: false,
      providerKind,
    });
  }
}
