import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service.js';
import { requestLocalStorage } from './request-context.js';
import { redactSensitiveData } from './redact.js';

/**
 * Header carrying the correlation id, in the lowercase form Node exposes
 * inbound request headers under.
 *
 * Read from the request when the client supplies one, so a desktop-shell
 * request and the API log line it produces can be matched up; otherwise one
 * is generated. Always echoed back on the response.
 */
export const CORRELATION_ID_HEADER = 'x-request-id';

/**
 * Assigns each request a correlation id and logs its outcome.
 *
 * Applied to every route by `AppModule` rather than to individual
 * controllers, so requests that match no route are logged too. Two
 * responsibilities that belong together: the id has to be established before
 * anything else runs, and the access log line is the first consumer of it.
 */
@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly config: AppConfigService) {}

  /**
   * Establishes the request context, then logs once the response is finished.
   *
   * Reuses a client-supplied `X-Request-Id` when it is a non-blank string and
   * generates a UUID otherwise, sets the header on the response immediately —
   * before the handler runs, so the id is present even on an error response —
   * and runs the rest of the request inside the async-local store.
   *
   * The access line is emitted from the response's `finish` event, which is the
   * only point at which the final status code and duration are known. Its level
   * follows the status: `error` for 5xx, `warn` for 4xx, `log` otherwise.
   *
   * When `logBody` is enabled the request body is logged at debug level with
   * credential-shaped fields replaced by {@link redactSensitiveData}. That
   * setting is for local debugging only: even redacted, bodies contain the
   * user's chat and memory text.
   */
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
