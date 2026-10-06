import { HttpErrorResponse } from '@angular/common/http';

import { describeApiError, toApiError } from './api-error';

describe('toApiError', () => {
  it('reads the API error envelope', () => {
    const error = toApiError(
      new HttpErrorResponse({
        status: 404,
        error: {
          statusCode: 404,
          error: 'Not Found',
          code: 'NOT_FOUND',
          message: 'Agent not found',
        },
      }),
    );

    expect(error).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Agent not found',
      offline: false,
    });
  });

  it('reports a status of 0 as the API being unreachable', () => {
    // The browser produces this when the request never got a response: the API
    // is down, or CORS rejected it. The remedy differs from any error the API
    // raised deliberately, so it must not be reported as an empty 0 response.
    const error = toApiError(new HttpErrorResponse({ status: 0 }));

    expect(error.offline).toBe(true);
    expect(error.code).toBe('API_UNREACHABLE');
    expect(error.message).toContain('port 3000');
  });

  it('keeps validation details separate from the generic summary', () => {
    const error = toApiError(
      new HttpErrorResponse({
        status: 400,
        error: {
          statusCode: 400,
          error: 'Bad Request',
          code: 'BAD_REQUEST',
          message: 'Request validation failed',
          details: ['name must not be empty', 'temperature must not exceed 2'],
        },
      }),
    );

    expect(error.details).toHaveLength(2);
    // The envelope's `message` for a validation failure is a generic summary,
    // so the details are what the user actually needs shown.
    expect(describeApiError(error)).toBe('name must not be empty · temperature must not exceed 2');
  });

  it('falls back when the body is not an error envelope', () => {
    const error = toApiError(
      new HttpErrorResponse({ status: 502, error: '<html>Bad gateway</html>' }),
    );

    expect(error.status).toBe(502);
    expect(error.code).toBe('UNKNOWN');
  });
});
