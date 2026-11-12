import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter, Router } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { environment } from '../../../../environments/environment';
import type { Agent } from '../../../core/api/agents.models';
import type { Chat } from '../../../core/api/chats.models';
import type { ChatContext, CompletionEvent } from '../../../core/api/completions.models';
import { CompletionsService } from '../../../core/api/completions.service';
import type { Message, MessageRole, MessageStatus } from '../../../core/api/messages.models';
import { AgentRosterService } from '../../../core/workspace/agent-roster.service';
import { ChatRunsService } from '../../../core/workspace/chat-runs.service';
import { ConversationsService } from '../../../core/workspace/conversations.service';
import { ModelCatalogService } from '../../../core/workspace/model-catalog.service';
import { ChatDetail } from './chat-detail';

const CHAT_URL = `${environment.apiBaseUrl}/chats/c1`;
const MESSAGES_URL = `${CHAT_URL}/messages`;

const AGENT: Agent = {
  id: 'a1',
  name: 'Research Assistant',
  personality: null,
  instructions: null,
  systemPromptId: null,
  modelId: 'm1',
  temperature: null,
  maxTokens: null,
  modelParams: null,
  hasPicture: false,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
};

const CONTEXT: ChatContext = {
  systemDetails: {
    promptTemplate: null,
    personality: null,
    instructions: 'Find sources.',
    memorySeam: null,
    contextSummary: null,
  },
  messageDetails: [{ sequence: 1 }, { sequence: 2 }],
  excludedMessages: [],
  tokenEstimate: {
    systemTokens: 20,
    messagesTokens: 180,
    totalTokens: 200,
    contextWindow: 1000,
    fitsContextWindow: true,
    heuristic: 'chars/4',
  },
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
  load(chatId: string): void;
  loadOlder(): Promise<void>;
  send(text: string): Promise<void>;
  moveToProject(projectId: string | null): Promise<void>;
  remove(): Promise<void>;
}

function configure(context: ChatContext | null = CONTEXT) {
  const streams: Subject<CompletionEvent>[] = [];
  const completions = {
    stream: vi.fn(() => {
      const stream = new Subject<CompletionEvent>();
      streams.push(stream);
      return stream.asObservable();
    }),
    context: vi.fn(() => (context ? of(context) : throwError(() => new Error('no context')))),
    compact: vi.fn(),
  };

  const conversations = {
    teams: signal([{ id: 't1', name: 'Release Crew', memberCount: 3 }]),
    projects: signal([{ id: 'p1', name: 'Compiler rewrite' }]),
    teamName: (id: string) => (id === 't1' ? 'Release Crew' : null),
    projectName: (id: string) => (id === 'p1' ? 'Compiler rewrite' : null),
    upsert: vi.fn(),
    touch: vi.fn(),
    drop: vi.fn(),
    refreshProjects: vi.fn(),
  };

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
      { provide: CompletionsService, useValue: completions },
      { provide: ConversationsService, useValue: conversations },
      {
        provide: ModelCatalogService,
        useValue: { labelFor: (agent: Agent | null) => (agent?.modelId ? 'qwen-coder' : null) },
      },
      { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(true) }) } },
    ],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(ChatDetail);
  fixture.componentRef.setInput('chatId', 'c1');

  return { fixture, httpMock, completions, conversations, streams };
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

