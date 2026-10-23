import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { environment } from '../../../../environments/environment';
import type { Agent } from '../../../core/api/agents.models';
import type { Chat } from '../../../core/api/chats.models';
import type { Team } from '../../../core/api/teams.models';
import { AgentRosterService } from '../../../core/workspace/agent-roster.service';
import { ChatList } from './chat-list';

const CHATS_URL = `${environment.apiBaseUrl}/chats`;
const TEAMS_URL = `${environment.apiBaseUrl}/teams`;

function agent(id: string, name: string): Agent {
  return {
    id,
    name,
    personality: null,
    instructions: null,
    systemPromptId: null,
    modelId: null,
    temperature: null,
    maxTokens: null,
    modelParams: null,
    hasPicture: false,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
  };
}

function team(id: string, name: string): Team {
  return {
    id,
    name,
    description: null,
    memberCount: 2,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
  };
}

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'c1',
    title: 'Release planning',
    projectId: null,
    agentId: 'a1',
    teamId: null,
    contextSummary: null,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-02T08:00:00.000Z',
    ...overrides,
  };
}

const AGENTS = [agent('a1', 'Research Assistant')];
const TEAMS = [team('t1', 'Research Desk')];

/** What the component exposes to its template, reached for assertions. */
interface ChatListInternals {
  readonly list: {
    readonly pageIndex: { set(value: number): void };
    reload(): void;
    clearSearch(): void;
  };
  setOwnerFilter(value: string): void;
  setSort(key: string): void;
  remove(chat: Chat): Promise<void>;
}

function setup(
  options: { chats?: Chat[]; agents?: Agent[]; teams?: Team[]; confirm?: boolean } = {},
) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [ChatList],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        // The rail holds the roster in the running app; here it is seeded
        // directly so the rows have agent names without a second request.
        provide: AgentRosterService,
        useValue: {
          agents: signal<readonly Agent[]>(options.agents ?? AGENTS),
          loading: signal(false),
          loaded: signal(true),
          refresh: () => undefined,
        },
      },
      {
        provide: MatDialog,
        useValue: { open: () => ({ afterClosed: () => of(options.confirm ?? true) }) },
      },
    ],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(ChatList);

  // The teams read is fired from the constructor, the chats read by the
  // effect inside `ListState` on the first change detection.
  const teams = options.teams ?? TEAMS;
  httpMock
    .expectOne((request) => request.url === TEAMS_URL)
    .flush({ items: teams, total: teams.length, limit: 100, offset: 0 });

  fixture.detectChanges();

  const items = options.chats ?? [chat()];
  const request = httpMock.expectOne((candidate) => candidate.url === CHATS_URL);
  request.flush({ items, total: items.length, limit: 25, offset: 0 });
  fixture.detectChanges();

  return {
    fixture,
    httpMock,
    first: request,
    element: fixture.nativeElement as HTMLElement,
    component: fixture.componentInstance as unknown as ChatListInternals,
  };
}

/** Lets the awaits inside a confirmed write run before the next expectation. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Outlasts the search box's debounce, so the typed term reaches the request. */
function debounce(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 300));
}

/** The next chats request, whatever filters it carries. */
function nextChats(httpMock: HttpTestingController): TestRequest {
  return httpMock.expectOne((candidate) => candidate.url === CHATS_URL);
}

function flush(request: TestRequest, items: Chat[] = []): void {
  request.flush({ items, total: items.length, limit: 25, offset: 0 });
}

