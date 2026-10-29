/**
 * Standardised error codes for model adapter failures.
 *
 * Every provider adapter maps its specific network, status, and payload
 * failures into one of these canonical codes.
 */
export type ModelAdapterErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'AUTHORIZATION_FAILED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'INVALID_REQUEST'
  | 'MODEL_NOT_FOUND'
  | 'CONTENT_FILTERED'
  | 'CONTEXT_LENGTH_EXCEEDED'
  | 'PROVIDER_UNAVAILABLE'
  | 'CONNECTION_FAILED'
  | 'REQUEST_TIMEOUT'
  | 'REQUEST_ABORTED'
  | 'UNSUPPORTED_PROVIDER_KIND'
  | 'UNSUPPORTED_CAPABILITY'
  | 'UNKNOWN_ERROR';

/**
 * Options for constructing a {@link ModelAdapterError}.
 */
export interface ModelAdapterErrorOptions {
  /** User-safe human-readable explanation of the error */
  readonly message: string;
  /** Normalised machine-readable error code */
  readonly code: ModelAdapterErrorCode;
  /** Suggested HTTP status code for REST representation */
  readonly statusCode?: number;
  /** Whether the request can be safely retried */
  readonly retryable?: boolean;
  /** The provider kind encountering the error */
  readonly providerKind?: string;
  /** Model identifier involved in the failure */
  readonly modelIdentifier?: string;
  /** Suggested retry delay in seconds if provided by upstream (e.g. RateLimit) */
  readonly retryAfterSeconds?: number;
  /** Whether the error represents client cancellation (normal user behavior, not an error to log) */
  readonly isCancellation?: boolean;
  /** Root underlying error (retained for server-side logging; never serialised to client) */
  readonly cause?: unknown;
}

/**
 * Base normalised error thrown by all model adapters.
 *
 * Prevents vendor-specific exception types and raw upstream error bodies
 * from leaking into application, HTTP, and orchestration layers.
 */
export class ModelAdapterError extends Error {
  readonly code: ModelAdapterErrorCode;
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly providerKind?: string;
  readonly modelIdentifier?: string;
  readonly retryAfterSeconds?: number;
  readonly isCancellation: boolean;

  /**
   * Alias for `modelIdentifier` to align with streaming and adapter naming.
   */
  get model(): string | undefined {
    return this.modelIdentifier;
  }

