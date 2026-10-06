import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { environment } from '../environments/environment';
import { App } from './app';

// Derived from the environment so the version prefix cannot drift out of sync
// with the API again.
const HEALTH_URL = `${environment.apiBaseUrl}/health`;

describe('App shell', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('creates the shell and checks the API once', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    // The status indicator in the toolbar owns the health check; the shell
    // itself must not run a second, competing one.
    httpMock.expectOne(HEALTH_URL).flush({});
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the brand and a link to every implemented feature', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpMock.expectOne(HEALTH_URL).flush({
      status: 'ok',
      service: 'glassbeetle-api',
      uptimeSeconds: 12,
      timestamp: new Date().toISOString(),
      checks: { database: { status: 'up' } },
    });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Glassbeetle');

    const hrefs = Array.from(element.querySelectorAll('a[href]')).map((link) =>
      link.getAttribute('href'),
    );
    expect(hrefs).toContain('/agents');
    expect(hrefs).toContain('/memories');
    expect(hrefs).toContain('/system-prompts');
  });

  it('reports the API as offline when the health check cannot be reached', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    httpMock.expectOne(HEALTH_URL).error(new ProgressEvent('error'), { status: 0, statusText: '' });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('API offline');
  });

  it('reports a degraded API from the 503 body rather than as a failure', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    httpMock.expectOne(HEALTH_URL).flush(
      {
        status: 'degraded',
        service: 'glassbeetle-api',
        uptimeSeconds: 12,
        timestamp: new Date().toISOString(),
        checks: { database: { status: 'down', error: 'Connection failed' } },
      },
      { status: 503, statusText: 'Service Unavailable' },
    );
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('API degraded');
  });
});