describe('ChatList', () => {
  it('reads the first page sorted by when a chat was last touched', () => {
    const { first } = setup();

    expect(first.request.params.get('sort')).toBe('updatedAt');
    expect(first.request.params.get('order')).toBe('desc');
  });

  it('sends no text filter until something is typed', () => {
    const { first } = setup();

    expect(first.request.params.has('search')).toBe(false);
  });

  it('names each chat and the agent it belongs to', () => {
    const { element } = setup();

    expect(element.textContent).toContain('Release planning');
    expect(element.textContent).toContain('Agent · Research Assistant');
  });

  it('resolves a team owner from the teams it loaded', () => {
    const { element } = setup({ chats: [chat({ agentId: null, teamId: 't1' })] });

    expect(element.textContent).toContain('Team · Research Desk');
  });

  it('falls back to the id when the owner is not in hand', () => {
    const { element } = setup({ chats: [chat({ agentId: 'a9' })] });

    expect(element.textContent).toContain('Agent · a9');
  });

  it('names an untitled chat rather than showing a blank row', () => {
    const { element } = setup({ chats: [chat({ title: null })] });

    expect(element.querySelector('.row__name')?.textContent?.trim()).toBe('Untitled chat');
  });

  it('says so when the owner has been deleted', () => {
    const { element } = setup({ chats: [chat({ agentId: null, teamId: null })] });

    expect(element.textContent).toContain('Owner deleted');
  });

  it('filters by one owner and returns to the first page', () => {
    const { component, httpMock, fixture } = setup();

    component.list.pageIndex.set(2);
    fixture.detectChanges();
    flush(nextChats(httpMock));

    component.setOwnerFilter('agent:a1');
    fixture.detectChanges();

    const request = nextChats(httpMock);
    expect(request.request.params.get('agentId')).toBe('a1');
    expect(request.request.params.get('offset')).toBe('0');
    flush(request, [chat()]);
  });

  it('searches by title from the box, alongside the owner filter, from the first page', async () => {
    const { component, element, httpMock, fixture } = setup();

    component.setOwnerFilter('agent:a1');
    fixture.detectChanges();
    flush(nextChats(httpMock), [chat()]);

    component.list.pageIndex.set(1);
    fixture.detectChanges();
    flush(nextChats(httpMock), [chat()]);

    const input = element.querySelector<HTMLInputElement>('input.search__input');
    expect(input).not.toBeNull();
    input!.value = 'plan';
    input!.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // The box is debounced before it reaches the API.
    await debounce();
    fixture.detectChanges();

    // Typing returns to the first page straight away; the term follows once
    // the debounce settles. The last request is the one the list keeps.
    const requests = httpMock.match((candidate) => candidate.url === CHATS_URL);
    const request = requests[requests.length - 1]!;
    expect(request.request.params.get('search')).toBe('plan');
    expect(request.request.params.get('agentId')).toBe('a1');
    expect(request.request.params.get('offset')).toBe('0');
    requests.filter((pending) => !pending.cancelled).forEach((pending) => flush(pending, [chat()]));
  });

  it('says nothing matches, rather than that no chats exist, when a search finds nothing', async () => {
    const { element, httpMock, fixture } = setup();

    const input = element.querySelector<HTMLInputElement>('input.search__input')!;
    input.value = 'nothing like this';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await debounce();
    fixture.detectChanges();

    flush(nextChats(httpMock), []);
    fixture.detectChanges();

    expect(element.textContent).toContain('No matching chats');
    expect(element.textContent).toContain('nothing like this');
    expect(element.textContent).not.toContain('No chats yet');

    const clear = Array.from(element.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Clear filters'),
    );
    clear!.click();
    fixture.detectChanges();
    await debounce();
    fixture.detectChanges();

    const request = nextChats(httpMock);
    expect(request.request.params.has('search')).toBe(false);
    flush(request, [chat()]);
  });

  it('asks for both columns being empty to find chats whose owner is gone', () => {
    const { component, httpMock, fixture } = setup();

    component.setOwnerFilter('orphaned');
    fixture.detectChanges();

    const request = nextChats(httpMock);
    expect(request.request.params.get('agentId')).toBe('null');
    expect(request.request.params.get('teamId')).toBe('null');
    flush(request);
  });

  it('sorts by title on request', () => {
    const { component, httpMock, fixture } = setup();

    component.setSort('title');
    fixture.detectChanges();

    const request = nextChats(httpMock);
    expect(request.request.params.get('sort')).toBe('title');
    expect(request.request.params.get('order')).toBe('asc');
    flush(request, [chat()]);
  });

  it('ignores a sort key it does not offer instead of sending it on', () => {
    const { component, httpMock, fixture } = setup();

    component.setSort('nonsense');
    fixture.detectChanges();

    httpMock.expectNone((candidate) => candidate.url === CHATS_URL);
  });

  it('deletes a chat and re-reads the page', async () => {
    const { component, httpMock, fixture } = setup();

    const pending = component.remove(chat());
    // The confirmation resolves through the task queue before the request goes.
    await tick();

    const request = httpMock.expectOne(`${CHATS_URL}/c1`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });

    await pending;
    fixture.detectChanges();
    flush(nextChats(httpMock));
  });

  it('leaves the chat alone when the confirmation is declined', async () => {
    const { component, httpMock } = setup({ confirm: false });

    await component.remove(chat());
    await tick();

    httpMock.expectNone(`${CHATS_URL}/c1`);
  });

  it('offers a retry when the page could not be read', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ChatList],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });

    const httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ChatList);
    httpMock
      .expectOne((request) => request.url === TEAMS_URL)
      .flush({ items: [], total: 0, limit: 100, offset: 0 });
    fixture.detectChanges();

    nextChats(httpMock).flush(
      { statusCode: 500, code: 'INTERNAL', message: 'boom' },
      { status: 500, statusText: 'Server Error' },
    );
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Could not load chats');
    expect(element.textContent).toContain('boom');

    (fixture.componentInstance as unknown as ChatListInternals).list.reload();
    flush(nextChats(httpMock));
  });

  it('points at creating an agent when there is nothing a chat could belong to', () => {
    const { element } = setup({ chats: [], agents: [], teams: [] });

    expect(element.textContent).toContain('Nothing to chat with yet');
    const hrefs = Array.from(element.querySelectorAll('a[href]')).map((link) =>
      link.getAttribute('href'),
    );
    expect(hrefs.some((href) => href?.startsWith('/agents'))).toBe(true);
  });

  it('invites a first chat when there is an owner but no conversation yet', () => {
    const { element } = setup({ chats: [] });

    expect(element.textContent).toContain('No chats yet');
  });
});
