import { HttpStatus } from '@nestjs/common';
import type { ApiErrorResponse } from '../../common/http/api-error.js';
import { titleForStatus } from '../../common/http/api-error.js';
import { nowIso } from '../../common/persistence/timestamps.js';
import type { StreamErrorPayload } from '../types/streaming.js';
import {
  AuthenticationError,
  AuthorizationError,
  ConnectionFailedError,
  ContentFilteredError,
  ContextLengthExceededError,
  InvalidRequestError,
  ModelNotFoundError,
  ModelAdapterError,
  type ModelAdapterErrorCode,
  ProviderUnavailableError,
  RateLimitError,
  RequestAbortedError,
  RequestTimeoutError,
  UnknownModelAdapterError,
} from './model-adapter-error.js';
import {
  extractSafeErrorMessage,
  redactSecrets,
  sanitizeErrorCause,
} from './redact-error.js';

/**
 * Maps a normalised {@link ModelAdapterErrorCode} to its canonical HTTP status code.
 *
 * ### Justification by Error Code:
 *
 * 1. **AUTHENTICATION_FAILED -> 502 Bad Gateway**:
 *    The client sent a valid request to Glassbeetle. The failure occurred between
 *    Glassbeetle and the external upstream provider due to an invalid or expired
 *    upstream API credential. Surfacing 401 Unauthorized to the client would
 *    erroneously imply that the user's Glassbeetle session expired, prompting an
 *    unexpected logout or login redirect in the Angular UI.
 *
 * 2. **AUTHORIZATION_FAILED -> 502 Bad Gateway**:
 *    The user is authorized within Glassbeetle, but the configured upstream credential
 *    lacks permission for the specific model or feature tier. Surfacing 403 Forbidden
 *    would imply the user lacks permission for Glassbeetle itself.
 *
 * 3. **RATE_LIMIT_EXCEEDED -> 429 Too Many Requests**:
 *    Standard HTTP status signaling capacity or quota exhaustion. Allows UI and
 *    orchestration to back off or show retry countdown.
 *
 * 4. **INVALID_REQUEST -> 400 Bad Request**:
 *    A hyperparameter or parameter structure sent by the client was rejected.
 *
 * 5. **MODEL_NOT_FOUND -> 404 Not Found**:
 *    The requested model identifier does not exist on the provider or has not been
 *    pulled locally in Ollama.
 *
 * 6. **CONTENT_FILTERED -> 422 Unprocessable Entity**:
 *    The request was syntactically valid, but semantic content was blocked by
 *    provider safety, harm, or moderation filters.
 *
 * 7. **CONTEXT_LENGTH_EXCEEDED -> 413 Payload Too Large**:
 *    The prompt and conversation history exceeded the model context window.
 *    Distinguishable from 400 so chat orchestration can automatically trigger
 *    context compaction (`chats.context_summary`).
 *
 * 8. **PROVIDER_UNAVAILABLE -> 503 Service Unavailable**:
 *    Upstream returned 5xx, maintenance, or overload (e.g. Anthropic 529). Transient
 *    and retryable.
 *
 * 9. **CONNECTION_FAILED -> 502 Bad Gateway**:
 *    Network connection refused or unreachable (e.g. Ollama daemon not running at
 *    localhost:11434).
 *
 * 10. **REQUEST_TIMEOUT -> 504 Gateway Timeout**:
 *     Provider response exceeded deadline.
 *
 * 11. **REQUEST_ABORTED -> 499 Client Closed Request**:
 *     Client aborted generation (e.g. closed tab or clicked Stop). Normal user
 *     behavior; never logged as a failure.
 *
 * 12. **UNSUPPORTED_PROVIDER_KIND -> 400 Bad Request**:
 *     Unknown provider kind requested.
 *
 * 13. **UNSUPPORTED_CAPABILITY -> 400 Bad Request**:
 *     Requested operation not supported by adapter.
 *
 * 14. **UNKNOWN_ERROR -> 502 Bad Gateway**:
 *     Unclassified upstream failure.
 */
export function mapErrorCodeToHttpStatus(code: ModelAdapterErrorCode): number {
  switch (code) {
    case 'AUTHENTICATION_FAILED':
    case 'AUTHORIZATION_FAILED':
    case 'CONNECTION_FAILED':
    case 'UNKNOWN_ERROR':
      return HttpStatus.BAD_GATEWAY; // 502

    case 'RATE_LIMIT_EXCEEDED':
      return HttpStatus.TOO_MANY_REQUESTS; // 429

    case 'INVALID_REQUEST':
    case 'UNSUPPORTED_PROVIDER_KIND':
    case 'UNSUPPORTED_CAPABILITY':
      return HttpStatus.BAD_REQUEST; // 400

    case 'MODEL_NOT_FOUND':
      return HttpStatus.NOT_FOUND; // 404

    case 'CONTENT_FILTERED':
      return HttpStatus.UNPROCESSABLE_ENTITY; // 422

    case 'CONTEXT_LENGTH_EXCEEDED':
      return HttpStatus.PAYLOAD_TOO_LARGE; // 413

    case 'PROVIDER_UNAVAILABLE':
      return HttpStatus.SERVICE_UNAVAILABLE; // 503

    case 'REQUEST_TIMEOUT':
      return HttpStatus.GATEWAY_TIMEOUT; // 504

    case 'REQUEST_ABORTED':
      return 499; // Client Closed Request
  }
}

