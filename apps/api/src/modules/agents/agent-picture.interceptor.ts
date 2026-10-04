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
 * Interceptor for agent picture uploads.
 *
 * Enforces:
 * - Dynamic file size limits from configuration (defaulting to 5 MB).
 * - Limit enforcement during streaming by Multer rather than after full read,
 *   protecting memory.
 * - Single file upload constraint (`files: 1`).
 * - Accepts any single file field name (`file`, `picture`, etc.) for client flexibility.
 */
@Injectable()
export class AgentPictureInterceptor implements NestInterceptor {
  private readonly uploader: multer.Multer;

  constructor(@Optional() private readonly config?: AppConfigService) {
    const maxBytes =
      this.config?.maxPictureSizeBytes ?? DEFAULT_MAX_PICTURE_SIZE_BYTES;

    this.uploader = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: maxBytes,
        files: 1,
      },
    });
  }

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
              const maxBytes =
                this.config?.maxPictureSizeBytes ??
                DEFAULT_MAX_PICTURE_SIZE_BYTES;
              return reject(
                new PayloadTooLargeException({
                  code: 'FILE_TOO_LARGE',
                  message: `File size exceeds the configured maximum limit of ${maxBytes} bytes`,
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
