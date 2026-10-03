import type { MaskKeyOptions } from './encryption.types.js';

export const DEFAULT_SUFFIX_LENGTH = 4;
export const MASK_ELLIPSIS = '…';

/**
 * Known API credential prefixes to preserve in masked previews,
 * ordered from longest to shortest match.
 */
export const KNOWN_CREDENTIAL_PREFIXES: readonly string[] = [
  'sk-ant-',
  'sk-proj-',
  'sk-admin-',
  'sk-org-',
  'sk-',
  'gsk_',
  'ghp_',
  'gho_',
  'xoxb-',
  'xoxp-',
  'key-',
];

/**
 * Masks a secret credential for preview and UI display (e.g. `sk-ant-…4f2a`).
 *
 * Requirements & Guarantees:
 * 1. Safe for UI display without decrypting or leaking the underlying credential.
 * 2. Recognised provider prefixes (such as `sk-ant-`, `sk-proj-`, `sk-`) are preserved
 *    only when the string is long enough that prefix and suffix do not overlap.
 * 3. Never reveals more than the intended suffix characters.
 * 4. For very short inputs (length <= suffixLength), no secret characters are revealed at all,
 *    returning only an ellipsis to indicate the presence of a value.
 *
 * @param key The raw plaintext key or credential string to mask.
 * @param options Optional configuration for suffix length and custom prefix.
 * @returns Masked preview string safe for display and storage in `masked_preview`.
 */
export function maskKey(
  key: string | null | undefined,
  options?: MaskKeyOptions,
): string {
  if (!key) {
    return '';
  }

  const suffixLength = options?.suffixLength ?? DEFAULT_SUFFIX_LENGTH;

  // Very short inputs: revealing any suffix characters would expose
  // the entire or majority of the secret. We return only the ellipsis.
  if (key.length <= suffixLength) {
    return MASK_ELLIPSIS;
  }

  // Detect matching prefix
  let matchedPrefix = '';
  if (options?.customPrefix && key.startsWith(options.customPrefix)) {
    matchedPrefix = options.customPrefix;
  } else {
    for (const prefix of KNOWN_CREDENTIAL_PREFIXES) {
      if (key.startsWith(prefix)) {
        matchedPrefix = prefix;
        break;
      }
    }
  }

  const suffix = key.slice(-suffixLength);

  // If a prefix is present, verify that the string is long enough to have
  // at least one masked character between the prefix and the suffix.
  // This prevents overlapping and excessive exposure on short keys.
  if (matchedPrefix && key.length >= matchedPrefix.length + suffixLength + 1) {
    return `${matchedPrefix}${MASK_ELLIPSIS}${suffix}`;
  }

  // Generic key or key too short to safely display the prefix
  return `${MASK_ELLIPSIS}${suffix}`;
}
