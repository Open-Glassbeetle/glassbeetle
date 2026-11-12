import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import type { Chat } from '../api/chats.models';
import { ConversationsService } from './conversations.service';

const API = environment.apiBaseUrl;

function chat(id: string, overrides: Partial<Chat> = {}): Chat {
  return {
    id,
    title: `Chat ${id}`,
    projectId: null,
    agentId: 'a1',
    teamId: null,
    contextSummary: null,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-02T08:00:00.000Z',
    ...overrides,
  };
}

function page<T>(items: T[], total = items.length) {
  return { items, total, limit: 100, offset: 0 };
}

function setup(chats: Chat[] = [chat('c1'), chat('c2')], total?: number) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });

  const service = TestBed.inject(ConversationsService);
  const httpMock = TestBed.inject(HttpTestingController);

  service.refresh();

  const request = httpMock.expectOne((candidate) => candidate.url === `${API}/chats`);
  request.flush(page(chats, total));
  httpMock
    .expectOne((candidate) => candidate.url === `${API}/teams`)
    .flush(page([{ id: 't1', name: 'Release Crew' }]));
  httpMock
    .expectOne((candidate) => candidate.url === `${API}/projects`)
    .flush(page([{ id: 'p1', name: 'Compiler' }]));

  return { service, httpMock, request };
}

describe('ConversationsService', () => {
  it('reads the most recently active conversations first', () => {
    const { service, request } = setup();

    expect(request.request.params.get('sort')).toBe('updatedAt');
    expect(request.request.params.get('order')).toBe('desc');
    expect(service.chats().map((entry) => entry.id)).toEqual(['c1', 'c2']);
    expect(service.loaded()).toBe(true);
  });

  it('names the teams and projects a chat only carries the ids of', () => {
    const { service } = setup();

    expect(service.teamName('t1')).toBe('Release Crew');
    expect(service.projectName('p1')).toBe('Compiler');
    expect(service.projectName('missing')).toBeNull();
  });

  it('says when there are more conversations than it holds', () => {
    expect(setup([chat('c1')], 240).service.truncated()).toBe(true);
    expect(setup([chat('c1')]).service.truncated()).toBe(false);
  });

  it('puts a new chat first without asking again', () => {
    const { service, httpMock } = setup();

    service.upsert(chat('c3'));

    expect(service.chats().map((entry) => entry.id)).toEqual(['c3', 'c1', 'c2']);
    expect(service.total()).toBe(3);
    httpMock.verify();
  });

  it('renames in place, and moves a chat up only when it was spoken in', () => {
    const { service } = setup();

    service.upsert(chat('c2', { title: 'Renamed' }));

    expect(service.chats().map((entry) => entry.title)).toEqual(['Chat c1', 'Renamed']);

    service.touch('c2');

    expect(service.chats().map((entry) => entry.id)).toEqual(['c2', 'c1']);
  });

  it('drops a deleted chat', () => {
    const { service } = setup();

    service.drop('c1');

    expect(service.chats().map((entry) => entry.id)).toEqual(['c2']);
    expect(service.total()).toBe(1);
  });

  it('keeps what it had when a re-read fails', () => {
    const { service, httpMock } = setup();

    service.refresh();
    httpMock
      .expectOne((candidate) => candidate.url === `${API}/chats`)
      .flush(null, { status: 500, statusText: 'Server Error' });
    httpMock.expectOne((candidate) => candidate.url === `${API}/teams`).flush(page([]));
    httpMock.expectOne((candidate) => candidate.url === `${API}/projects`).flush(page([]));

    expect(service.failed()).toBe(true);
    expect(service.chats()).toHaveLength(2);
  });
});
