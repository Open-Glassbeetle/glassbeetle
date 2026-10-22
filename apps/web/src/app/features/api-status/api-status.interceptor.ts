import {
  HttpErrorResponse,
  type HttpEvent,
  type HttpHandlerFn,
  type HttpRequest,
} from '@angular/common/http';
import { Injector, inject } from '@angular/core';
import { type Observable, catchError, throwError } from 'rxjs';

import { ApiStatusService } from './api-status.service';

/**
 * Feeds failed requests into the connection indicator.
 *
 * The indicator used to learn about a dead API only from its own health check,
 * so any other request failing against the same dead port left it claiming to
 * be online. This observes failures without changing them and without retrying
 * anything: a retry policy on every call is a different, larger decision.
 *
 * The service is resolved lazily because `ApiStatusService` depends on
 * `HealthService` ??and therefore on `HttpClient` ??so asking for it while the
 * interceptor itself is being built would close a dependency cycle.
 */
export function apiStatusInterceptor(
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  const injector = inject(Injector);

  return next(request).pipe(
    catchError((error: unknown) => {
      // The health check is the service's own probe; counting it here as well
      // would report one failure twice.
      if (error instanceof HttpErrorResponse && !request.url.endsWith('/health')) {
        injector.get(ApiStatusService).reportRequestFailure(error);
      }

      return throwError(() => error);
    }),
  );
}
