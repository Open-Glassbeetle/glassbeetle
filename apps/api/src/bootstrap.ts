import {
  ValidationPipe,
  VersioningType,
  type INestApplication,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { HttpExceptionFilter } from './common/filters/http-exception/http-exception.filter.js';
import type { ApiErrorResponse } from './common/http/api-error.js';
import { nowIso } from './common/persistence/timestamps.js';
import { AppConfigService } from './config/app-config.service.js';

/**
 * Path prefix every route sits behind, before the version segment.
 */
export const GLOBAL_PREFIX = 'api';

/**
 * Version served when a controller does not declare one, producing `/api/v1/...`.
 */
export const DEFAULT_API_VERSION = '1';

/**
 * Largest JSON request body the API accepts.
 *
 * Without an explicit value body-parser falls back to 100 kB, which is smaller
 * than the 100 000-character memory content the DTOs allow as soon as the text
 * is not plain ASCII: UTF-8 needs two bytes for `ä` and three or four for CJK
 * and emoji, so the documented limit was unreachable in most languages.
 *
 * The ceiling is sized from the largest body a valid request can produce:
 * 100 000 characters of content at up to 4 bytes each is 400 kB, and the
 * 50 tags of up to 50 characters add at most another 10 kB. 512 KiB covers
 * both with room for the JSON envelope, so the character limits in the DTOs
 * stay the limits clients actually meet.
 *
 * It is still a limit on purpose. The API has no authentication, so this is
 * one of the boundaries against a hostile local client or page — raise it
 * deliberately if a larger payload is ever needed, do not remove it.
 */
export const JSON_BODY_LIMIT_BYTES = 512 * 1024;

/**
 * Applies the global HTTP configuration shared by every route.
 *
 * Extracted from `main.ts` so integration tests boot an application configured
 * exactly like production. A test that exercises a differently-configured
 * pipeline — no validation, no error envelope — proves very little about the
 * real thing.
 */
export function configureApp(app: INestApplication): INestApplication {
  const config = app.get(AppConfigService);

  // Registered before `app.init()`, so Nest sees a JSON parser is already in
  // place and does not add its own with the 100 kB default.
  (app as NestExpressApplication).useBodyParser('json', {
    limit: JSON_BODY_LIMIT_BYTES,
  });

  app.setGlobalPrefix(GLOBAL_PREFIX);

  // URI versioning puts the version after the global prefix (`/api/v1/agents`)
  // and lets an individual controller opt out or pin a version later, which a
  // hard-coded `api/v1` prefix string would not.
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: DEFAULT_API_VERSION,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // Drop properties that carry no validation decorator.
      whitelist: true,
      // Reject unknown properties outright: a client typo becomes a 400 rather
      // than a silently ignored field.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        // Explicit `@Type()` conversions are clearer — and safer — than letting
        // the transformer guess from the TypeScript type.
        enableImplicitConversion: false,
      },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableCors(buildCorsOptions(config.corsOrigins));

  return app;
}

/**
 * Makes unmatched routes return the standard error envelope.
 *
 * A request that matches no route never enters the Nest pipeline, so the global
 * exception filter never sees it and the underlying Express instance answers
 * with an HTML error page. A client that always parses JSON — which is every
 * client of this API — then fails on something as ordinary as a mistyped URL.
 *
 * **Call this after `app.init()`**, and after any other route registration such
 * as the OpenAPI UI. Express matches middleware in registration order, so a
 * fallback registered earlier would shadow the routes it is meant to fall back
 * from.
 */
export function registerNotFoundFallback(app: INestApplication): void {
  const instance = app.getHttpAdapter().getInstance() as {
    use(
      handler: (req: Request, res: Response, next: NextFunction) => void,
    ): unknown;
  };

  instance.use(
    (request: Request, response: Response, next: NextFunction): void => {
      if (response.headersSent) {
        next();

        return;
      }

      const body: ApiErrorResponse = {
        statusCode: 404,
        error: 'Not Found',
        code: 'NOT_FOUND',
        message: `Cannot ${request.method} ${request.path}`,
        path: request.originalUrl,
        timestamp: nowIso(),
      };

      response.status(404).json(body);
    },
  );
}

/**
 * Builds the CORS policy from the configured allowlist.
 *
 * The API binds to loopback, but that only limits it to the local machine — it
 * does not limit it to pages the user trusts. Reflecting arbitrary origins
 * would let any website the user happens to visit read their chats, agents and
 * memories from `http://localhost:3000`, so only known desktop-app origins are
 * allowed.
 *
 * Credentials are deliberately not enabled: the API has no cookies or sessions,
 * and `credentials: true` combined with a reflected origin is precisely the
 * combination that makes such an API readable cross-origin.
 */
export function buildCorsOptions(allowedOrigins: readonly string[]) {
  const allowlist = new Set(allowedOrigins);

  return {
    origin(
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ): void {
      // No `Origin` header means the request is not cross-origin: a direct
      // navigation, a health probe, or a non-browser client.
      if (origin === undefined || allowlist.has(origin)) {
        callback(null, true);

        return;
      }

      // Deny by omitting the header rather than by erroring. Throwing here
      // would turn a blocked cross-origin request into a confusing 500.
      callback(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'X-Request-Id', 'x-request-id'],
    exposedHeaders: ['X-Request-Id', 'x-request-id'],
  };
}
