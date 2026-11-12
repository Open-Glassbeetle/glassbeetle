import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';

import { environment } from '../../../../environments/environment';
import type { Agent } from '../../../core/api/agents.models';
import { CapabilitiesService } from '../../../core/platform/capabilities.service';
import { AgentRosterService } from '../../../core/workspace/agent-roster.service';
import { ChatRunsService } from '../../../core/workspace/chat-runs.service';
import { ConversationsService } from '../../../core/workspace/conversations.service';
import { ModelCatalogService } from '../../../core/workspace/model-catalog.service';
import { ChatNew, titleFromMessage } from './chat-new';

const CHATS_URL = `${environment.apiBaseUrl}/chats`;

function agent(id: string, name: string, modelId: string | null = 'm1'): Agent {
  return {
    id,
    name,
    personality: null,
    instructions: null,
    systemPromptId: null,
    modelId,
    temperature: null,
    maxTokens: null,
    modelParams: null,
    hasPicture: false,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-01T08:00:00.000Z',
  };
}

const CREATED = {
  id: 'c9',
  title: 'Find the source.',
  projectId: null,
  agentId: 'a2',
  teamId: null,
  contextSummary: null,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
};

interface ChatNewInternals {
  start(text: string): Promise<void>;
  chooseTeam(team: unknown): void;
  chooseProject(projectId: string | null): void;
}

function setup(
  options: {
    agents?: Agent[];
    teams?: { id: string; name: string; memberCount: number }[];
    inputs?: Record<string, string>;
  } = {},
) {
  const agents = options.agents ?? [agent('a1', 'Unready', null), agent('a2', 'Code Reviewer')];
  const teams = options.teams ?? [{ id: 't1', name: 'Release Crew', memberCount: 2 }];
  const runs = { start: vi.fn() };
  const conversations = {
    loaded: signal(true),
    teams: signal(teams),
    projects: signal([{ id: 'p1', name: 'Compiler rewrite' }]),
    upsert: vi.fn(),
  };

  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [ChatNew],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: AgentRosterService,
        useValue: { agents: signal(agents), loaded: signal(true), loading: signal(false) },
      },
      { provide: ConversationsService, useValue: conversations },
      { provide: ChatRunsService, useValue: runs },
      { provide: CapabilitiesService, useValue: { modelsAvailable: signal(true) } },
      {
        provide: ModelCatalogService,
        useValue: { labelFor: (entry: Agent) => (entry.modelId ? 'qwen-coder' : null) },
      },
    ],
  });

  const fixture = TestBed.createComponent(ChatNew);
  for (const [name, value] of Object.entries(options.inputs ?? {})) {
    fixture.componentRef.setInput(name, value);
  }
  fixture.detectChanges();

  return {
    fixture,
    runs,
    conversations,
    element: fixture.nativeElement as HTMLElement,
    component: fixture.componentInstance as unknown as ChatNewInternals,
    httpMock: TestBed.inject(HttpTestingController),
    navigate: vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true),
  };
}

function text(element: Element | null | undefined): string {
  return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('titleFromMessage', () => {
  it('uses the first line that says anything', () => {
    expect(titleFromMessage('\n  Fix the   lexer \nand more detail')).toBe('Fix the lexer');
  });

  it('cuts a long line at a word and marks the cut', () => {
    const title = titleFromMessage(`${'word '.repeat(40)}`);

    expect(title.length).toBeLessThanOrEqual(73);
    expect(title.endsWith('word…')).toBe(true);
  });
});

describe('ChatNew', () => {
  it('starts with an agent that can actually answer', () => {
    const { element } = setup();

    // The first agent has no model; the chat is offered to the one that does.
    expect(text(element.querySelector('.start__with'))).toBe('with Code Reviewer');
    expect(element.querySelector('.obstacle')).toBeNull();
  });

  it('starts with whoever the link that led here asked for', () => {
    const { element } = setup({ inputs: { teamId: 't1' } });

    expect(text(element.querySelector('.start__with'))).toBe('with Release Crew');
  });

  it('says before anything is sent that the chosen agent cannot reply', () => {
    const { element } = setup({ inputs: { agentId: 'a1' } });
    const obstacle = element.querySelector('.obstacle');

    expect(text(obstacle)).toContain('Unready has no model assigned');
    expect(obstacle?.querySelector('a')?.getAttribute('href')).toBe('/agents/a1');
  });

  it('points at creating an agent when there is nobody to talk to', () => {
    const { element } = setup({ agents: [], teams: [] });

    expect(element.textContent).toContain('Nobody to talk to yet');
    expect(element.querySelector('gb-composer')).toBeNull();
  });

  it('creates the chat, stores the first turn, asks for the reply and opens it', async () => {
    const { component, httpMock, runs, conversations, navigate } = setup();

    const starting = component.start('Find the source.\nIt is in the archive.');

    const create = httpMock.expectOne(CHATS_URL);
    // Exactly one owner key, and the title taken from the first line.
    expect(create.request.body).toEqual({ agentId: 'a2', title: 'Find the source.' });
    create.flush(CREATED);
    await Promise.resolve();

    const turn = httpMock.expectOne(`${CHATS_URL}/c9/messages`);
    expect(turn.request.body).toEqual({ content: 'Find the source.\nIt is in the archive.' });
    turn.flush({ id: 'm1' });
    await starting;

    expect(conversations.upsert).toHaveBeenCalledWith(CREATED, true);
    expect(runs.start).toHaveBeenCalledWith('c9');
    expect(navigate).toHaveBeenCalledWith(['/chats', 'c9']);
  });

  it('files the chat under the chosen project and sends it to the chosen team', async () => {
    const { component, httpMock } = setup();

    component.chooseTeam({ id: 't1', name: 'Release Crew', memberCount: 2 });
    component.chooseProject('p1');
    const starting = component.start('Draft the notes.');

    const create = httpMock.expectOne(CHATS_URL);
    expect(create.request.body).toEqual({
      teamId: 't1',
      title: 'Draft the notes.',
      projectId: 'p1',
    });
    create.flush({ ...CREATED, agentId: null, teamId: 't1', projectId: 'p1' });
    await Promise.resolve();
    httpMock.expectOne(`${CHATS_URL}/c9/messages`).flush({ id: 'm1' });
    await starting;
  });

  it('keeps the turn in the field when the chat could not be created', async () => {
    const { component, httpMock, fixture, element, runs, navigate } = setup();

    const starting = component.start('Find the source.');
    httpMock
      .expectOne(CHATS_URL)
      .flush(
        { statusCode: 500, error: 'Error', code: 'INTERNAL', message: 'Database is locked.' },
        { status: 500, statusText: 'Server Error' },
      );
    await starting;
    fixture.detectChanges();

    expect(element.querySelector('textarea')?.value).toBe('Find the source.');
    expect(runs.start).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('still opens the chat when it exists but its first turn could not be stored', async () => {
    const { component, httpMock, runs, navigate } = setup();

    const starting = component.start('Find the source.');
    httpMock.expectOne(CHATS_URL).flush(CREATED);
    await Promise.resolve();
    httpMock
      .expectOne(`${CHATS_URL}/c9/messages`)
      .flush(
        { statusCode: 500, error: 'Error', code: 'INTERNAL', message: 'Database is locked.' },
        { status: 500, statusText: 'Server Error' },
      );
    await starting;

    // Nothing to reply to, so no reply is asked for — but the chat is real.
    expect(runs.start).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/chats', 'c9']);
  });
});
