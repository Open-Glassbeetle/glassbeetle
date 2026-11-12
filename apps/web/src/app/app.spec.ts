import { LiveAnnouncer } from '@angular/cdk/a11y';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { EMPTY } from 'rxjs';
import { vi } from 'vitest';

import { environment } from '../environments/environment';
import { App } from './app';
import { DesktopService } from './core/desktop/desktop.service';
import { ApiStatusService } from './features/api-status/api-status.service';

@Component({ template: '' })
class TestRoute {}

// Derived from the environment so the version prefix cannot drift out of sync
// with the API again.
const HEALTH_URL = `${environment.apiBaseUrl}/health`;
const AGENTS_URL = `${environment.apiBaseUrl}/agents`;
const MODELS_URL = `${environment.apiBaseUrl}/models`;
const CHATS_URL = `${environment.apiBaseUrl}/chats`;
const TEAMS_URL = `${environment.apiBaseUrl}/teams`;
const PROJECTS_URL = `${environment.apiBaseUrl}/projects`;
const USER_URL = `${environment.apiBaseUrl}/user`;
const BUDGET_URL = `${environment.apiBaseUrl}/budget`;

const HEALTHY = {
  status: 'ok',
  service: 'glassbeetle-api',
  uptimeSeconds: 12,
  timestamp: '2026-10-06T12:00:00.000Z',
  checks: { database: { status: 'up' } },
};

const PROFILE = {
  id: 'u1',
  displayName: 'Ada',
  pronouns: null,
  about: null,
  locale: 'de-CH',
  timezone: 'Europe/Zurich',
  includeInPrompts: true,
  hasPicture: false,
  pictureUpdatedAt: null,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
};

const BUDGET = {
  id: 'b1',
  limitUsd: null,
  period: 'monthly',
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-11-01T00:00:00.000Z',
  spentUsd: 0,
  remainingUsd: null,
  usedFraction: null,
  callCount: 0,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
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

function chat(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    title: 'Release planning',
    projectId: null,
    agentId: 'a1',
    teamId: null,
    contextSummary: null,
    createdAt: '2026-10-04T12:00:00.000Z',
    updatedAt: '2026-10-04T12:00:00.000Z',
    ...overrides,
  };
}

function page(items: unknown[]) {
  return { items, total: items.length, limit: 100, offset: 0 };
}

/**
 * Answers what the rail reads on startup: the conversations, the team and
 * project names that label them, and the model catalogue.
 *
 * The catalogue asks for a full page, which is what tells it apart from the
 * capability probe against the same URL.
 */
function answerRail(
  httpMock: HttpTestingController,
  options: { chats?: unknown[]; teams?: unknown[]; projects?: unknown[] } = {},
) {
  httpMock.expectOne((req) => req.url === CHATS_URL).flush(page(options.chats ?? []));
  httpMock.expectOne((req) => req.url === TEAMS_URL).flush(page(options.teams ?? []));
  httpMock.expectOne((req) => req.url === PROJECTS_URL).flush(page(options.projects ?? []));
  httpMock
    .expectOne((req) => req.url === MODELS_URL && req.params.get('limit') === '100')
    .flush(page([]));
}

