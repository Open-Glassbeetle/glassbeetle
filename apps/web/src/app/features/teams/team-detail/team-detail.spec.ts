import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { environment } from '../../../../environments/environment';
import type { Team, TeamMember } from '../../../core/api/teams.models';
import { TeamDetail } from './team-detail';

const TEAM_ID = 't1';
const TEAM_URL = `${environment.apiBaseUrl}/teams/${TEAM_ID}`;
const MEMBERS_URL = `${environment.apiBaseUrl}/teams/${TEAM_ID}/members`;
const ORDER_URL = `${MEMBERS_URL}/order`;

const TEAM: Team = {
  id: TEAM_ID,
  name: 'Research Desk',
  description: 'Finds things',
  memberCount: 3,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
};

function member(agentId: string, position: number, role: string | null = null): TeamMember {
  return {
    teamId: TEAM_ID,
    agentId,
    role,
    position,
    createdAt: '2026-10-01T08:00:00.000Z',
  };
}

const MEMBERS = [member('a1', 0, 'Supervisor'), member('a2', 1), member('a3', 2)];

function setup(members: TeamMember[] = MEMBERS, team: Team = TEAM) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [TeamDetail],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(TeamDetail);
  fixture.componentRef.setInput('teamId', TEAM_ID);
  fixture.detectChanges();

  httpMock.expectOne(TEAM_URL).flush(team);
  httpMock
    .expectOne((request) => request.url === MEMBERS_URL)
    .flush({ items: members, total: members.length, limit: 100, offset: 0 });
  fixture.detectChanges();

  const component = fixture.componentInstance as unknown as {
    move: (index: number, by: -1 | 1) => Promise<void>;
    setRole: (agentId: string, raw: string) => Promise<void>;
    buildPatch: () => Record<string, unknown>;
    form: { patchValue: (value: Record<string, unknown>) => void };
    available: () => Array<{ id: string }>;
    entries: () => Array<{ name: string }>;
  };

  return { fixture, component, httpMock };
}

/** Lets the awaits inside a roster write run before the next expectation. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Answers the re-read every roster write makes, so `verify()` stays clean.
 *
 * The write is awaited first: the component only asks for the fresh roster
 * once its own request has resolved, so the requests do not exist yet at the
 * moment the write is flushed.
 */
async function answerReread(httpMock: HttpTestingController, members: TeamMember[]) {
  await tick();
  httpMock.expectOne(TEAM_URL).flush(TEAM);
  httpMock
    .expectOne((request) => request.url === MEMBERS_URL)
    .flush({ items: members, total: members.length, limit: 100, offset: 0 });
}

describe('TeamDetail', () => {
  it('loads the team and its roster', () => {
    const { fixture } = setup();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Research Desk');
  });

  it('numbers the roster from one, in turn order', () => {
    const { fixture } = setup();
    const ranks = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.member__rank'),
    ).map((element) => element.textContent?.trim());

    expect(ranks).toEqual(['1', '2', '3']);
  });

  it('falls back to the agent id when the rail has not loaded that agent', () => {
    const { component } = setup();

    // The roster service is empty in this test, so no agent resolves.
    expect(component.entries().map((entry) => entry.name)).toEqual(['a1', 'a2', 'a3']);
  });

  describe('reordering', () => {
    it('sends the whole order, with one pair swapped', async () => {
      const { component, httpMock } = setup();

      const pending = component.move(1, -1);
      const request = httpMock.expectOne(ORDER_URL);

      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ agentIds: ['a2', 'a1', 'a3'] });

      request.flush({ items: MEMBERS, total: 3, limit: 100, offset: 0 });
      await answerReread(httpMock, MEMBERS);
      await pending;
    });

    it('moves an agent later', async () => {
      const { component, httpMock } = setup();

      const pending = component.move(0, 1);
      const request = httpMock.expectOne(ORDER_URL);

      expect(request.request.body).toEqual({ agentIds: ['a2', 'a1', 'a3'] });

      request.flush({ items: MEMBERS, total: 3, limit: 100, offset: 0 });
      await answerReread(httpMock, MEMBERS);
      await pending;
    });

    it('does nothing at the ends, rather than sending an unchanged order', async () => {
      const { component, httpMock } = setup();

      await component.move(0, -1);
      await component.move(2, 1);

      httpMock.expectNone(ORDER_URL);
    });

    it('re-reads the roster afterwards instead of guessing the new numbering', async () => {
      const { component, httpMock, fixture } = setup();
      const reordered = [member('a2', 0), member('a1', 1, 'Supervisor'), member('a3', 2)];

      const pending = component.move(1, -1);
      httpMock.expectOne(ORDER_URL).flush({ items: reordered, total: 3, limit: 100, offset: 0 });
      await answerReread(httpMock, reordered);
      await pending;
      fixture.detectChanges();

      expect(component.entries().map((entry) => entry.name)).toEqual(['a2', 'a1', 'a3']);
    });
  });

  describe('roles', () => {
    it('sends a trimmed role', async () => {
      const { component, httpMock } = setup();

      const pending = component.setRole('a2', '  Researcher  ');
      const request = httpMock.expectOne(`${MEMBERS_URL}/a2`);

      expect(request.request.method).toBe('PATCH');
      expect(request.request.body).toEqual({ role: 'Researcher' });

      request.flush(member('a2', 1, 'Researcher'));
      await answerReread(httpMock, MEMBERS);
      await pending;
    });

    it('clears a role emptied to whitespace with null, not an empty string', async () => {
      const { component, httpMock } = setup();

      const pending = component.setRole('a1', '   ');
      const request = httpMock.expectOne(`${MEMBERS_URL}/a1`);

      expect(request.request.body).toEqual({ role: null });

      request.flush(member('a1', 0, null));
      await answerReread(httpMock, MEMBERS);
      await pending;
    });

    it('sends nothing when the role is retyped as it was', async () => {
      const { component, httpMock } = setup();

      await component.setRole('a1', 'Supervisor');

      httpMock.expectNone(`${MEMBERS_URL}/a1`);
    });
  });

  describe('the settings patch', () => {
    it('sends nothing when nothing changed', () => {
      const { component } = setup();

      expect(component.buildPatch()).toEqual({});
    });

    it('sends only what changed', () => {
      const { component } = setup();
      component.form.patchValue({ name: 'Release Crew' });

      expect(component.buildPatch()).toEqual({ name: 'Release Crew' });
    });

    it('clears an emptied description with null', () => {
      const { component } = setup();
      component.form.patchValue({ description: '  ' });

      expect(component.buildPatch()).toEqual({ description: null });
    });
  });
});
