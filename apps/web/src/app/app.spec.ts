import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EMPTY } from 'rxjs';

import { environment } from '../environments/environment';
import { App } from './app';
import { DesktopService } from './core/desktop/desktop.service';

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

  it('draws no window controls in a browser tab', () => {
    // The controls close and resize a real window. Rendering them where there
    // is none would be three buttons that look live and do nothing.
    const element = render().nativeElement as HTMLElement;

    expect(element.querySelector('app-window-controls')).toBeNull();
    expect(element.querySelector('.resize')).toBeNull();
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

describe('App shell on a platform whose controls sit on the right', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          // Stands in for Windows or Linux: a real window, drawn by the app,
          // with no frame of its own to resize from.
          provide: DesktopService,
          useValue: {
            isDesktop: true,
            isMacOs: false,
            controlsOnLeft: false,
            needsResizeEdges: true,
            menuActions: EMPTY,
            connect: () => Promise.resolve(),
            signalReady: () => Promise.resolve(),
            version: () => Promise.resolve('0.1.0'),
            isWindowMaximised: () => Promise.resolve(false),
            minimiseWindow: () => Promise.resolve(),
            toggleMaximiseWindow: () => Promise.resolve(),
            closeWindow: () => Promise.resolve(),
            startResize: () => Promise.resolve(),
            openExternal: () => Promise.resolve(),
          } satisfies Partial<DesktopService>,
        },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('puts the window controls last and supplies resize edges', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    httpMock.expectOne(HEALTH_URL).flush(HEALTHY);
    httpMock
      .expectOne((request) => request.url === MODELS_URL)
      .flush({}, { status: 404, statusText: 'Not Found' });
    httpMock
      .expectOne((request) => request.url === AGENTS_URL)
      .flush({ items: [], total: 0, limit: 100, offset: 0 });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const children = Array.from(element.querySelector('.deck__bar')?.children ?? []);
    const controls = children.findIndex(
      (child) => child.tagName.toLowerCase() === 'app-window-controls',
    );

    // macOS reaches for them on the left, every other platform on the right.
    // The look is the product's; the position is muscle memory.
    expect(controls).toBe(children.length - 1);
    expect(element.querySelector('.resize')).not.toBeNull();
  });
});
