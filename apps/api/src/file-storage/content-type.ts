import {
  FilePayloadTooLargeError,
  UnsupportedMediaTypeError,
} from './file-storage.errors.js';
import type {
  DetectedContentType,
  FileValidationOptions,
} from './file-storage.types.js';

/**
 * Mapping of canonical MIME types to default file extensions.
 */
export const MIME_TO_EXTENSION: Record<string, string> = {
  // Images
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'image/x-icon': '.ico',

  // Documents & Archives
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'application/gzip': '.gz',
  'application/x-tar': '.tar',
  'application/vnd.sqlite3': '.db',
  'application/x-sqlite3': '.db',

  // Audio & Video
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',

  // Text & Code
  'application/json': '.json',
  'text/html': '.html',
  'application/xml': '.xml',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',

  // Binary fallback
  'application/octet-stream': '.bin',
};

/**
 * Normalizes MIME type aliases to their canonical representation.
 */
export function normalizeMimeType(mime: string): string {
  const lower = mime.trim().toLowerCase();
  switch (lower) {
    case 'image/jpg':
      return 'image/jpeg';
    case 'image/x-png':
      return 'image/png';
    case 'image/vnd.microsoft.icon':
      return 'image/x-icon';
    case 'application/x-gzip':
    case 'application/x-gunzip':
    case 'application/gzipped':
    case 'gzip':
      return 'application/gzip';
    case 'application/x-zip':
    case 'application/x-zip-compressed':
      return 'application/zip';
    case 'application/x-sqlite3':
    case 'application/sqlite3':
    case 'application/x-sqlite':
      return 'application/vnd.sqlite3';
    case 'audio/mp3':
      return 'audio/mpeg';
    case 'text/x-markdown':
      return 'text/markdown';
    default:
      return lower;
  }
}

/**
 * Returns the canonical file extension for a given MIME type.
 */
export function getExtensionForMime(mime: string): string {
  const normalized = normalizeMimeType(mime);
  return MIME_TO_EXTENSION[normalized] ?? '.bin';
}

/**
 * Sniffs the content type of a file based solely on its actual byte content.
 *
 * Never relies on client-supplied headers or filename extensions.
 */
export function detectContentType(
  data: Buffer | Uint8Array,
): DetectedContentType {
  const buf = Buffer.isBuffer(data)
    ? data
    : Buffer.from(data.buffer, data.byteOffset, data.byteLength);

  if (buf.length === 0) {
    return { mime: 'application/octet-stream', extension: '.bin' };
  }

  // 1. JPEG: FF D8 FF
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return { mime: 'image/jpeg', extension: '.jpg' };
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A (\x89PNG\r\n\x1a\n)
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { mime: 'image/png', extension: '.png' };
  }

  // 3. GIF: GIF87a or GIF89a
  if (
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return { mime: 'image/gif', extension: '.gif' };
  }

  // 4. WebP or WAV (RIFF header)
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46
  ) {
    const format = buf.subarray(8, 12).toString('ascii');
    if (format === 'WEBP') {
      return { mime: 'image/webp', extension: '.webp' };
    }
    if (format === 'WAVE') {
      return { mime: 'audio/wav', extension: '.wav' };
    }
  }

  // 5. AVIF / MP4 (ISO Base Media File Format - ftyp box)
  if (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('ascii');
    if (
      brand.startsWith('avif') ||
      brand.startsWith('avis') ||
      brand.startsWith('mif1') ||
      brand.startsWith('msf1')
    ) {
      return { mime: 'image/avif', extension: '.avif' };
    }
    return { mime: 'video/mp4', extension: '.mp4' };
  }

  // 6. BMP: BM
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) {
    return { mime: 'image/bmp', extension: '.bmp' };
  }

  // 7. TIFF: II*\0 or MM\0*
  if (
    buf.length >= 4 &&
    ((buf[0] === 0x49 &&
      buf[1] === 0x49 &&
      buf[2] === 0x2a &&
      buf[3] === 0x00) ||
      (buf[0] === 0x4d &&
        buf[1] === 0x4d &&
        buf[2] === 0x00 &&
        buf[3] === 0x2a))
  ) {
    return { mime: 'image/tiff', extension: '.tiff' };
  }

  // 8. ICO: 00 00 01 00
  if (
    buf.length >= 4 &&
    buf[0] === 0x00 &&
    buf[1] === 0x00 &&
    buf[2] === 0x01 &&
    buf[3] === 0x00
  ) {
    return { mime: 'image/x-icon', extension: '.ico' };
  }

  // 9. PDF: %PDF-
  if (
    buf.length >= 4 &&
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46
  ) {
    return { mime: 'application/pdf', extension: '.pdf' };
  }

  // 10. GZIP: 1F 8B
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    return { mime: 'application/gzip', extension: '.gz' };
  }

  // 11. ZIP: PK\x03\x04 or PK\x05\x06 or PK\x07\x08
  if (
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07) &&
    (buf[3] === 0x04 || buf[3] === 0x06 || buf[3] === 0x08)
  ) {
    return { mime: 'application/zip', extension: '.zip' };
  }

  // 12. SQLite 3: "SQLite format 3\0"
  if (buf.length >= 16) {
    const sqliteHeader = 'SQLite format 3\0';
    if (buf.subarray(0, 16).toString('utf-8') === sqliteHeader) {
      return { mime: 'application/vnd.sqlite3', extension: '.db' };
    }
  }

  // 13. TAR: "ustar" at offset 257
  if (
    buf.length >= 262 &&
    buf.subarray(257, 262).toString('ascii').startsWith('ustar')
  ) {
    return { mime: 'application/x-tar', extension: '.tar' };
  }

  // 14. OGG: "OggS"
  if (
    buf.length >= 4 &&
    buf[0] === 0x4f &&
    buf[1] === 0x67 &&
    buf[2] === 0x67 &&
    buf[3] === 0x53
  ) {
    return { mime: 'audio/ogg', extension: '.ogg' };
  }

  // 15. WebM / MKV: 1A 45 DF A3 (EBML ID)
  if (
    buf.length >= 4 &&
    buf[0] === 0x1a &&
    buf[1] === 0x45 &&
    buf[2] === 0xdf &&
    buf[3] === 0xa3
  ) {
    return { mime: 'video/webm', extension: '.webm' };
  }

  // 16. MP3: ID3 or frame sync FF FB / FF F3 / FF F2
  if (
    buf.length >= 3 &&
    buf[0] === 0x49 &&
    buf[1] === 0x44 &&
    buf[2] === 0x33
  ) {
    return { mime: 'audio/mpeg', extension: '.mp3' };
  }
  if (
    buf.length >= 2 &&
    buf[0] === 0xff &&
    (buf[1] === 0xfb || buf[1] === 0xf3 || buf[1] === 0xf2)
  ) {
    return { mime: 'audio/mpeg', extension: '.mp3' };
  }

  // 17. Text / XML / SVG / HTML / JSON detection
  const textSample = extractTextSample(buf);
  if (textSample !== null) {
    const trimmed = textSample.trim();
    const lower = trimmed.toLowerCase();

    // SVG: contains <svg tag (with XML or DOCTYPE or bare <svg)
    if (
      (lower.includes('<svg') &&
        (lower.startsWith('<?xml') ||
          lower.startsWith('<!doctype svg') ||
          lower.startsWith('<svg'))) ||
      (lower.startsWith('<svg') && lower.includes('xmlns'))
    ) {
      return { mime: 'image/svg+xml', extension: '.svg' };
    }

    // HTML: starts with <!DOCTYPE html or <html
    if (lower.startsWith('<!doctype html') || lower.startsWith('<html')) {
      return { mime: 'text/html', extension: '.html' };
    }

    // XML: starts with <?xml
    if (lower.startsWith('<?xml')) {
      return { mime: 'application/xml', extension: '.xml' };
    }

    // JSON: starts with { or [ and parses successfully
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        JSON.parse(trimmed);
        return { mime: 'application/json', extension: '.json' };
      } catch {
        // Not valid JSON, fall through to text/plain
      }
    }

    // General plain text
    return { mime: 'text/plain', extension: '.txt' };
  }

  // Default fallback: binary stream
  return { mime: 'application/octet-stream', extension: '.bin' };
}