/**
 * Transforms a {@link ModelAdapterError} into the standardized {@link ApiErrorResponse}
 * envelope returned by HTTP endpoints.
 *
 * @param error - The normalised model adapter error.
 * @param path - The request path where the error occurred.
 */
export function toApiErrorResponse(
  error: ModelAdapterError,
  path: string,
): ApiErrorResponse {
  return {
    statusCode: error.statusCode,
    error: titleForStatus(error.statusCode),
    code: error.code,
    message: error.message,
    path,
    timestamp: nowIso(),
  };
}

/**
 * Transforms any error occurring mid-stream into the wire-safe {@link StreamErrorPayload}.
 *
 * Guarantees:
 * - Credentials and raw upstream error bodies are strictly omitted.
 * - Conforms to the realtime transport SSE specification.
 *
 * @param error - The error to format for in-band streaming.
 */
export function toStreamErrorPayload(error: unknown): StreamErrorPayload {
  if (error instanceof ModelAdapterError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.providerKind ? { providerKind: error.providerKind } : {}),
      ...(error.modelIdentifier ? { model: error.modelIdentifier } : {}),
      ...(error.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: 'An unexpected error occurred during generation.',
    retryable: false,
  };
}

/**
 * Input configuration for normalising an upstream provider error.
 */
export interface NormalizeProviderErrorInput {
  /** The provider kind encountering the failure (e.g. 'anthropic', 'openai', 'google', 'ollama') */
  readonly providerKind: string;
  /** HTTP response status code from upstream if available */
  readonly status?: number;
  /** Raw parsed or unparsed response body */
  readonly errorBody?: unknown;
  /** Raw error message if known */
  readonly rawMessage?: string;
  /** Target model identifier */
  readonly model?: string;
  /** Root cause error (e.g. Fetch error, AbortError, or Network error) */
  readonly cause?: unknown;
  /** Optional response headers or Retry-After header */
  readonly headers?: Record<string, string | string[] | undefined> | Headers;
  /** Known secrets to redact */
  readonly knownSecrets?: readonly string[];
}

/**
 * Helper function that adapters can use to normalise raw network or upstream
 * responses into typed {@link ModelAdapterError} instances.
 */
