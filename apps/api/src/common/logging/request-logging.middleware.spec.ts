import type { Request, Response } from 'express';
import { AppConfigService } from '../../config/app-config.service.js';
import { RequestLoggingMiddleware } from './request-logging.middleware.js';

describe('RequestLoggingMiddleware', () => {
  let middleware: RequestLoggingMiddleware;
  let mockConfigService: Partial<AppConfigService>;

  beforeEach(() => {
    mockConfigService = { logBody: false };
    middleware = new RequestLoggingMiddleware(
      mockConfigService as AppConfigService,
    );
  });

  it('generates a correlation ID when inbound X-Request-Id is absent and sets response header', () => {
    const headers: Record<string, string> = {};
    const req = {
      headers,
      method: 'GET',
      url: '/api/v1/health',
    } as unknown as Request;
    const resHeaders: Record<string, string> = {};
    const res = {
      statusCode: 200,
      setHeader: (name: string, value: string) => {
        resHeaders[name] = value;
      },
      on: (_event: string, cb: () => void) => {
        cb();
      },
    } as unknown as Response;

    let nextCalled = false;
    middleware.use(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(resHeaders['X-Request-Id']).toBeDefined();
    expect(resHeaders['X-Request-Id'].length).toBeGreaterThan(10);
  });

  it('preserves inbound X-Request-Id header when supplied', () => {
    const req = {
      headers: { 'x-request-id': 'custom-req-id-12345' },
      method: 'POST',
      url: '/api/v1/agents',
    } as unknown as Request;
    const resHeaders: Record<string, string> = {};
    const res = {
      statusCode: 201,
      setHeader: (name: string, value: string) => {
        resHeaders[name] = value;
      },
      on: (_event: string, cb: () => void) => {
        cb();
      },
    } as unknown as Response;

    middleware.use(req, res, () => {});

    expect(resHeaders['X-Request-Id']).toBe('custom-req-id-12345');
  });
});
