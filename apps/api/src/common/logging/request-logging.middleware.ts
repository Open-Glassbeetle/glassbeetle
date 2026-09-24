import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service.js';
import { requestLocalStorage } from './request-context.js';
import { redactSensitiveData } from './redact.js';

export const CORRELATION_ID_HEADER = 'x-request-id';

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly config: AppConfigService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const rawInbound =
      req.headers['x-request-id'] ?? req.headers['X-Request-Id'];

    const correlationId =
      typeof rawInbound === 'string' && rawInbound.trim().length > 0
        ? rawInbound.trim()
        : randomUUID();

    res.setHeader('X-Request-Id', correlationId);

    const startTime = performance.now();

    requestLocalStorage.run({ correlationId }, () => {
      res.on('finish', () => {
        const durationMs = Math.round(performance.now() - startTime);
        const statusCode = res.statusCode;
        const method = req.method;
        const path = req.originalUrl || req.url;

        const summary = `[${correlationId}] ${method} ${path} ${statusCode} - ${durationMs}ms`;

        if (statusCode >= 500) {
          this.logger.error(summary);
        } else if (statusCode >= 400) {
          this.logger.warn(summary);
        } else {
          this.logger.log(summary);
        }

        if (
          this.config.logBody &&
          req.body &&
          typeof req.body === 'object' &&
          Object.keys(req.body).length > 0
        ) {
          const redacted = redactSensitiveData(req.body);
          this.logger.debug(
            `[${correlationId}] Request body: ${JSON.stringify(redacted)}`,
          );
        }
      });

      next();
    });
  }
}
