import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { environment } from '../environments/environment';
import { App } from './app';

// Derived from the environment so the version prefix cannot drift out of sync
// with the API again.
const HEALTH_URL = `${environment.apiBaseUrl}/health`;
const AGENTS_URL = `${environment.apiBaseUrl}/agents`;
const MODELS_URL = `${environment.apiBaseUrl}/models`;

const HEALTHY = {
  status: 'ok',
  service: 'glassbeetle-api',
  uptimeSeconds: 12,
  timestamp: '2026-10-06T12:00:00.000Z',
  checks: { database: { status: 'up' } },
};

function agent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    name: 'Research Assistant',
    personality: null,
    instructions: null,
    systemPromptId: null,
    modelId: null,
    temperature: null,
    maxTokens: null,
    modelParams: null,
    hasPicture: false,
    createdAt: '2026-10-04T12:00:00.000Z',
    updatedAt: '2026-10-04T12:00:00.000Z',
    ...overrides,
  };
}

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

  /**
   * Answers the capability probe the shell fires on startup.
   *
   * A 404 is the real response from an API whose providers module is still an
   * empty controller, which is what the UI has to behave correctly for.
   */
  function answerProbe(modelsAvailable = false) {
    const request = httpMock.expectOne((req) => req.url === MODELS_URL);

    if (modelsAvailable) {
      request.flush({ items: [], total: 0, limit: 1, offset: 0 });
    } else {
      request.flush(
        { statusCode: 404, code: 'NOT_FOUND', message: 'Cannot GET /api/v1/models' },
        { status: 404, statusText: 'Not Found' },
      );
    }
  }

  /** Renders the shell and answers the three requests it makes on startup. */
  function render(
    options: { agents?: unknown[]; health?: unknown; modelsAvailable?: boolean } = {},
  ) {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    httpMock.expectOne(HEALTH_URL).flush(options.health ?? HEALTHY);
    answerProbe(options.modelsAvailable);

    const items = options.agents ?? [];
    httpMock
      .expectOne((request) => request.url === AGENTS_URL)
      .flush({ items, total: items.length, limit: 100, offset: 0 });

    fixture.detectChanges();
    return fixture;
  }

  it('loads the roster, the health check and the capability probe once each', () => {
    const fixture = render();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('links to every implemented surface', () => {
    const element = render().nativeElement as HTMLElement;

    const hrefs = Array.from(element.querySelectorAll('a[href]')).map((link) =>
      link.getAttribute('href'),
    );
    expect(hrefs).toContain('/overview');
    expect(hrefs).toContain('/agents');
    expect(hrefs).toContain('/memory');
    expect(hrefs).toContain('/prompts');
  });

  it('shows the roster with each agent reachable from the rail', () => {
    const element = render({
      agents: [agent(), agent({ id: 'a2', name: 'Code Reviewer' })],
    }).nativeElement as HTMLElement;

    expect(element.textContent).toContain('Research Assistant');
    expect(element.textContent).toContain('Code Reviewer');

    const hrefs = Array.from(element.querySelectorAll('a[href]')).map((link) =>
      link.getAttribute('href'),
    );
    expect(hrefs).toContain('/agents/a1');
    expect(hrefs).toContain('/agents/a2');
  });

  it('counts how many agents are configured', () => {
    // Only the second agent has something steering it. Neither can have a
    // model, which is why the count must not hold that against them.
    const element = render({
      agents: [agent(), agent({ id: 'a2', name: 'Ready One', systemPromptId: 'p1' })],
    }).nativeElement as HTMLElement;

    expect(element.textContent).toContain('1/2 ready');
  });

  it('offers to create the first agent when the roster is empty', () => {
    const element = render().nativeElement as HTMLElement;
    expect(element.textContent).toContain('No agents yet');
  });

  /** The deck carries the backend's state on the product mark itself. */
  function stateClass(fixture: { nativeElement: unknown }): string {
    const element = fixture.nativeElement as HTMLElement;
    return element.querySelector('.trigger__state')?.className ?? '';
  }

  it('reports the API as unreachable when the health check gets no response', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    httpMock.expectOne(HEALTH_URL).error(new ProgressEvent('error'), { status: 0, statusText: '' });
    answerProbe();
    httpMock
      .expectOne((request) => request.url === AGENTS_URL)
      .flush({ items: [], total: 0, limit: 100, offset: 0 });
    fixture.detectChanges();

    expect(stateClass(fixture)).toContain('trigger__state--offline');
  });

  it('reports a degraded API from the 503 body rather than as a failure', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    httpMock.expectOne(HEALTH_URL).flush(
      {
        ...HEALTHY,
        status: 'degraded',
        checks: { database: { status: 'down', error: 'Connection failed' } },
      },
      { status: 503, statusText: 'Service Unavailable' },
    );
    answerProbe();
    httpMock
      .expectOne((request) => request.url === AGENTS_URL)
      .flush({ items: [], total: 0, limit: 100, offset: 0 });
    fixture.detectChanges();

    // A 503 that carries a usable body is a report, not a failure.
    expect(stateClass(fixture)).toContain('trigger__state--degraded');
  });

  it('keeps the rail usable when the roster request fails', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    httpMock.expectOne(HEALTH_URL).flush(HEALTHY);
    answerProbe();
    httpMock
      .expectOne((request) => request.url === AGENTS_URL)
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    // The rail degrades to its navigation links; the screen the user is on
    // reports the failure itself.
    const hrefs = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('a[href]'),
    ).map((link) => link.getAttribute('href'));
    expect(hrefs).toContain('/agents');
  });
});
