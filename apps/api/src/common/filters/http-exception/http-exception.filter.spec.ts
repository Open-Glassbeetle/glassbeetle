import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import type { ApiErrorResponse } from '../../http/api-error.js';
import { HttpExceptionFilter } from './http-exception.filter.js';

interface Captured {
  status: number;
  body: ApiErrorResponse;
}

function createHost(options: { headersSent?: boolean; type?: string } = {}) {
  const captured: Partial<Captured> = {};
  const destroy = vi.fn();

  const response = {
    headersSent: options.headersSent ?? false,
    destroy,
    status(code: number) {
      captured.status = code;

      return this;
    },
    json(body: ApiErrorResponse) {
      captured.body = body;

      return this;
    },
  };

  const host = {
    getType: () => options.type ?? 'http',
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ url: '/api/v1/agents/abc', method: 'GET' }),
    }),
  } as unknown as ArgumentsHost;

  return { host, captured: captured as Captured, destroy };
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    // The filter logs unexpected errors; keep the test output readable.
    vi.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    vi.spyOn(filter['logger'], 'warn').mockImplementation(() => undefined);
  });

  it('passes an HttpException through with its status and message', () => {
    const { host, captured } = createHost();

    filter.catch(new NotFoundException('Agent not found'), host);

    expect(captured.status).toBe(HttpStatus.NOT_FOUND);
    expect(captured.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      code: 'NOT_FOUND',
      message: 'Agent not found',
      path: '/api/v1/agents/abc',
    });
    expect(captured.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it('preserves per-field detail from a validation failure', () => {
    const { host, captured } = createHost();

    filter.catch(
      new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: ['name should not be empty', 'temperature must be a number'],
      }),
      host,
    );

    expect(captured.status).toBe(HttpStatus.BAD_REQUEST);
    expect(captured.body.code).toBe('BAD_REQUEST');
    expect(captured.body.message).toBe('Request validation failed');
    expect(captured.body.details).toEqual([
      'name should not be empty',
      'temperature must be a number',
    ]);
  });

  it('omits details for errors that have none', () => {
    const { host, captured } = createHost();

    filter.catch(new NotFoundException('nope'), host);

    expect(captured.body.details).toBeUndefined();
  });

  it('honours a custom machine-readable code supplied by the exception', () => {
    const { host, captured } = createHost();

    filter.catch(
      new HttpException(
        { code: 'AGENT_HAS_NO_MODEL', message: 'Agent has no model' },
        409,
      ),
      host,
    );

    expect(captured.body.code).toBe('AGENT_HAS_NO_MODEL');
    expect(captured.body.message).toBe('Agent has no model');
  });

  it('turns an unexpected error into a sanitised 500', () => {
    const { host, captured } = createHost();

    filter.catch(
      new Error(
        'SQLITE_ERROR: no such table: agents (/home/ada/.local/share/glassbeetle.db)',
      ),
      host,
    );

    expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captured.body.message).toBe('Internal server error');
    expect(captured.body.code).toBe('INTERNAL_SERVER_ERROR');
  });

  it('never leaks database or filesystem detail from an unexpected error', () => {
    const { host, captured } = createHost();

    filter.catch(
      new Error('SQLITE_ERROR: no such table: agents at /home/ada/secret.db'),
      host,
    );

    const serialised = JSON.stringify(captured.body);
    expect(serialised).not.toContain('SQLITE_ERROR');
    expect(serialised).not.toContain('/home/ada');
  });

  it('logs the real error server-side while sanitising the response', () => {
    const { host } = createHost();
    const logger = vi.spyOn(filter['logger'], 'error');
    const original = new Error('SQLITE_ERROR: disk I/O error');

    filter.catch(original, host);

    expect(logger).toHaveBeenCalled();
    expect(String(logger.mock.calls[0]?.[0])).toContain(
      'SQLITE_ERROR: disk I/O error',
    );
  });

  it.each([
    ['a thrown string', 'something went wrong'],
    ['a thrown object', { unexpected: true }],
    ['a thrown null', null],
    ['a thrown undefined', undefined],
  ])('responds safely to %s', (_label, thrown) => {
    const { host, captured } = createHost();

    expect(() => filter.catch(thrown, host)).not.toThrow();
    expect(captured.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captured.body.message).toBe('Internal server error');
  });

  it('always produces a response, so no request can hang', () => {
    const { host, captured } = createHost();

    filter.catch(new Error('boom'), host);

    expect(captured.status).toBeDefined();
    expect(captured.body).toBeDefined();
  });

  it('destroys the connection instead of appending an envelope mid-response', () => {
    // Streaming completions send headers before the body is complete; rewriting
    // the response at that point would corrupt what the client already has.
    const { host, captured, destroy } = createHost({ headersSent: true });

    filter.catch(new Error('failed mid-stream'), host);

    expect(destroy).toHaveBeenCalled();
    expect(captured.status).toBeUndefined();
  });

  it('does not assume an HTTP context', () => {
    const { host, captured } = createHost({ type: 'ws' });

    expect(() => filter.catch(new Error('boom'), host)).not.toThrow();
    expect(captured.status).toBeUndefined();
  });
});
