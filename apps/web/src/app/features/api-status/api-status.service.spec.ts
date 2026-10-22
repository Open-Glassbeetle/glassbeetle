import { HttpErrorResponse } from '@angular/common/http';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { ApiStatusService } from './api-status.service';

const HEALTH_URL = `${environment.apiBaseUrl}/health`;

const HEALTHY = {
  status: 'ok',
  service: 'glassbeetle-api',
  uptimeSeconds: 12,
  timestamp: '2026-10-06T12:00:00.000Z',
  checks: { database: { status: 'up' } },
};

const REQUEST_INTERVAL_MS = 30_000;
const FIRST_RETRY_MS = 5_000;

function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const service = TestBed.inject(ApiStatusService);

  return { service, httpMock };
}

/** Simulates the window being hidden or shown, the way a browser reports it. */
function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

function dropConnection(httpMock: HttpTestingController): void {
  httpMock
    .expectOne(HEALTH_URL)
    .error(new ProgressEvent('error'), { status: 0, statusText: '' });
}

describe('ApiStatusService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllTimers();
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('re-checks without being asked and notices the API going away', async () => {
    const { service, httpMock } = setup();

    service.refresh();
    httpMock.expectOne(HEALTH_URL).flush(HEALTHY);
    expect(service.state()).toBe('online');

    await vi.advanceTimersByTimeAsync(REQUEST_INTERVAL_MS);

    dropConnection(httpMock);
    expect(service.state()).toBe('offline');
  });

  it('recovers on its own once the API answers again', async () => {
    const { service, httpMock } = setup();

    service.refresh();
    httpMock.expectOne(HEALTH_URL).flush(HEALTHY);
    await vi.advanceTimersByTimeAsync(REQUEST_INTERVAL_MS);
    dropConnection(httpMock);
    expect(service.state()).toBe('offline');

    await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS);
    httpMock.expectOne(HEALTH_URL).flush(HEALTHY);

    expect(service.state()).toBe('online');
  });

  it('stops checking while the window is hidden and resumes when it is shown', async () => {
    const { service, httpMock } = setup();

    service.refresh();
    httpMock.expectOne(HEALTH_URL).flush(HEALTHY);

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    httpMock.expectNone(HEALTH_URL);

    setVisibility('visible');
    httpMock.expectOne(HEALTH_URL).flush(HEALTHY);
    await vi.advanceTimersByTimeAsync(REQUEST_INTERVAL_MS);
    httpMock.expectOne(HEALTH_URL).flush(HEALTHY);
  });

  it('backs off while the API is offline instead of retrying at full rate', async () => {
    const { service, httpMock } = setup();

    service.refresh();
    httpMock.expectOne(HEALTH_URL).flush(HEALTHY);

    await vi.advanceTimersByTimeAsync(REQUEST_INTERVAL_MS);
    dropConnection(httpMock);
    expect(service.state()).toBe('offline');

    await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS - 1);
    httpMock.expectNone(HEALTH_URL);
    await vi.advanceTimersByTimeAsync(1);
    dropConnection(httpMock);

    // The second retry waits twice as long as the first.
    await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS - 1);
    httpMock.expectNone(HEALTH_URL);
    await vi.advanceTimersByTimeAsync(FIRST_RETRY_MS + 1);
    dropConnection(httpMock);
  });

  it('does not stack checks when a tick lands while one is still in flight', async () => {
    const { service, httpMock } = setup();

    service.refresh();
    // `expectOne` throws if the refresh produced a second concurrent request.
    const first = httpMock.expectOne(HEALTH_URL);

    await vi.advanceTimersByTimeAsync(REQUEST_INTERVAL_MS);
    httpMock.expectNone(HEALTH_URL);

    first.flush(HEALTHY);
    expect(service.state()).toBe('online');
  });

  it('reports a failed request as offline immediately, without waiting for a poll', () => {
    const { service, httpMock } = setup();

    service.refresh();
    httpMock.expectOne(HEALTH_URL).flush(HEALTHY);

    service.reportRequestFailure(new HttpErrorResponse({ status: 0 }));

    expect(service.state()).toBe('offline');
    expect(service.error()).toContain('port 3000');
  });

  it('does not treat a response the API sent as a connection failure', () => {
    const { service, httpMock } = setup();

    service.refresh();
    httpMock.expectOne(HEALTH_URL).flush(HEALTHY);

    service.reportRequestFailure(
      new HttpErrorResponse({
        status: 500,
        error: { statusCode: 500, error: 'Internal Server Error', code: 'BOOM', message: 'boom' },
      }),
    );

    expect(service.state()).toBe('online');
  });

  it('keeps degraded distinct from offline', () => {
    const { service, httpMock } = setup();

    service.refresh();
    httpMock
      .expectOne(HEALTH_URL)
      .flush(
        { ...HEALTHY, status: 'degraded', checks: { database: { status: 'down' } } },
        { status: 503, statusText: 'Service Unavailable' },
      );

    expect(service.state()).toBe('degraded');
    expect(service.reachable()).toBe(true);
  });

  it('keeps the manual refresh working, and stops its timer when destroyed', async () => {
    const { service, httpMock } = setup();

    service.refresh();
    httpMock.expectOne(HEALTH_URL).flush(HEALTHY);

    await vi.advanceTimersByTimeAsync(REQUEST_INTERVAL_MS);
    dropConnection(httpMock);

    service.refresh();
    httpMock.expectOne(HEALTH_URL).flush(HEALTHY);
    expect(service.state()).toBe('online');

    service.ngOnDestroy();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    httpMock.expectNone(HEALTH_URL);
  });
});
