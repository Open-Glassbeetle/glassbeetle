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

/**
 * Default maximum file size for uploaded artifact binaries (100 MiB).
 */
export const DEFAULT_MAX_ARTIFACT_FILE_SIZE_BYTES = 100 * 1024 * 1024;

/**
 * Multipart handling for artifact file content uploads (`PUT /artifacts/:artifactId/content`).
 *
 * Enforces:
 * - Streaming size enforcement up to 100 MiB (protecting memory).
 * - Single file upload constraint (`files: 1`).
 * - Accepts any single file field name (`file`, `content`, `artifact`) for client flexibility.
 */
@Injectable()
export class ArtifactUploadInterceptor implements NestInterceptor {
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
   * Maximum file size in bytes handed to multer.
   */
  get maxBytes(): number {
    return DEFAULT_MAX_ARTIFACT_FILE_SIZE_BYTES;
  }

  /**
   * Parses the multipart body before the route handler runs.
   *
   * @throws PayloadTooLargeException with code `FILE_TOO_LARGE` when upload exceeds 100 MiB.
   * @throws BadRequestException with code `INVALID_UPLOAD` for other multer errors.
   */
  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    await new Promise<void>((resolve, reject) => {
      this.uploader.any()(req, res, (err: unknown) => {
        if (err) {
          if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
              return reject(
                new PayloadTooLargeException({
                  code: 'FILE_TOO_LARGE',
                  message: `File size exceeds the maximum limit of ${this.maxBytes} bytes`,
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
          if (err instanceof Error) {
            return reject(
              new BadRequestException({
                code: 'INVALID_UPLOAD',
                message: err.message,
              }),
            );
          }
          return reject(err);
        }

        const files = req.files as Express.Multer.File[] | undefined;
        if (files && files.length > 0) {
          req.file = files[0];
        }

        resolve();
      });
    });

    return next.handle();
  }
}
