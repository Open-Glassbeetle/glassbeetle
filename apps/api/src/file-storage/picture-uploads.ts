import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { detectContentType } from './content-type.js';

/**
 * Allowed MIME types for uploaded profile pictures.
 *
 * Excludes SVG and HTML types to protect against stored XSS attacks within the
 * Tauri desktop application webview.
 */
export const ALLOWED_PICTURE_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

/**
 * The part of an uploaded file this check needs.
 *
 * Narrower than `Express.Multer.File` on purpose, so the check can be called
 * with a plain buffer in a test without constructing a whole multer file.
 */
export interface UploadedPicture {
  readonly buffer?: Buffer;
}

/**
 * Rejects an uploaded picture that is missing, oversized, or not an image.
 *
 * Returns the content type detected from the file's actual bytes. The declared
 * MIME type and the filename are both ignored: a client may claim anything, and
 * the only thing a stored file can be trusted to be is what its magic bytes
 * say.
 *
 * Shared by every picture upload endpoint, so a format accepted for an agent is
 * accepted for the user and the rejection a client sees is the same either way.
 */
export function assertUploadablePicture(
  file: UploadedPicture | undefined,
  maxBytes: number,
): string {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new BadRequestException({
      code: 'MISSING_FILE',
      message: 'No file uploaded or file is empty',
    });
  }

  if (file.buffer.length > maxBytes) {
    throw new PayloadTooLargeException({
      code: 'FILE_TOO_LARGE',
      message: `File size (${file.buffer.length} bytes) exceeds the maximum allowed limit of ${maxBytes} bytes`,
    });
  }

  const detected = detectContentType(file.buffer);

  if (!ALLOWED_PICTURE_MIME_TYPES.includes(detected.mime)) {
    throw new BadRequestException({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: `Unsupported image format '${detected.mime}'. Allowed formats: ${ALLOWED_PICTURE_MIME_TYPES.join(', ')}`,
    });
  }

  return detected.mime;
}
