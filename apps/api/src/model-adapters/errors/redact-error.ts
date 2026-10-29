/**
 * Error redaction and sanitization utilities.
 *
 * Upstream provider error bodies and raw network traces can contain:
 * 1. API keys and bearer tokens
 * 2. Organization, project, and account identifiers
 * 3. Quota and billing numbers
 * 4. Echoed user prompt contents from malformed requests
 *
 * These helpers enforce the strict requirement that raw upstream bodies and
 * sensitive credentials are NEVER serialized to clients, while retaining
 * actionable safe diagnostic messages.
 */

export const REDACTED_MARKER = '[REDACTED]';
export const REDACTED_KEY_MARKER = '[REDACTED_API_KEY]';

// Regex patterns for known API key formats
const OPENAI_KEY_REGEX = /\bsk-[a-zA-Z0-9_-]{20,}\b/g;
const ANTHROPIC_KEY_REGEX = /\bsk-ant-[a-zA-Z0-9_-]{15,}\b/g;
const GOOGLE_KEY_REGEX = /\bAIza[0-9A-Za-z_-]{30,}\b/g;
const BEARER_TOKEN_REGEX = /Bearer\s+[a-zA-Z0-9_.-]+/gi;
const QUERY_PARAM_KEY_REGEX = /([?&](?:key|api[_-]?key|secret|token)=)[^&\s]+/gi;

// Patterns for account, organization, and project identifiers that should not leak
const ORG_IDENTIFIER_REGEX = /\b(?:org-[a-zA-Z0-9]{8,}|organization:\s*[a-zA-Z0-9_-]+)/gi;
const ACCOUNT_IDENTIFIER_REGEX = /\b(?:acc-[a-zA-Z0-9]{8,}|account(?:_id)?:\s*[a-zA-Z0-9_-]+)/gi;
const PROJECT_IDENTIFIER_REGEX = /\b(?:projects\/|project\s+)\d{6,}\b/gi;
const USER_IDENTIFIER_REGEX = /\buser(?:_id)?:\s*[a-zA-Z0-9_-]+\b/gi;

/**
 * Strips secrets, bearer tokens, API keys, and account identifiers from text.
 *
 * @param text - The raw message or text string to redact.
 * @param knownSecrets - Optional array of known plain-text secrets (e.g. configured API keys).
 * @returns Clean text safe for logging and client exposure.
 */
export function redactSecrets(
  text: string,
  knownSecrets?: readonly string[],
): string {
  if (!text) {
    return '';
  }

  let result = text;

  // 1. Redact explicitly known configured secrets
  if (knownSecrets) {
    for (const secret of knownSecrets) {
      if (typeof secret === 'string' && secret.trim().length > 3) {
        result = result.replaceAll(secret, REDACTED_MARKER);
      }
    }
  }

  // 2. Redact known provider key patterns
  result = result
    .replace(ANTHROPIC_KEY_REGEX, REDACTED_KEY_MARKER)
    .replace(OPENAI_KEY_REGEX, REDACTED_KEY_MARKER)
    .replace(GOOGLE_KEY_REGEX, REDACTED_KEY_MARKER)
    .replace(BEARER_TOKEN_REGEX, `Bearer ${REDACTED_MARKER}`)
    .replace(QUERY_PARAM_KEY_REGEX, `$1${REDACTED_MARKER}`);

  // 3. Redact account and org identifiers
  result = result
    .replace(ORG_IDENTIFIER_REGEX, '[REDACTED_ORG]')
    .replace(ACCOUNT_IDENTIFIER_REGEX, '[REDACTED_ACCOUNT]')
    .replace(PROJECT_IDENTIFIER_REGEX, '[REDACTED_PROJECT]')
    .replace(USER_IDENTIFIER_REGEX, '[REDACTED_USER]');

  return result;
}

/**
 * Extracts a user-safe error message from an upstream provider error body.
 *
 * Guarantees:
 * 1. Raw JSON payloads or stack traces are not exposed as the user message.
 * 2. API keys and account IDs are redacted.
 * 3. Echoed prompt bodies are truncated/suppressed.
 * 4. Fallback is applied if no clean message is extracted.
 *
 * @param rawBody - Raw parsed or stringified response body from upstream.
 * @param fallback - Safe default message if parsing fails.
 * @param knownSecrets - Optional array of credentials to redact.
 */
export function extractSafeErrorMessage(
  rawBody: unknown,
  fallback = 'Provider request failed.',
  knownSecrets?: readonly string[],
): string {
  if (!rawBody) {
    return fallback;
  }

  let candidate: string | undefined;

  // Case 1: String body
  if (typeof rawBody === 'string') {
    // If it's a JSON string, try parsing it
    const trimmed = rawBody.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        return extractSafeErrorMessage(JSON.parse(trimmed), fallback, knownSecrets);
      } catch {
        // Not valid JSON, continue with string processing
      }
    }
    candidate = rawBody;
  } else if (typeof rawBody === 'object' && rawBody !== null) {
    const record = rawBody as Record<string, unknown>;

    // Gemini safety block at top-level
    if (
      record.promptFeedback &&
      typeof record.promptFeedback === 'object' &&
      (record.promptFeedback as Record<string, unknown>).blockReason === 'SAFETY'
    ) {
      return 'Generation was blocked by Google Gemini safety filters.';
    }

    // Anthropic / OpenAI nested error: { error: { message: "..." } } or Ollama: { error: "..." }
    if (record.error !== undefined) {
      if (typeof record.error === 'string') {
        candidate = record.error;
      } else if (typeof record.error === 'object' && record.error !== null) {
        const errorObj = record.error as Record<string, unknown>;
        if (typeof errorObj.message === 'string') {
          candidate = errorObj.message;
        }
      }
    }

    // Direct message property: { message: "..." }
    if (!candidate && typeof record.message === 'string') {
      candidate = record.message;
    }

    // Detail property: { detail: "..." }
    if (!candidate && typeof record.detail === 'string') {
      candidate = record.detail;
    }
  }

  if (!candidate || candidate.trim().length === 0) {
    return fallback;
  }

  // Redact any leaked credentials or account identifiers
  let clean = redactSecrets(candidate.trim(), knownSecrets);

  // If the extracted candidate looks like an internal HTML error page or raw JSON blob, use fallback
  if (clean.startsWith('<!DOCTYPE') || clean.startsWith('<html') || clean.startsWith('{"')) {
    return fallback;
  }

  // Cap length to prevent echoed prompt flooding (limit to 300 characters)
  if (clean.length > 300) {
    clean = `${clean.slice(0, 297)}...`;
  }

  return clean;
}

/**
 * Sanitizes an error cause for server-side logging by removing credentials.
 */
export function sanitizeErrorCause(
  cause: unknown,
  knownSecrets?: readonly string[],
): unknown {
  if (!cause) {
    return cause;
  }

  if (cause instanceof Error) {
    const sanitizedMsg = redactSecrets(cause.message, knownSecrets);
    const sanitizedError = new Error(sanitizedMsg);
    sanitizedError.name = cause.name;
    if (cause.stack) {
      sanitizedError.stack = redactSecrets(cause.stack, knownSecrets);
    }
    return sanitizedError;
  }

  if (typeof cause === 'string') {
    return redactSecrets(cause, knownSecrets);
  }

  return cause;
}
