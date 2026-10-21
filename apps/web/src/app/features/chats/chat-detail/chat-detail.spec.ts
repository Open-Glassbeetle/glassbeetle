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
import type { Message, MessageRole, MessageStatus } from '../../../core/api/messages.models';
import { AgentRosterService } from '../../../core/workspace/agent-roster.service';
import { ChatDetail } from './chat-detail';

const CHAT_URL = `${environment.apiBaseUrl}/chats/c1`;
const MESSAGES_URL = `${CHAT_URL}/messages`;
const TEAM_URL = `${environment.apiBaseUrl}/teams/t1`;

const AGENT: Agent = {
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
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
};

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

function message(
  sequence: number,
  role: MessageRole,
  content: string,
  overrides: Partial<Message> = {},
): Message {
  return {
    id: `m${sequence}`,
    chatId: 'c1',
    sequence,
    role,
    agentId: role === 'assistant' ? 'a1' : null,
    content,
    status: 'complete' as MessageStatus,
    tokenCount: null,
    createdAt: '2026-10-02T09:00:00.000Z',
    ...overrides,
  };
}

/** The conversation as the API returns it: newest first. */
const CONVERSATION = [
  message(2, 'assistant', 'Two sources disagree on the date.'),
  message(1, 'user', 'What does the archive say?'),
];

interface ChatDetailInternals {
  readonly form: { setValue(value: { title: string }): void };
  save(): void;
  detachProject(): Promise<void>;
  load(chatId: string): void;
  loadOlder(): Promise<void>;
}

function configure() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [ChatDetail],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: AgentRosterService,
        useValue: {
          agents: signal<readonly Agent[]>([AGENT]),
          loading: signal(false),
          loaded: signal(true),
          refresh: () => undefined,
        },
      },
      { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(true) }) } },
    ],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(ChatDetail);
  fixture.componentRef.setInput('chatId', 'c1');

  return { fixture, httpMock };
}

/** Answers the transcript read, which every render of the page makes. */
function flushMessages(
  httpMock: HttpTestingController,
  items: Message[] = CONVERSATION,
  total = items.length,
): TestRequest {
  const request = httpMock.expectOne((candidate) => candidate.url === MESSAGES_URL);
  request.flush({ items, total, limit: 50, offset: 0 });
  return request;
}