  constructor(options: ModelAdapterErrorOptions) {
    super(options.message);
    this.name = this.constructor.name;
    this.code = options.code;
    this.statusCode = options.statusCode ?? 500;
    this.retryable = options.retryable ?? false;
    this.providerKind = options.providerKind;
    this.modelIdentifier = options.modelIdentifier;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.isCancellation = options.isCancellation ?? false;

    // Retain cause for server-side logging without serializing to client.
    // Making it non-enumerable ensures Object.keys(), { ...err }, and JSON
    // serialization will NEVER expose raw upstream errors or credentials.
    if (options.cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        value: options.cause,
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
  }

  /**
   * Safe serialization format.
   *
   * Crucial guarantee: `cause`, credentials, and raw upstream bodies are NEVER
   * included in the serialized output.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      retryable: this.retryable,
      ...(this.providerKind !== undefined ? { providerKind: this.providerKind } : {}),
      ...(this.modelIdentifier !== undefined
        ? { modelIdentifier: this.modelIdentifier, model: this.modelIdentifier }
        : {}),
      ...(this.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: this.retryAfterSeconds }
        : {}),
      ...(this.isCancellation ? { isCancellation: true } : {}),
    };
  }
}

/**
 * Thrown when credentials fail authentication with the provider.
 *
 * HTTP 502 Bad Gateway: Upstream credential failure is user configuration error
 * towards the external service, not a failure of the user's Glassbeetle API session.
 */
export class AuthenticationError extends ModelAdapterError {
  constructor(
    message = 'Provider authentication failed. Check credentials.',
    providerKind?: string,
    options?: { cause?: unknown; modelIdentifier?: string },
  ) {
    super({
      message,
      code: 'AUTHENTICATION_FAILED',
      statusCode: 502,
      retryable: false,
      providerKind,
      cause: options?.cause,
      modelIdentifier: options?.modelIdentifier,
    });
  }
}

/**
 * Thrown when credentials are authenticated but lack permissions for the requested model or tier.
 *
 * HTTP 502 Bad Gateway: Upstream authorization failure.
 */
export class AuthorizationError extends ModelAdapterError {
  constructor(
    message = 'Provider authorization failed. Credential lacks permission for this model or tier.',
    providerKind?: string,
    options?: { cause?: unknown; modelIdentifier?: string },
  ) {
    super({
      message,
      code: 'AUTHORIZATION_FAILED',
      statusCode: 502,
      retryable: false,
      providerKind,
      cause: options?.cause,
      modelIdentifier: options?.modelIdentifier,
    });
  }
}

/**
 * Thrown when provider rate limits or quota are exceeded.
 *
 * HTTP 429 Too Many Requests: Signals capacity exhaustion. Retryable.
 */
export class RateLimitError extends ModelAdapterError {
  constructor(
    message = 'Provider rate limit exceeded.',
    providerKind?: string,
    options?: { retryAfterSeconds?: number; cause?: unknown; modelIdentifier?: string },
  ) {
    super({
      message,
      code: 'RATE_LIMIT_EXCEEDED',
      statusCode: 429,
      retryable: true,
      providerKind,
      retryAfterSeconds: options?.retryAfterSeconds,
      cause: options?.cause,
      modelIdentifier: options?.modelIdentifier,
    });
  }
}

/**
 * Thrown when the model request parameters or format are rejected by the provider.
 *
 * HTTP 400 Bad Request: Malformed prompt or invalid hyperparameter.
 */
export class InvalidRequestError extends ModelAdapterError {
  constructor(
    message: string,
    providerKind?: string,
    options?: { cause?: unknown; modelIdentifier?: string },
  ) {
    super({
      message,
      code: 'INVALID_REQUEST',
      statusCode: 400,
      retryable: false,
      providerKind,
      cause: options?.cause,
      modelIdentifier: options?.modelIdentifier,
    });
  }
}

/**
 * Thrown when the requested model identifier is not offered or not installed.
 *
 * HTTP 404 Not Found: Model does not exist or has not been pulled.
 */
export class ModelNotFoundError extends ModelAdapterError {
  constructor(
    modelIdentifier: string,
    providerKind?: string,
    options?: { message?: string; cause?: unknown },
  ) {
    const message =
      options?.message ??
      `Model "${modelIdentifier}" was not found for provider${providerKind ? ` "${providerKind}"` : ''}.`;
    super({
      message,
      code: 'MODEL_NOT_FOUND',
      statusCode: 404,
      retryable: false,
      providerKind,
      modelIdentifier,
      cause: options?.cause,
    });
  }
}

/**
 * Thrown when output generation was blocked by provider safety, moderation, or harm filters.
 *
 * HTTP 422 Unprocessable Entity: Syntactically valid request, but content blocked.
 */
export class ContentFilteredError extends ModelAdapterError {
  constructor(
    message = 'Generation was blocked by safety or content moderation filters.',
    providerKind?: string,
    options?: { cause?: unknown; modelIdentifier?: string },
  ) {
    super({
      message,
      code: 'CONTENT_FILTERED',
      statusCode: 422,
      retryable: false,
      providerKind,
      cause: options?.cause,
      modelIdentifier: options?.modelIdentifier,
    });
  }
}

/**
 * Thrown when message tokens exceed the model's maximum context window.
 *
 * HTTP 413 Payload Too Large: Distinguishable so orchestration can trigger compaction.
 */
export class ContextLengthExceededError extends ModelAdapterError {
  constructor(
    message = 'Context length exceeded for the specified model.',
    providerKind?: string,
    options?: { cause?: unknown; modelIdentifier?: string },
  ) {
    super({
      message,
      code: 'CONTEXT_LENGTH_EXCEEDED',
      statusCode: 413,
      retryable: false,
      providerKind,
      cause: options?.cause,
      modelIdentifier: options?.modelIdentifier,
    });
  }
}

/**
 * Thrown when the provider returns a transient 5xx or capacity overload (e.g. Anthropic 529).
 *
 * HTTP 503 Service Unavailable: Retryable server error.
 */
export class ProviderUnavailableError extends ModelAdapterError {
  constructor(
    message = 'Provider service is unavailable or overloaded.',
    providerKind?: string,
    cause?: unknown,
    options?: { modelIdentifier?: string },
  ) {
    super({
      message,
      code: 'PROVIDER_UNAVAILABLE',
      statusCode: 503,
      retryable: true,
      providerKind,
      cause,
      modelIdentifier: options?.modelIdentifier,
    });
  }
}

/**
 * Thrown when network connection to the provider cannot be established.
 *
 * HTTP 502 Bad Gateway: Upstream connection failed (e.g. Ollama daemon not running).
 */
export class ConnectionFailedError extends ModelAdapterError {
  constructor(
    message = 'Failed to connect to provider endpoint.',
    providerKind?: string,
    cause?: unknown,
    options?: { modelIdentifier?: string },
  ) {
    super({
      message,
      code: 'CONNECTION_FAILED',
      statusCode: 502,
      retryable: true,
      providerKind,
      cause,
      modelIdentifier: options?.modelIdentifier,
    });
  }
}

/**
 * Thrown when the provider network request times out.
 *
 * HTTP 504 Gateway Timeout: Gateway deadline exceeded.
 */
export class RequestTimeoutError extends ModelAdapterError {
  constructor(
    message = 'Provider request timed out.',
    providerKind?: string,
    cause?: unknown,
    options?: { modelIdentifier?: string },
  ) {
    super({
      message,
      code: 'REQUEST_TIMEOUT',
      statusCode: 504,
      retryable: true,
      providerKind,
      cause,
      modelIdentifier: options?.modelIdentifier,
    });
  }
}

/**
 * Thrown when an in-flight request is cancelled/aborted via `AbortSignal`.
 *
 * HTTP 499 Client Closed Request: Distinguishable user cancellation; not a failure.
 */
export class RequestAbortedError extends ModelAdapterError {
  constructor(
    message = 'The model request was aborted.',
    providerKind?: string,
    options?: { cause?: unknown; modelIdentifier?: string },
  ) {
    super({
      message,
      code: 'REQUEST_ABORTED',
      statusCode: 499,
      retryable: false,
      providerKind,
      cause: options?.cause,
      modelIdentifier: options?.modelIdentifier,
      isCancellation: true,
    });
  }
}

/**
 * Alias for `RequestAbortedError` for terminology alignment.
 */
export class RequestCancelledError extends RequestAbortedError {
  constructor(
    message = 'The model request was cancelled.',
    providerKind?: string,
    options?: { cause?: unknown; modelIdentifier?: string },
  ) {
    super(message, providerKind, options);
  }
}

/**
 * Thrown when an unknown or unclassified provider failure occurs.
 *
 * HTTP 502 Bad Gateway.
 */
export class UnknownModelAdapterError extends ModelAdapterError {
  constructor(
    message = 'An unknown provider error occurred.',
    providerKind?: string,
    cause?: unknown,
    options?: { modelIdentifier?: string },
  ) {
    super({
      message,
      code: 'UNKNOWN_ERROR',
      statusCode: 502,
      retryable: false,
      providerKind,
      cause,
      modelIdentifier: options?.modelIdentifier,
    });
  }
}

/**
 * Thrown when an unknown or unregistered provider kind is requested from the factory.
 *
 * HTTP 400 Bad Request.
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
 *
 * HTTP 400 Bad Request.
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