export function normalizeProviderError(
  input: NormalizeProviderErrorInput,
): ModelAdapterError {
  const { providerKind, status, errorBody, model, cause, knownSecrets } = input;
  const sanitizedCause = sanitizeErrorCause(cause, knownSecrets);

  // 1. If it's already a ModelAdapterError, return it directly
  if (cause instanceof ModelAdapterError) {
    return cause;
  }

  // 2. Client cancellation / AbortSignal
  if (
    status === 499 ||
    (cause instanceof Error && cause.name === 'AbortError') ||
    (typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'ABORT_ERR')
  ) {
    return new RequestAbortedError(
      'The model request was aborted.',
      providerKind,
      { cause: sanitizedCause, modelIdentifier: model },
    );
  }

  // 3. Network connection failures (e.g. daemon down or network unreachable)
  const causeCode =
    typeof cause === 'object' && cause !== null
      ? (cause as { code?: unknown }).code
      : undefined;
  const causeMsg = cause instanceof Error ? cause.message : String(cause ?? '');

  if (
    causeCode === 'ECONNREFUSED' ||
    causeCode === 'ENOTFOUND' ||
    causeCode === 'ECONNRESET' ||
    causeCode === 'EAI_AGAIN' ||
    causeMsg.toLowerCase().includes('fetch failed') ||
    causeMsg.toLowerCase().includes('network error')
  ) {
    const isLocalOllama = providerKind === 'ollama';
    const message = isLocalOllama
      ? 'Ollama is not running at http://localhost:11434. Please ensure the Ollama daemon is started.'
      : `Failed to connect to ${providerKind} endpoint. Check network connectivity.`;

    return new ConnectionFailedError(message, providerKind, sanitizedCause, {
      modelIdentifier: model,
    });
  }

  // 4. Timeout
  if (
    status === 504 ||
    causeCode === 'ETIMEDOUT' ||
    causeMsg.toLowerCase().includes('timed out') ||
    causeMsg.toLowerCase().includes('timeout')
  ) {
    return new RequestTimeoutError(
      `Request to ${providerKind} timed out.`,
      providerKind,
      sanitizedCause,
      { modelIdentifier: model },
    );
  }

  // Extract a user-safe message from errorBody or rawMessage
  const extracted =
    input.rawMessage ??
    extractSafeErrorMessage(errorBody, 'Provider request failed.', knownSecrets);
  const safeMessage = redactSecrets(extracted, knownSecrets);
  const lowerMsg = safeMessage.toLowerCase();

  // 5. Rate limit (429 or quota / rate limit keywords)
  if (
    status === 429 ||
    lowerMsg.includes('rate limit') ||
    lowerMsg.includes('resource_exhausted') ||
    lowerMsg.includes('insufficient_quota') ||
    lowerMsg.includes('quota exceeded')
  ) {
    let retryAfterSeconds: number | undefined;

    // Try extracting from Retry-After header
    if (input.headers) {
      const headerVal =
        input.headers instanceof Headers
          ? input.headers.get('retry-after')
          : input.headers['retry-after'];
      if (typeof headerVal === 'string') {
        const parsed = parseInt(headerVal, 10);
        if (!isNaN(parsed) && parsed > 0) {
          retryAfterSeconds = parsed;
        }
      }
    }

    return new RateLimitError(
      `${providerKind} rate limit exceeded: ${safeMessage}`,
      providerKind,
      { retryAfterSeconds, cause: sanitizedCause, modelIdentifier: model },
    );
  }

  // 6. Authentication & Authorization (401 / 403)
  if (
    status === 401 ||
    status === 403 ||
    lowerMsg.includes('invalid_api_key') ||
    lowerMsg.includes('unauthenticated') ||
    lowerMsg.includes('api key not valid')
  ) {
    if (
      status === 403 ||
      lowerMsg.includes('permission_denied') ||
      lowerMsg.includes('unauthorized model') ||
      lowerMsg.includes('access not granted')
    ) {
      return new AuthorizationError(
        `${providerKind} authorization failed: ${safeMessage}`,
        providerKind,
        { cause: sanitizedCause, modelIdentifier: model },
      );
    }

    return new AuthenticationError(
      `${providerKind} authentication failed: ${safeMessage}`,
      providerKind,
      { cause: sanitizedCause, modelIdentifier: model },
    );
  }

  // 7. Model not found (404 or missing/not pulled)
  if (
    status === 404 ||
    lowerMsg.includes('not found') ||
    lowerMsg.includes('try pulling') ||
    lowerMsg.includes('does not exist')
  ) {
    let message: string;
    if (providerKind === 'ollama' && model) {
      message = `Model "${model}" is not installed in Ollama. Run 'ollama pull ${model}' to install it.`;
    } else {
      message = `Model "${model ?? 'unknown'}" was not found for provider "${providerKind}".`;
    }

    return new ModelNotFoundError(model ?? 'unknown', providerKind, {
      message,
      cause: sanitizedCause,
    });
  }

  // 8. Content / Safety filtered (422 or Gemini safety block)
  if (
    status === 422 ||
    lowerMsg.includes('safety') ||
    lowerMsg.includes('blocked by safety') ||
    lowerMsg.includes('content filter') ||
    lowerMsg.includes('harm_category')
  ) {
    return new ContentFilteredError(
      `Generation was blocked by ${providerKind} safety or moderation filters.`,
      providerKind,
      { cause: sanitizedCause, modelIdentifier: model },
    );
  }

  // 9. Context length exceeded (413 or context tokens message in 400)
  if (
    status === 413 ||
    (status === 400 &&
      (lowerMsg.includes('context length') ||
        lowerMsg.includes('prompt is too long') ||
        lowerMsg.includes('maximum token') ||
        lowerMsg.includes('too many tokens') ||
        lowerMsg.includes('input token limit')))
  ) {
    return new ContextLengthExceededError(
      `${providerKind} context length exceeded: ${safeMessage}`,
      providerKind,
      { cause: sanitizedCause, modelIdentifier: model },
    );
  }

  // 10. Invalid request (400)
  if (status === 400) {
    return new InvalidRequestError(
      `${providerKind} rejected request: ${safeMessage}`,
      providerKind,
      { cause: sanitizedCause, modelIdentifier: model },
    );
  }

  // 11. Upstream unavailable (500, 502, 503, 529)
  if (status === 529 || (status !== undefined && status >= 500)) {
    return new ProviderUnavailableError(
      `${providerKind} service unavailable (HTTP ${status}): ${safeMessage}`,
      providerKind,
      sanitizedCause,
      { modelIdentifier: model },
    );
  }

  // 12. Fallback for unknown errors
  return new UnknownModelAdapterError(
    `${providerKind} error: ${safeMessage}`,
    providerKind,
    sanitizedCause,
    { modelIdentifier: model },
  );
}
