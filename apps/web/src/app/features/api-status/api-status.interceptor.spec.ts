import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { ApiStatusService } from './api-status.service';
import { apiStatusInterceptor } from './api-status.interceptor';

const AGENTS_URL = `${environment.apiBaseUrl}/agents`;

function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([apiStatusInterceptor])),
      provideHttpClientTesting(),
    ],
  });

  return {
    http: TestBed.inject(HttpClient),
    httpMock: TestBed.inject(HttpTestingController),
    status: TestBed.inject(ApiStatusService),
  };
}

describe('apiStatusInterceptor', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('turns a request that never reached the API into an offline indicator', () => {
    const { http, httpMock, status } = setup();

    http.get(AGENTS_URL).subscribe({ error: () => undefined });
    httpMock
      .expectOne(AGENTS_URL)
      .error(new ProgressEvent('error'), { status: 0, statusText: '' });

    expect(status.state()).toBe('offline');
  });

  it('does not mistake an error response for a connection failure', () => {
    const { http, httpMock, status } = setup();

    http.get(AGENTS_URL).subscribe({ error: () => undefined });
    httpMock.expectOne(AGENTS_URL).flush(
      { statusCode: 500, error: 'Internal Server Error', code: 'BOOM', message: 'boom' },
      { status: 500, statusText: 'Server Error' },
    );

    expect(status.state()).toBe('checking');
  });
});