function setup(current: Chat = chat(), messages: Message[] = CONVERSATION, total?: number) {
  const { fixture, httpMock } = configure();
  fixture.detectChanges();

  httpMock.expectOne(CHAT_URL).flush(current);
  const transcript = flushMessages(httpMock, messages, total ?? messages.length);
  fixture.detectChanges();

  return {
    fixture,
    httpMock,
    transcript,
    element: fixture.nativeElement as HTMLElement,
    component: fixture.componentInstance as unknown as ChatDetailInternals,
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function patch(httpMock: HttpTestingController): TestRequest {
  return httpMock.expectOne(CHAT_URL);
}

describe('ChatDetail', () => {
  it('shows the chat and names the agent it belongs to', () => {
    const { element } = setup();

    expect(element.textContent).toContain('Release planning');
    expect(element.textContent).toContain('Research Assistant');
  });

  it('reads the owning team by name, which the shell does not hold', () => {
    const { httpMock, fixture } = setup(chat({ agentId: null, teamId: 't1' }));

    httpMock.expectOne(TEAM_URL).flush({
      id: 't1',
      name: 'Research Desk',
      description: null,
      memberCount: 2,
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-01T08:00:00.000Z',
    });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Research Desk');
  });

  it('names an untitled chat without pretending it has a title', () => {
    const { element } = setup(chat({ title: null }));

    expect(element.querySelector('.view__title')?.textContent?.trim()).toBe('Untitled chat');
  });

  it('holds the composer’s place without pretending it can send', () => {
    const { element } = setup();
    const composer = element.querySelector('.composer');

    // POST /messages exists, but nothing generates a reply, so there is
    // deliberately nothing here to type into.
    expect(composer?.textContent).toContain('completion endpoints');
    expect(composer?.querySelector('textarea')).toBeNull();
    expect(composer?.querySelector('input')).toBeNull();
  });

  it('shows a compacted summary when there is one', () => {
    const { element } = setup(chat({ contextSummary: 'Earlier turns, condensed.' }));

    expect(element.querySelector('.summary')?.textContent?.trim()).toBe(
      'Earlier turns, condensed.',
    );
  });

  it('saves a new title', () => {
    const { component, httpMock } = setup();

    component.form.setValue({ title: '  Renamed  ' });
    component.save();

    const request = patch(httpMock);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ title: 'Renamed' });
    request.flush(chat({ title: 'Renamed' }));
  });

  it('clears an emptied title with null rather than a blank string', () => {
    const { component, httpMock } = setup();

    component.form.setValue({ title: '   ' });
    component.save();

    const request = patch(httpMock);
    expect(request.request.body).toEqual({ title: null });
    request.flush(chat({ title: null }));
  });

  it('sends nothing when the title is retyped as it was', () => {
    const { component, httpMock } = setup();

    component.form.setValue({ title: 'Release planning' });
    component.save();

    httpMock.expectNone(CHAT_URL);
  });

  it('detaches the chat from its project with an explicit null', async () => {
    const { component, httpMock } = setup(chat({ projectId: 'p1' }));

    const pending = component.detachProject();
    await tick();

    const request = patch(httpMock);
    expect(request.request.body).toEqual({ projectId: null });
    request.flush(chat({ projectId: null }));
    await pending;
  });

  it('reports a chat that is not there as missing, not as a failure', () => {
    const { fixture, httpMock } = configure();
    fixture.detectChanges();

    httpMock
      .expectOne(CHAT_URL)
      .flush(
        { statusCode: 404, code: 'CHAT_NOT_FOUND', message: 'Chat with ID "c1" not found' },
        { status: 404, statusText: 'Not Found' },
      );
    httpMock
      .expectOne((candidate) => candidate.url === MESSAGES_URL)
      .flush(
        { statusCode: 404, code: 'CHAT_NOT_FOUND', message: 'Chat with ID "c1" not found' },
        { status: 404, statusText: 'Not Found' },
      );
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Chat not found');
    const hrefs = Array.from(element.querySelectorAll('a[href]')).map((link) =>
      link.getAttribute('href'),
    );
    expect(hrefs).toContain('/chats');
  });

  it('offers a retry when the read failed for another reason', () => {
    const { fixture, httpMock } = configure();
    fixture.detectChanges();

    httpMock
      .expectOne(CHAT_URL)
      .flush(
        { statusCode: 500, code: 'INTERNAL', message: 'boom' },
        { status: 500, statusText: 'Server Error' },
      );
    flushMessages(httpMock, []);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('boom');

    (fixture.componentInstance as unknown as ChatDetailInternals).load('c1');
    httpMock.expectOne(CHAT_URL).flush(chat());
    flushMessages(httpMock);
  });

  describe('the transcript', () => {
    it('reads the newest page, which is where a conversation is read', () => {
      const { transcript } = setup();

      expect(transcript.request.params.get('order')).toBe('desc');
      expect(transcript.request.params.get('limit')).toBe('50');
      // The first read has no cursor: it is the end of the conversation.
      expect(transcript.request.params.has('before')).toBe(false);
    });

    it('shows the turns oldest first, whatever order they arrived in', () => {
      const { element } = setup();
      const bubbles = Array.from(element.querySelectorAll('.bubble')).map((node) =>
        node.textContent?.trim(),
      );

      expect(bubbles).toEqual(['What does the archive say?', 'Two sources disagree on the date.']);
    });

    it('names the agent that produced an assistant turn', () => {
      const { element } = setup();

      expect(
        element.querySelector('.turn:not(.turn--own) .turn__author')?.textContent?.trim(),
      ).toBe('Research Assistant');
    });

    it('sets the person&rsquo;s own turns against the other side', () => {
      const { element } = setup();

      expect(element.querySelectorAll('.turn--own').length).toBe(1);
    });

    it('keeps a turn whose agent has been deleted, without inventing an author', () => {
      const { element } = setup(chat({ agentId: null, teamId: null }), [
        message(1, 'assistant', 'Said before the agent was removed', { agentId: null }),
      ]);

      expect(element.textContent).toContain('Said before the agent was removed');
      expect(element.querySelector('.turn__author')?.textContent?.trim()).toBe('Assistant');
    });

    it('draws system and tool turns as record rather than as speech', () => {
      const { element } = setup(chat(), [
        message(2, 'tool', 'search("archive")', { agentId: null }),
        message(1, 'system', 'You are a research analyst.'),
      ]);

      expect(element.querySelectorAll('.note').length).toBe(2);
      expect(element.querySelectorAll('.bubble').length).toBe(0);
    });

    it('marks a turn that did not finish', () => {
      const { element } = setup(chat(), [
        message(1, 'assistant', 'Half an answer', { status: 'error' }),
      ]);

      expect(element.querySelector('.pill')?.textContent?.trim()).toBe('error');
    });

    it('says nothing has been said when the chat is empty', () => {
      const { element } = setup(chat(), []);

      expect(element.textContent).toContain('No messages yet');
      expect(element.querySelector('.transcript')).toBeNull();
    });

    it('offers the earlier messages only when there are some', () => {
      const withAll = setup(chat(), CONVERSATION, 2);
      expect(withAll.element.querySelector('.earlier')).toBeNull();

      const withMore = setup(chat(), CONVERSATION, 7);
      expect(withMore.element.querySelector('.earlier')?.textContent).toContain(
        '5 earlier messages',
      );
    });

    it('pages upwards with a sequence cursor, not an offset', async () => {
      const { component, httpMock, fixture } = setup(chat(), CONVERSATION, 4);

      const pending = component.loadOlder();
      const request = httpMock.expectOne((candidate) => candidate.url === MESSAGES_URL);

      // The oldest turn on screen is sequence 1, so the page above it is
      // everything before that — unaffected by anything appended meanwhile.
      expect(request.request.params.get('before')).toBe('1');
      expect(request.request.params.get('order')).toBe('desc');
      expect(request.request.params.has('offset')).toBe(false);

      request.flush({
        items: [message(0, 'user', 'The first thing said')],
        total: 4,
        limit: 50,
        offset: 0,
      });
      await pending;
      fixture.detectChanges();

      const bubbles = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('.bubble'),
      ).map((node) => node.textContent?.trim());
      expect(bubbles[0]).toBe('The first thing said');
    });

    it('keeps the conversation when the transcript cannot be read', () => {
      const { fixture, httpMock } = configure();
      fixture.detectChanges();

      httpMock.expectOne(CHAT_URL).flush(chat());
      httpMock
        .expectOne((candidate) => candidate.url === MESSAGES_URL)
        .flush(
          { statusCode: 500, code: 'INTERNAL', message: 'transcript is down' },
          { status: 500, statusText: 'Server Error' },
        );
      fixture.detectChanges();

      const element = fixture.nativeElement as HTMLElement;
      // The chat itself still reads: only its turns are missing.
      expect(element.textContent).toContain('Release planning');
      expect(element.textContent).toContain('Could not load the conversation');
    });
  });

  it('abandons the request for the chat it was navigated away from', () => {
    const { fixture, httpMock } = configure();
    fixture.detectChanges();

    const first = httpMock.expectOne(CHAT_URL);

    fixture.componentRef.setInput('chatId', 'c2');
    fixture.detectChanges();

    const second = httpMock.expectOne(`${environment.apiBaseUrl}/chats/c2`);

    // Without the switch, a slow first response could land after the second
    // and leave the page showing the chat that is no longer open.
    expect(first.cancelled).toBe(true);

    second.flush(chat({ id: 'c2', title: 'Second' }));
    httpMock
      .expectOne((candidate) => candidate.url === `${environment.apiBaseUrl}/chats/c2/messages`)
      .flush({ items: [], total: 0, limit: 50, offset: 0 });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Second');
  });
});
