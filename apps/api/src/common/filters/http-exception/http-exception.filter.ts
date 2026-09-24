import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  codeForStatus,
  titleForStatus,
  type ApiErrorResponse,
} from '../../http/api-error.js';
import { getCorrelationId } from '../../logging/request-context.js';
import { nowIso } from '../../persistence/timestamps.js';

/**
 * Message returned for any error the application did not raise deliberately.
 *
 * Unexpected errors carry SQLite messages, filesystem paths and upstream
 * provider responses. None of that belongs in a client response, so the real
 * error is logged server-side and the client is told only that something
 * failed.
 */
const INTERNAL_ERROR_MESSAGE = 'Internal server error';

/**
 * Summary used when a validation failure supplies per-field detail.
 */
const VALIDATION_ERROR_MESSAGE = 'Request validation failed';

/**
 * Global fallback exception filter.
 *
 * `@Catch()` with no argument catches everything, which is what a last-resort
 * filter should do: no exception may escape without producing a response, or
 * the request hangs until the client times out.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    // Streaming completions and any future non-HTTP transport do not have a
    // response to write an envelope into.
    if (host.getType() !== 'http') {
      this.logger.error(
        'Unhandled exception outside an HTTP context',
        toStack(exception),
      );

      return;
    }

    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    const body = this.buildBody(exception, request?.url ?? '');

    const cid = getCorrelationId();
    const cidPrefix = cid ? `[${cid}] ` : '';

    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${cidPrefix}${request?.method ?? 'UNKNOWN'} ${body.path} failed: ${describe(exception)}`,
        toStack(exception),
      );
    }

    // Once the response has started there are no headers left to set, so the
    // envelope cannot be written. Appending it would corrupt whatever the
    // client has already received.
    if (response.headersSent) {
      this.logger.warn(
        `${cidPrefix}Exception after response started for ${body.path}; destroying the connection`,
      );
      response.destroy();

      return;
    }

    response.status(body.statusCode).json(body);
  }

  private buildBody(exception: unknown, path: string): ApiErrorResponse {
    const timestamp = nowIso();

    if (!(exception instanceof HttpException)) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: titleForStatus(HttpStatus.INTERNAL_SERVER_ERROR),
        code: codeForStatus(HttpStatus.INTERNAL_SERVER_ERROR),
        message: INTERNAL_ERROR_MESSAGE,
        path,
        timestamp,
      };
    }

    const statusCode = exception.getStatus();
    const payload = exception.getResponse();

    // An exception constructed with a string body, e.g. `new NotFoundException('Agent not found')`.
    if (typeof payload === 'string') {
      return {
        statusCode,
        error: titleForStatus(statusCode),
        code: codeForStatus(statusCode),
        message: payload,
        path,
        timestamp,
      };
    }

    const record = (payload ?? {}) as Record<string, unknown>;
    const rawMessage = record.message;

    // `ValidationPipe` reports every failing constraint as an array of strings.
    const details = Array.isArray(rawMessage)
      ? rawMessage.map((entry) => String(entry))
      : undefined;

    const message = details
      ? VALIDATION_ERROR_MESSAGE
      : typeof rawMessage === 'string'
        ? rawMessage
        : exception.message;

    return {
      statusCode,
      error:
        typeof record.error === 'string'
          ? record.error
          : titleForStatus(statusCode),
      code:
        typeof record.code === 'string'
          ? record.code
          : codeForStatus(statusCode),
      message,
      ...(details ? { details } : {}),
      path,
      timestamp,
    };
  }
}

/**
 * Describes a thrown value for a log line, tolerating non-`Error` throws.
 */
function describe(exception: unknown): string {
  if (exception instanceof Error) {
    return exception.message;
  }

  try {
    return String(exception);
  } catch {
    return '<unrepresentable value>';
  }
}

/**
 * Extracts a stack trace when there is one. A thrown string or object has none.
 */
function toStack(exception: unknown): string | undefined {
  return exception instanceof Error ? exception.stack : undefined;
}