function setup(
  current: Chat = chat(),
  messages: Message[] = CONVERSATION,
  total?: number,
  context: ChatContext | null = CONTEXT,
) {
  const configured = configure(context);
  const { fixture, httpMock } = configured;
  fixture.detectChanges();

  httpMock.expectOne(CHAT_URL).flush(current);
  const transcript = flushMessages(httpMock, messages, total ?? messages.length);
  fixture.detectChanges();

  return {
    ...configured,
    transcript,
    element: fixture.nativeElement as HTMLElement,
    component: fixture.componentInstance as unknown as ChatDetailInternals,
    runs: TestBed.inject(ChatRunsService),
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function text(element: Element | null | undefined): string {
  return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

const START: CompletionEvent = {
  type: 'message_start',
  data: {
    messageId: 'm3',
    chatId: 'c1',
    sequence: 3,
    agentId: 'a1',
    agentName: 'Research Assistant',
  },
};

describe('ChatDetail', () => {
  beforeEach(() => localStorage.clear());

  it('shows the chat and names the agent it is held with, and what that agent runs on', () => {
    const { element } = setup();

    expect(text(element.querySelector('.bar__title'))).toBe('Release planning');
    expect(text(element.querySelector('.who__name'))).toBe('Research Assistant');
    expect(text(element.querySelector('.who__detail'))).toBe('qwen-coder');
    expect(element.querySelector('.who')?.getAttribute('href')).toBe('/agents/a1');
  });

  it('names the owning team from the teams the shell holds', () => {
    const { element } = setup(chat({ agentId: null, teamId: 't1' }));

    expect(text(element.querySelector('.who__name'))).toBe('Release Crew');
    expect(text(element.querySelector('.who__detail'))).toBe('3 agents');
    expect(element.querySelector('.who')?.getAttribute('href')).toBe('/teams/t1');
  });

  it('names an untitled chat without pretending it has a title', () => {
    const { element } = setup(chat({ title: null }));
    const title = element.querySelector('.bar__title');

    expect(text(title)).toBe('Untitled chat');
    expect(title?.classList).toContain('unset');
  });

  it('says so, and offers nowhere to type, once the owner is gone', () => {
    const { element } = setup(chat({ agentId: null }));

    expect(element.querySelector('.who')?.textContent).toContain('Owner deleted');
    expect(element.querySelector<HTMLTextAreaElement>('gb-composer textarea')?.disabled).toBe(true);
  });

  it('shows how full the model’s window is', () => {
    const { element } = setup();

    expect(text(element.querySelector('.gauge__value'))).toBe('20%');
  });

  it('keeps the conversation usable when the context cannot be assembled', () => {
    const { element } = setup(chat(), CONVERSATION, undefined, null);

    expect(element.querySelector('.gauge__value')).toBeNull();
    expect(element.querySelectorAll('.turn')).toHaveLength(2);
  });

  it('files the chat under a project and tells the rail', async () => {
    const { component, httpMock, conversations, fixture, element } = setup();

    const moving = component.moveToProject('p1');
    const request = httpMock.expectOne(CHAT_URL);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ projectId: 'p1' });
    request.flush(chat({ projectId: 'p1' }));
    await moving;
    fixture.detectChanges();

    expect(text(element.querySelector('.fact__label'))).toBe('Compiler rewrite');
    expect(conversations.upsert).toHaveBeenCalledWith(chat({ projectId: 'p1' }));
  });

  it('takes the chat out of its project with an explicit null', async () => {
    const { component, httpMock } = setup(chat({ projectId: 'p1' }));

    const moving = component.moveToProject(null);
    const request = httpMock.expectOne(CHAT_URL);
    expect(request.request.body).toEqual({ projectId: null });
    request.flush(chat());
    await moving;
  });

  it('sends nothing when the chat is already where it was asked to go', async () => {
    const { component, httpMock } = setup(chat({ projectId: 'p1' }));

    await component.moveToProject('p1');

    httpMock.expectNone(CHAT_URL);
  });

  it('deletes the chat, drops it from the rail and opens a new one', async () => {
    const { component, httpMock, conversations } = setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const removing = component.remove();
    await tick();
    const request = httpMock.expectOne(CHAT_URL);
    expect(request.request.method).toBe('DELETE');
    request.flush(null);
    await removing;

    expect(conversations.drop).toHaveBeenCalledWith('c1');
    expect(navigate).toHaveBeenCalledWith(['/chats/new']);
  });

  it('reports a chat that is not there as missing, not as a failure', () => {
    const { fixture, httpMock, conversations } = configure();
    fixture.detectChanges();

    httpMock
      .expectOne(CHAT_URL)
      .flush(
        { statusCode: 404, error: 'Not Found', code: 'CHAT_NOT_FOUND', message: 'No such chat.' },
        { status: 404, statusText: 'Not Found' },
      );
    flushMessages(httpMock, []);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Chat not found');
    expect(element.textContent).not.toContain('Try again');
    // The rail should stop offering a chat that no longer exists.
    expect(conversations.drop).toHaveBeenCalledWith('c1');
  });

  it('offers a retry when the read failed for another reason', () => {
    const { fixture, httpMock } = configure();
    fixture.detectChanges();

    httpMock
      .expectOne(CHAT_URL)
      .flush(
        { statusCode: 500, error: 'Error', code: 'INTERNAL', message: 'Database is locked.' },
        { status: 500, statusText: 'Server Error' },
      );
    flushMessages(httpMock, []);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Could not load this chat');
    expect(element.textContent).toContain('Database is locked.');
    expect(element.textContent).toContain('Try again');
  });

  describe('the transcript', () => {
    it('reads the newest page, which is where a conversation is read', () => {
      const { transcript } = setup();

      expect(transcript.request.params.get('order')).toBe('desc');
      expect(transcript.request.params.get('limit')).toBe('50');
      expect(transcript.request.params.has('before')).toBe(false);
    });

    it('shows the turns oldest first, whatever order they arrived in', () => {
      const { element } = setup();
      const turns = Array.from(element.querySelectorAll('.turn')).map(text);

      expect(turns[0]).toContain('What does the archive say?');
      expect(turns[1]).toContain('Two sources disagree on the date.');
    });

    it('names the agent that produced a turn, and the model it ran on', () => {
      const { element } = setup();
      const head = element.querySelector('.turn:not(.turn--own) .turn__head');

      expect(text(head?.querySelector('.turn__author'))).toBe('Research Assistant');
      expect(text(head?.querySelector('.turn__model'))).toBe('qwen-coder');
      expect(head?.querySelector('a')?.getAttribute('href')).toBe('/agents/a1');
    });

    it('sets the person’s own turns apart from the agent’s', () => {
      const { element } = setup();
      const own = element.querySelectorAll('.turn--own');

      expect(own).toHaveLength(1);
      expect(text(own[0]?.querySelector('.request'))).toBe('What does the archive say?');
    });

    it('renders fenced code as a block that can be copied on its own', () => {
      const { element } = setup(chat(), [
        message(1, 'assistant', 'Use this:\n```ts\nconst a = 1;\n```'),
      ]);

      expect(text(element.querySelector('.code__language'))).toBe('ts');
      expect(element.querySelector('.code__body code')?.textContent).toBe('const a = 1;');
      expect(element.querySelector('.code__copy')).not.toBeNull();
    });

    it('keeps a turn whose agent has been deleted, without inventing an author', () => {
      const { element } = setup(chat({ agentId: null, teamId: 't1' }), [
        message(1, 'assistant', 'Still part of what was said.', { agentId: null }),
      ]);

      expect(text(element.querySelector('.turn__author'))).toBe('Assistant');
      expect(element.querySelector('.turn')?.textContent).toContain('Still part of what was said.');
    });

    it('draws system and tool turns as steps rather than as speech', () => {
      const { element } = setup(chat(), [
        message(2, 'tool', '{"rows":3}'),
        message(1, 'system', 'Context was trimmed.'),
      ]);

      expect(element.querySelectorAll('.turn')).toHaveLength(0);
      const steps = Array.from(element.querySelectorAll('.step'));
      expect(steps.map((step) => text(step.querySelector('.step__role')))).toEqual([
        'system',
        'tool',
      ]);
      // The whole content is there to be opened, not only the preview.
      expect(steps[1]?.querySelector('.step__content')?.textContent).toBe('{"rows":3}');
    });

    it('marks a turn that did not finish', () => {
      const { element } = setup(chat(), [
        message(1, 'assistant', 'Half an answ', { status: 'error' }),
      ]);

      expect(text(element.querySelector('.pill'))).toBe('error');
    });

    it('says nothing has been said when the chat is empty', () => {
      const { element } = setup(chat(), []);

      expect(element.textContent).toContain('Nothing has been said yet');
      expect(element.querySelector('.earlier')).toBeNull();
    });

    it('offers the earlier messages only when there are some', () => {
      expect(setup().element.querySelector('.earlier')).toBeNull();

      const { element } = setup(chat(), CONVERSATION, 120);
      expect(text(element.querySelector('.earlier'))).toContain('118 earlier messages');
    });

    it('pages upwards with a sequence cursor, not an offset', async () => {
      const { component, httpMock, fixture, element } = setup(
        chat(),
        [message(52, 'assistant', 'Latest.'), message(51, 'user', 'And then?')],
        52,
      );

      const loading = component.loadOlder();
      const request = httpMock.expectOne((candidate) => candidate.url === MESSAGES_URL);

      expect(request.request.params.get('before')).toBe('51');
      expect(request.request.params.has('offset')).toBe(false);

      request.flush({
        items: [message(50, 'assistant', 'Earlier answer.'), message(49, 'user', 'Earlier ask.')],
        total: 52,
        limit: 50,
        offset: 0,
      });
      await loading;
      fixture.detectChanges();

      const turns = Array.from(element.querySelectorAll('.turn')).map(text);
      expect(turns[0]).toContain('Earlier ask.');
      expect(turns[3]).toContain('Latest.');
    });

    it('keeps the header when the transcript cannot be read', () => {
      const { fixture, httpMock } = configure();
      fixture.detectChanges();

      httpMock.expectOne(CHAT_URL).flush(chat());
      httpMock
        .expectOne((candidate) => candidate.url === MESSAGES_URL)
        .flush(
          { statusCode: 500, error: 'Error', code: 'INTERNAL', message: 'Database is locked.' },
          { status: 500, statusText: 'Server Error' },
        );
      fixture.detectChanges();

      const element = fixture.nativeElement as HTMLElement;
      expect(text(element.querySelector('.bar__title'))).toBe('Release planning');
      expect(element.textContent).toContain('Could not load the conversation');
    });
  });

  describe('sending a turn', () => {
    it('stores the turn, shows it, and asks for the reply', async () => {
      const { component, httpMock, fixture, element, completions, conversations } = setup();

      const sending = component.send('And the second source?');
      const request = httpMock.expectOne((candidate) => candidate.url === MESSAGES_URL);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ content: 'And the second source?' });
      request.flush(message(3, 'user', 'And the second source?'));
      await sending;
      fixture.detectChanges();

      const own = element.querySelectorAll('.turn--own');
      expect(text(own[own.length - 1]?.querySelector('.request'))).toBe('And the second source?');
      expect(completions.stream).toHaveBeenCalledWith('c1');
      // A conversation that was just spoken in moves to the top of the rail.
      expect(conversations.touch).toHaveBeenCalledWith('c1');
    });

    it('puts the turn back where it was typed when it could not be stored', async () => {
      const { component, httpMock, fixture, element, completions } = setup();

      const sending = component.send('Lost?');
      httpMock
        .expectOne((candidate) => candidate.url === MESSAGES_URL)
        .flush(
          { statusCode: 500, error: 'Error', code: 'INTERNAL', message: 'Database is locked.' },
          { status: 500, statusText: 'Server Error' },
        );
      await sending;
      fixture.detectChanges();

      expect(element.querySelector<HTMLTextAreaElement>('gb-composer textarea')?.value).toBe(
        'Lost?',
      );
      expect(completions.stream).not.toHaveBeenCalled();
    });

    it('offers to ask for the reply when the last turn is the person’s and nobody is answering', () => {
      const { element, fixture, completions } = setup(chat(), [message(1, 'user', 'Anyone?')]);
      const pending = element.querySelector('.pending');

      expect(text(pending)).toContain('This message has no reply.');

      pending?.querySelector('button')?.click();
      fixture.detectChanges();

      // The reply is asked for; the turn is not stored a second time.
      expect(completions.stream).toHaveBeenCalledOnce();
    });
  });

  describe('a run', () => {
    it('shows the turn as it is written, and says what the agent is doing', () => {
      const { runs, streams, fixture, element } = setup();

      runs.start('c1');
      fixture.detectChanges();
      expect(text(element.querySelector('.activity__text'))).toBe('Research Assistant is starting');

      streams[0]!.next(START);
      streams[0]!.next({ type: 'thought', data: { messageId: 'm3', thought: 'Checking both.' } });
      fixture.detectChanges();
      expect(text(element.querySelector('.activity__text'))).toBe(
        'Research Assistant is reasoning',
      );
      expect(text(element.querySelector('.reasoning__text'))).toBe('Checking both.');

      streams[0]!.next({ type: 'token', data: { messageId: 'm3', text: 'The second ' } });
      streams[0]!.next({ type: 'token', data: { messageId: 'm3', text: 'agrees.' } });
      fixture.detectChanges();

      const live = element.querySelector('.turn--live');
      expect(text(element.querySelector('.activity__text'))).toBe('Research Assistant is writing');
      expect(text(live?.querySelector('.prose'))).toBe('The second agrees.');
      expect(live?.getAttribute('aria-busy')).toBe('true');
    });

    it('turns the send button into a stop button, which ends the run', () => {
      const { runs, streams, fixture, element } = setup();

      runs.start('c1');
      streams[0]!.next(START);
      fixture.detectChanges();

      const stop = element.querySelector<HTMLButtonElement>('.composer__send--stop');
      expect(stop).not.toBeNull();

      stop?.click();
      fixture.detectChanges();

      expect(runs.isRunning('c1')).toBe(false);
      expect(streams[0]!.observed).toBe(false);
      expect(element.querySelector('.activity__text')).toBeNull();
    });

    it('swaps the draft for the stored turn when the run is done', async () => {
      const { runs, streams, fixture, element, httpMock } = setup();

      runs.start('c1');
      streams[0]!.next(START);
      streams[0]!.next({ type: 'token', data: { messageId: 'm3', text: 'The second agrees.' } });
      streams[0]!.next({ type: 'done', data: '[DONE]' });

      const request = httpMock.expectOne((candidate) => candidate.url === MESSAGES_URL);
      // Read by sequence, after the last turn on screen.
      expect(request.request.params.get('after')).toBe('2');
      expect(request.request.params.get('order')).toBe('asc');
      request.flush({
        items: [message(3, 'assistant', 'The second agrees.', { tokenCount: 4 })],
        total: 3,
        limit: 50,
        offset: 0,
      });
      await tick();
      fixture.detectChanges();

      expect(element.querySelector('.turn--live')).toBeNull();
      const turns = Array.from(element.querySelectorAll('.turn')).map(text);
      expect(turns).toHaveLength(3);
      expect(turns[2]).toContain('The second agrees.');
      expect(turns[2]).toContain('4 tok');
    });

    it('draws the live draft, not the empty row the API opens for it', () => {
      const { runs, streams, fixture, element } = setup(chat(), [
        // What a reload mid-run reads: the turn's row exists, still empty.
        message(3, 'assistant', '', { status: 'streaming' }),
        ...CONVERSATION,
      ]);

      runs.start('c1');
      streams[0]!.next(START);
      streams[0]!.next({ type: 'token', data: { messageId: 'm3', text: 'Half' } });
      fixture.detectChanges();

      expect(element.querySelectorAll('.turn')).toHaveLength(3);
      expect(text(element.querySelector('.turn--live .prose'))).toBe('Half');
    });

    it('says why a run failed and offers to try again', async () => {
      const { runs, streams, fixture, element, httpMock, completions } = setup();

      runs.start('c1');
      streams[0]!.next({
        type: 'error',
        data: { code: 'RATE_LIMITED', message: 'The provider is rate limiting requests.' },
      });
      httpMock
        .expectOne((candidate) => candidate.url === MESSAGES_URL)
        .flush({ items: [], total: 2, limit: 50, offset: 0 });
      await tick();
      fixture.detectChanges();

      const failure = element.querySelector('.failure');
      expect(text(failure)).toContain('The reply could not be generated');
      expect(text(failure)).toContain('The provider is rate limiting requests.');

      const retry = Array.from(failure?.querySelectorAll('button') ?? []).find((button) =>
        button.textContent?.includes('Retry'),
      );
      retry?.click();
      fixture.detectChanges();

      expect(completions.stream).toHaveBeenCalledTimes(2);
      expect(element.querySelector('.failure')).toBeNull();
    });

    it('tells the service which chat is on screen, and that it left', () => {
      const { runs, fixture } = setup();
      const view = vi.spyOn(runs, 'view');

      fixture.destroy();

      expect(view).toHaveBeenCalledWith(null);
    });
  });

  it('abandons the request for the chat it was navigated away from', () => {
    const { fixture, httpMock } = configure();
    fixture.detectChanges();

    const first = httpMock.expectOne(CHAT_URL);
    const firstTranscript = httpMock.expectOne((candidate) => candidate.url === MESSAGES_URL);

    fixture.componentRef.setInput('chatId', 'c2');
    fixture.detectChanges();

    expect(first.cancelled).toBe(true);
    expect(firstTranscript.cancelled).toBe(true);

    httpMock
      .expectOne(`${environment.apiBaseUrl}/chats/c2`)
      .flush(chat({ id: 'c2', title: 'Second' }));
    httpMock
      .expectOne((candidate) => candidate.url === `${environment.apiBaseUrl}/chats/c2/messages`)
      .flush({ items: [], total: 0, limit: 50, offset: 0 });
    fixture.detectChanges();

    expect(text((fixture.nativeElement as HTMLElement).querySelector('.bar__title'))).toBe(
      'Second',
    );
  });
});
