import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Optional,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import multer from 'multer';
import { Observable } from 'rxjs';
import { AppConfigService } from '../../config/app-config.service.js';
import { DEFAULT_MAX_PICTURE_SIZE_BYTES } from '../../config/app.config.js';

/**
 * Multipart handling for profile picture uploads.
 *
 * Enforces:
 * - Dynamic file size limits from configuration (defaulting to 5 MB).
 * - Limit enforcement during streaming by Multer rather than after full read,
 *   protecting memory.
 * - Single file upload constraint (`files: 1`).
 * - Accepts any single file field name (`file`, `picture`, etc.) for client
 *   flexibility.
 *
 * Every picture upload in the API has the same multipart shape and the same
 * size limit, so they share this one interceptor rather than each configuring
 * multer themselves — a second copy would be a second place for the limit to
 * drift out of step with `maxPictureSizeBytes`.
 */
@Injectable()
export class PictureUploadInterceptor implements NestInterceptor {
  private readonly uploader: multer.Multer;

  constructor(@Optional() protected readonly config?: AppConfigService) {
    this.uploader = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: this.maxBytes,
        files: 1,
      },
    });
  }

  /**
   * Size ceiling handed to multer, read from configuration.
   *
   * Falls back to the compiled-in default when no `AppConfigService` is
   * available, which is the case in unit tests that construct the interceptor
   * directly.
   */
  private get maxBytes(): number {
    return this.config?.maxPictureSizeBytes ?? DEFAULT_MAX_PICTURE_SIZE_BYTES;
  }

  /**
   * Parses the multipart body before the route handler runs.
   *
   * Uses `multer.any()` with in-memory storage so the handler receives the
   * bytes as a buffer, then copies the first file onto `request.file` to give
   * every picture endpoint the same single-file shape regardless of the field
   * name the client chose.
   *
   * Resolves only once multer has finished; the returned observable is the
   * untouched downstream handler.
   *
   * @throws PayloadTooLargeException with code `FILE_TOO_LARGE` when the stream
   * exceeds {@link maxBytes}. The limit is applied while streaming, so an
   * oversized upload is cut off rather than buffered in full.
   * @throws BadRequestException with code `INVALID_UPLOAD` for every other
   * multer error, such as more than one file part.
   */
  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    await new Promise<void>((resolve, reject) => {
      // multer.any() processes any multipart field (e.g. 'file', 'picture')
      this.uploader.any()(req, res, (err: unknown) => {
        if (err) {
          if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
              return reject(
                new PayloadTooLargeException({
                  code: 'FILE_TOO_LARGE',
                  message: `File size exceeds the configured maximum limit of ${this.maxBytes} bytes`,
                }),
              );
            }
            return reject(
              new BadRequestException({
                code: 'INVALID_UPLOAD',
                message: err.message,
              }),
            );
          }
          return reject(err);
        }

        const files = (req as any).files;
        if (Array.isArray(files) && files.length > 0) {
          (req as any).file = files[0];
        }

        resolve();
      });
    });

    return next.handle();
  }
}
