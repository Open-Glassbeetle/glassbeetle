import { randomFillSync } from 'node:crypto';

/**
 * Number of bytes in a UUID.
 */
const UUID_BYTE_LENGTH = 16;

/**
 * The timestamp occupies the first 48 bits (6 bytes) of a UUIDv7.
 */
const TIMESTAMP_BYTE_LENGTH = 6;

/**
 * Generates a resource identifier.
 *
 * Every table in `data/` declares `id TEXT PRIMARY KEY` without prescribing a
 * format. We use UUIDv7 (RFC 9562): the leading 48 bits are a big-endian Unix
 * millisecond timestamp, so identifiers sort lexicographically in creation
 * order. That makes `ORDER BY id` a usable, stable tiebreaker for pagination
 * without needing an index on `created_at` — something a random UUIDv4 cannot
 * offer.
 *
 * Two identifiers generated within the same millisecond are ordered by their
 * random component rather than by generation order. Ordering between them is
 * therefore arbitrary, but it is *stable*, which is all pagination requires.
 */
export function newId(): string {
  const bytes = new Uint8Array(UUID_BYTE_LENGTH);

  // Bytes 0-5: Unix timestamp in milliseconds, big-endian.
  let timestamp = Date.now();
  for (let index = TIMESTAMP_BYTE_LENGTH - 1; index >= 0; index -= 1) {
    bytes[index] = timestamp & 0xff;
    timestamp = Math.floor(timestamp / 256);
  }

  // Bytes 6-15: random.
  randomFillSync(bytes, TIMESTAMP_BYTE_LENGTH);

  // Byte 6, high nibble: version 7.
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // Byte 8, two high bits: RFC 9562 variant (0b10).
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return formatUuid(bytes);
}

/**
 * Renders 16 bytes in canonical 8-4-4-4-12 hyphenated form.
 */
function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
