export const REDACTED_TEXT = '[REDACTED]';

/**
 * Regex matching key names that represent secrets, tokens, or credentials.
 */
const SENSITIVE_KEY_REGEX =
  /^(api[-_]?key|secret|password|token|authorization|encrypted[-_]?value|nonce|credentials|private[-_]?key)$/i;

/**
 * Checks whether an object property key is sensitive and requires redaction.
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_REGEX.test(key);
}

/**
 * Recursively creates a copy of an object or data structure with all
 * credential-shaped fields redacted.
 */
export function redactSensitiveData<T>(input: T): T {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === 'string') {
    if (/^bearer\s+/i.test(input)) {
      return `Bearer ${REDACTED_TEXT}` as unknown as T;
    }

    return input;
  }

  if (typeof input !== 'object') {
    return input;
  }

  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    return REDACTED_TEXT as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveData(item)) as unknown as T;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED_TEXT;
    } else {
      result[key] = redactSensitiveData(value);
    }
  }

  return result as T;
}