/**
 * Checks if the buffer starts with valid UTF-8 text and extracts a sample string,
 * or returns null if binary / control characters are found.
 */
function extractTextSample(buf: Buffer): string | null {
  // Check up to the first 4096 bytes
  const limit = Math.min(buf.length, 4096);
  let startOffset = 0;

  // Skip UTF-8 BOM if present (EF BB BF)
  if (
    buf.length >= 3 &&
    buf[0] === 0xef &&
    buf[1] === 0xbb &&
    buf[2] === 0xbf
  ) {
    startOffset = 3;
  }

  let nonPrintableCount = 0;
  for (let i = startOffset; i < limit; i += 1) {
    const byte = buf[i];
    // NUL byte is definitely binary
    if (byte === 0x00) {
      return null;
    }
    // Control characters other than TAB (0x09), LF (0x0A), CR (0x0D)
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      nonPrintableCount += 1;
      if (nonPrintableCount > 2) {
        return null;
      }
    }
  }

  try {
    const text = buf.subarray(startOffset, limit).toString('utf-8');
    return text;
  } catch {
    return null;
  }
}

/**
 * Validates a file's byte content against size and MIME constraints.
 */
export function validateFile(
  data: Buffer | Uint8Array,
  options?: FileValidationOptions,
): DetectedContentType {
  const size = data.byteLength;

  if (options?.maxBytes !== undefined && size > options.maxBytes) {
    throw new FilePayloadTooLargeError(options.maxBytes, size);
  }

  const detected = detectContentType(data);

  if (options?.allowedMimeTypes && options.allowedMimeTypes.length > 0) {
    const normalizedAllowed = options.allowedMimeTypes.map((m) =>
      normalizeMimeType(m),
    );
    const normalizedDetected = normalizeMimeType(detected.mime);

    const isAllowed = normalizedAllowed.some((allowed) => {
      if (allowed === '*/*' || allowed === normalizedDetected) {
        return true;
      }
      if (allowed.endsWith('/*')) {
        const prefix = allowed.slice(0, -2);
        return normalizedDetected.startsWith(`${prefix}/`);
      }
      return false;
    });

    if (!isAllowed) {
      throw new UnsupportedMediaTypeError(
        detected.mime,
        options.allowedMimeTypes,
      );
    }
  }

  return detected;
}
