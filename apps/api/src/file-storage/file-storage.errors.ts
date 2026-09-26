import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';

/**
 * Base class for all file storage exceptions.
 */
export class FileStorageError extends HttpException {
  constructor(
    message: string,
    status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    code = 'FILE_STORAGE_ERROR',
  ) {
    super(
      {
        code,
        message,
      },
      status,
    );
    this.name = this.constructor.name;
  }
}

/**
 * Thrown when a storage path reference is invalid, absolute, malformed,
 * contains traversal sequences, or escapes the configured storage root.
 */
export class InvalidPathError extends BadRequestException {
  constructor(message = 'Invalid storage path or traversal attempt detected') {
    super({
      code: 'INVALID_PATH',
      message,
    });
    this.name = 'InvalidPathError';
  }
}

/**
 * Thrown when a requested storage reference does not exist on disk.
 */
export class FileNotFoundError extends NotFoundException {
  constructor(reference: string) {
    super({
      code: 'FILE_NOT_FOUND',
      message: `Stored file not found: ${reference}`,
    });
    this.name = 'FileNotFoundError';
  }
}

/**
 * Thrown when file content exceeds the caller-configured maximum byte size limit.
 */
export class FilePayloadTooLargeError extends PayloadTooLargeException {
  constructor(maxBytes: number, actualBytes?: number) {
    super({
      code: 'FILE_TOO_LARGE',
      message:
        actualBytes !== undefined
          ? `File size (${actualBytes} bytes) exceeds the maximum allowed limit of ${maxBytes} bytes`
          : `File size exceeds the maximum allowed limit of ${maxBytes} bytes`,
    });
    this.name = 'FilePayloadTooLargeError';
  }
}

/**
 * Thrown when the detected MIME type of a file does not match any of the allowed MIME types.
 */
export class UnsupportedMediaTypeError extends UnsupportedMediaTypeException {
  constructor(detectedType: string, allowedTypes: readonly string[]) {
    super({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: `Detected content type '${detectedType}' is not permitted. Allowed types: ${allowedTypes.join(', ')}`,
    });
    this.name = 'UnsupportedMediaTypeError';
  }
}