describe('App shell', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([
          { path: 'overview', title: 'Overview · Glassbeetle', component: TestRoute },
          { path: 'teams', title: 'Teams · Glassbeetle', component: TestRoute },
          { path: 'chats/:chatId', title: 'Chat · Glassbeetle', component: TestRoute },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
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
    const request = httpMock.expectOne(
      (req) => req.url === MODELS_URL && req.params.get('limit') === '1',
    );

    if (modelsAvailable) {
      request.flush({ items: [], total: 0, limit: 1, offset: 0 });
    } else {
      request.flush(
        { statusCode: 404, code: 'NOT_FOUND', message: 'Cannot GET /api/v1/models' },
        { status: 404, statusText: 'Not Found' },
      );
    }
  }

  /** Answers the profile and budget reads the deck fires on startup. */
  function answerProfile(
    profile: Record<string, unknown> = PROFILE,
    budget: Record<string, unknown> = BUDGET,
  ) {
    httpMock.expectOne(USER_URL).flush(profile);
    httpMock.expectOne(BUDGET_URL).flush(budget);
  }

  /** Renders the shell and answers the requests it makes on startup. */
  function render(
    options: {
      agents?: unknown[];
      chats?: unknown[];
      teams?: unknown[];
      projects?: unknown[];
      health?: unknown;
      modelsAvailable?: boolean;
      profile?: Record<string, unknown>;
      budget?: Record<string, unknown>;
    } = {},
  ) {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    httpMock.expectOne(HEALTH_URL).flush(options.health ?? HEALTHY);
    answerProbe(options.modelsAvailable);

    const items = options.agents ?? [];
    httpMock
      .expectOne((request) => request.url === AGENTS_URL)
      .flush({ items, total: items.length, limit: 100, offset: 0 });
    answerRail(httpMock, options);
    answerProfile(options.profile, options.budget);

    fixture.detectChanges();
    return fixture;
  }

  it('loads the health check, the capability probe, the roster, the conversations, the profile and the budget once each', () => {
    const fixture = render();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('offers a skip link as the first focusable element', () => {
    const element = render().nativeElement as HTMLElement;
    const first = element.querySelector('a, button, input, select, textarea, [tabindex]');
    const skip = element.querySelector<HTMLAnchorElement>('a.skip-link');
    const main = element.querySelector<HTMLElement>('main');

    expect(skip).not.toBeNull();
    expect(first).toBe(skip);
    expect(skip?.getAttribute('href')).toBe('#main-content');
    expect(main?.id).toBe('main-content');
    expect(main?.getAttribute('tabindex')).toBe('-1');
  });

  it('moves focus into the content when the skip link is used', () => {
    const element = render().nativeElement as HTMLElement;
    const skip = element.querySelector<HTMLAnchorElement>('a.skip-link');
    const main = element.querySelector<HTMLElement>('main.surface');

    skip?.click();

    expect(document.activeElement).toBe(main);
  });

  it('focuses and announces the new route after the initial navigation', async () => {
    const fixture = render();
    const main = fixture.nativeElement.querySelector('main.surface') as HTMLElement;
    const focus = vi.spyOn(main, 'focus');
    const announce = vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce');
    const router = TestBed.inject(Router);

    await router.navigateByUrl('/overview');
    expect(focus).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();

    await router.navigateByUrl('/teams');
    expect(focus).toHaveBeenCalledOnce();
    expect(announce).toHaveBeenCalledOnce();
    expect(announce).toHaveBeenCalledWith('Teams · Glassbeetle');
  });

  it('invites a budget from the deck when none is set, rather than hiding', () => {
    const element = render().nativeElement as HTMLElement;
    const meter = element.querySelector('app-spend-meter .meter');

    expect(meter).not.toBeNull();
    expect(meter?.textContent).toContain('Budget');
    // No figure to read: there is nothing being measured yet.
    expect(meter?.querySelector('.ring__value')).toBeNull();
  });

  it('shows what is left in the deck once a budget is set', () => {
    const element = render({
      budget: {
        ...BUDGET,
        limitUsd: 20,
        spentUsd: 4.12,
        remainingUsd: 15.88,
        usedFraction: 0.206,
        callCount: 37,
      },
    }).nativeElement as HTMLElement;

    expect(element.querySelector('app-spend-meter .meter')?.textContent).toContain('15.88');
  });

  function hrefsOf(element: HTMLElement): (string | null)[] {
    return Array.from(element.querySelectorAll('a[href]')).map((link) => link.getAttribute('href'));
  }

  it('leads with starting a chat and the four places work happens', () => {
    const element = render().nativeElement as HTMLElement;
    const rail = element.querySelector('app-conversation-rail') as HTMLElement;

    // In the order they are read: the action first, then the places.
    expect(hrefsOf(rail).slice(0, 5)).toEqual([
      '/chats/new',
      '/chats',
      '/projects',
      '/agents',
      '/artifacts',
    ]);
  });

  it('keeps the configuration surfaces folded away until they are asked for', () => {
    const fixture = render();
    const element = fixture.nativeElement as HTMLElement;

    expect(hrefsOf(element)).not.toContain('/teams');

    element.querySelector<HTMLButtonElement>('.workspace__toggle')?.click();
    fixture.detectChanges();

    const hrefs = hrefsOf(element);
    expect(hrefs).toContain('/teams');
    expect(hrefs).toContain('/memory');
    expect(hrefs).toContain('/prompts');
    expect(hrefs).toContain('/overview');
    expect(hrefs).toContain('/budget');
  });

  it('unfolds the configuration surfaces while one of them is on screen', async () => {
    const fixture = render();

    await TestBed.inject(Router).navigateByUrl('/teams');
    fixture.detectChanges();

    expect(hrefsOf(fixture.nativeElement as HTMLElement)).toContain('/memory');
  });

  it('lists the conversations, each with who it is held with', () => {
    const element = render({
      agents: [agent()],
      teams: [{ id: 't1', name: 'Release Crew', memberCount: 2 }],
      chats: [
        chat(),
        chat({ id: 'c2', title: null, agentId: null, teamId: 't1' }),
        chat({ id: 'c3', title: 'Orphan', agentId: null }),
      ],
    }).nativeElement as HTMLElement;

    const rows = Array.from(element.querySelectorAll('.chat')).map((row) =>
      row.textContent?.replace(/\s+/g, ' ').trim(),
    );

    expect(rows[0]).toContain('Release planning');
    expect(rows[0]).toContain('Research Assistant');
    // An untitled chat is named rather than left blank, and a team is named
    // from the teams the shell holds.
    expect(rows[1]).toContain('Untitled chat');
    expect(rows[1]).toContain('Release Crew');
    expect(rows[2]).toContain('Owner deleted');
    expect(hrefsOf(element)).toContain('/chats/c2');
  });

  it('groups a project’s conversations under the project', () => {
    const element = render({
      agents: [agent()],
      projects: [{ id: 'p1', name: 'Compiler rewrite' }],
      chats: [chat({ projectId: 'p1' }), chat({ id: 'c2', title: 'Unfiled' })],
    }).nativeElement as HTMLElement;

    const groups = Array.from(element.querySelectorAll('.group'));

    expect(groups[0]?.querySelector('.group__label')?.textContent).toContain('Compiler rewrite');
    expect(groups[0]?.textContent).toContain('Release planning');
    expect(groups[0]?.textContent).not.toContain('Unfiled');
    expect(hrefsOf(element)).toContain('/projects/p1');
  });

  it('says so when there are no conversations yet', () => {
    const element = render().nativeElement as HTMLElement;

    expect(element.querySelector('.chats')?.textContent).toContain('No conversations yet');
  });

  it('names the open conversation in the trail', async () => {
    const fixture = render({ agents: [agent()], chats: [chat()] });

    await TestBed.inject(Router).navigateByUrl('/chats/c1');
    fixture.detectChanges();

    const here = (fixture.nativeElement as HTMLElement).querySelector('.trail__here');
    expect(here?.textContent).toContain('Release planning');
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
    answerRail(httpMock);
    answerProfile();
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
    answerRail(httpMock);
    answerProfile();
    fixture.detectChanges();

    // A 503 that carries a usable body is a report, not a failure.
    expect(stateClass(fixture)).toContain('trigger__state--degraded');
  });

  it('re-reads the workspace once the API is reachable again', () => {
    const fixture = render();
    const status = TestBed.inject(ApiStatusService);

    // What a request failing against a dead API reports.
    status.reportRequestFailure(new HttpErrorResponse({ status: 0 }));
    fixture.detectChanges();

    status.refresh();
    httpMock.expectOne(HEALTH_URL).flush(HEALTHY);
    fixture.detectChanges();

    // The startup reads that were stale while the API was down come back
    // once, on the transition ??not on every poll.
    answerProbe();
    httpMock
      .expectOne((request) => request.url === AGENTS_URL)
      .flush({ items: [], total: 0, limit: 100, offset: 0 });
    answerRail(httpMock);
    answerProfile();
    fixture.detectChanges();

    expect(stateClass(fixture)).toContain('trigger__state--online');
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
    answerRail(httpMock);
    answerProfile();
    fixture.detectChanges();

    // The rail keeps its places; the screen the user is on reports the
    // failure itself.
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
      .expectOne((request) => request.url === MODELS_URL && request.params.get('limit') === '1')
      .flush({}, { status: 404, statusText: 'Not Found' });
    httpMock
      .expectOne((request) => request.url === AGENTS_URL)
      .flush({ items: [], total: 0, limit: 100, offset: 0 });
    answerRail(httpMock);
    httpMock.expectOne(USER_URL).flush(PROFILE);
    httpMock.expectOne(BUDGET_URL).flush(BUDGET);
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
