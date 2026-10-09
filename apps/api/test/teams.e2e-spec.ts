import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness/index.js';

describe('Teams endpoints (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(() => {
    testApp.reset();
  });

  async function createTeam(
    body: Record<string, unknown> = { name: 'Research Desk' },
  ) {
    const response = await testApp
      .request()
      .post('/api/v1/teams')
      .send(body)
      .expect(201);
    return response.body;
  }

  function createAgent(name: string) {
    return testApp.fixtures.createAgent({ name });
  }

  async function addMember(teamId: string, agentId: string, role?: string) {
    const response = await testApp
      .request()
      .post(`/api/v1/teams/${teamId}/members`)
      .send(role === undefined ? { agentId } : { agentId, role })
      .expect(201);
    return response.body;
  }

  async function roster(teamId: string): Promise<string[]> {
    const response = await testApp
      .request()
      .get(`/api/v1/teams/${teamId}/members`)
      .expect(200);
    return response.body.items.map(
      (member: { agentId: string }) => member.agentId,
    );
  }

  describe('the team lifecycle', () => {
    it('covers create → read → list → update → delete with one representation throughout', async () => {
      const created = await createTeam({
        name: 'Research Desk',
        description: 'Finds things',
      });

      expect(created).toMatchObject({
        name: 'Research Desk',
        description: 'Finds things',
        memberCount: 0,
      });
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

      const read = await testApp
        .request()
        .get(`/api/v1/teams/${created.id}`)
        .expect(200);
      expect(read.body).toEqual(created);

      const listed = await testApp.request().get('/api/v1/teams').expect(200);
      expect(listed.body.items[0]).toEqual(created);

      const updated = await testApp
        .request()
        .patch(`/api/v1/teams/${created.id}`)
        .send({ description: null })
        .expect(200);
      expect(updated.description).toBeUndefined();
      expect(updated.body ?? updated).toBeDefined();

      await testApp.request().delete(`/api/v1/teams/${created.id}`).expect(204);
      await testApp.request().get(`/api/v1/teams/${created.id}`).expect(404);
    });

    it('sets a Location header pointing at the new team', async () => {
      const response = await testApp
        .request()
        .post('/api/v1/teams')
        .send({ name: 'Research Desk' })
        .expect(201);

      expect(response.headers.location).toBe(
        `/api/v1/teams/${response.body.id}`,
      );
    });

    it('reports a missing team with the error envelope and a stable code', async () => {
      const response = await testApp
        .request()
        .get('/api/v1/teams/nope')
        .expect(404);

      expect(response.body).toMatchObject({
        statusCode: 404,
        code: 'TEAM_NOT_FOUND',
        path: '/api/v1/teams/nope',
      });
    });

    it('rejects a nameless team and a client-supplied id', async () => {
      await testApp.request().post('/api/v1/teams').send({}).expect(400);
      await testApp
        .request()
        .post('/api/v1/teams')
        .send({ name: '  ' })
        .expect(400);
      await testApp
        .request()
        .post('/api/v1/teams')
        .send({ name: 'x', id: '018f3a9e-0000-7000-8000-000000000001' })
        .expect(400);
      await testApp
        .request()
        .post('/api/v1/teams')
        .send({ name: 'x', memberCount: 3 })
        .expect(400);
    });

    it('treats an empty patch as a no-op that leaves updatedAt alone', async () => {
      const team = await createTeam();

      const response = await testApp
        .request()
        .patch(`/api/v1/teams/${team.id}`)
        .send({})
        .expect(200);

      expect(response.body.updatedAt).toBe(team.updatedAt);
    });
  });

  describe('the collection', () => {
    it('filters, sorts and paginates', async () => {
      await createTeam({ name: 'Alpha' });
      await createTeam({ name: 'Beta' });
      await createTeam({ name: 'Gamma' });

      const sorted = await testApp
        .request()
        .get('/api/v1/teams?sort=name&order=asc&limit=2')
        .expect(200);
      expect(sorted.body.items.map((t: { name: string }) => t.name)).toEqual([
        'Alpha',
        'Beta',
      ]);
      expect(sorted.body).toMatchObject({ total: 3, limit: 2, offset: 0 });

      const filtered = await testApp
        .request()
        .get('/api/v1/teams?search=gam')
        .expect(200);
      expect(filtered.body.total).toBe(1);
    });

    it('rejects an unknown sort field and an out-of-range limit', async () => {
      await testApp.request().get('/api/v1/teams?sort=description').expect(400);
      await testApp.request().get('/api/v1/teams?limit=101').expect(400);
    });

    it('carries the roster size on every row', async () => {
      const team = await createTeam();
      await addMember(team.id, createAgent('One').id);
      await addMember(team.id, createAgent('Two').id);

      const response = await testApp.request().get('/api/v1/teams').expect(200);

      expect(response.body.items[0].memberCount).toBe(2);
    });
  });

  describe('the roster', () => {
    it('appends agents and reports them in turn order', async () => {
      const team = await createTeam();
      const first = createAgent('First');
      const second = createAgent('Second');

      expect((await addMember(team.id, first.id, 'Supervisor')).position).toBe(
        0,
      );
      expect((await addMember(team.id, second.id)).position).toBe(1);

      const response = await testApp
        .request()
        .get(`/api/v1/teams/${team.id}/members`)
        .expect(200);

      expect(response.body.items).toHaveLength(2);
      expect(response.body.items[0]).toMatchObject({
        teamId: team.id,
        agentId: first.id,
        role: 'Supervisor',
        position: 0,
      });
      expect(response.body.items[1].role).toBeNull();
    });

    it('sets a Location header pointing at the membership', async () => {
      const team = await createTeam();
      const agent = createAgent('One');

      const response = await testApp
        .request()
        .post(`/api/v1/teams/${team.id}/members`)
        .send({ agentId: agent.id })
        .expect(201);

      expect(response.headers.location).toBe(
        `/api/v1/teams/${team.id}/members/${agent.id}`,
      );
    });

    it('refuses an agent that does not exist with 422, not 404', async () => {
      const team = await createTeam();

      const response = await testApp
        .request()
        .post(`/api/v1/teams/${team.id}/members`)
        .send({ agentId: 'nope' })
        .expect(422);

      expect(response.body.code).toBe('AGENT_NOT_FOUND');
    });

    it('refuses the same agent twice with 409', async () => {
      const team = await createTeam();
      const agent = createAgent('One');
      await addMember(team.id, agent.id);

      const response = await testApp
        .request()
        .post(`/api/v1/teams/${team.id}/members`)
        .send({ agentId: agent.id })
        .expect(409);

      expect(response.body.code).toBe('AGENT_ALREADY_ON_TEAM');
    });

    it('changes a role and clears it with null', async () => {
      const team = await createTeam();
      const agent = createAgent('One');
      await addMember(team.id, agent.id, 'Supervisor');

      const renamed = await testApp
        .request()
        .patch(`/api/v1/teams/${team.id}/members/${agent.id}`)
        .send({ role: 'Researcher' })
        .expect(200);
      expect(renamed.body.role).toBe('Researcher');

      const cleared = await testApp
        .request()
        .patch(`/api/v1/teams/${team.id}/members/${agent.id}`)
        .send({ role: null })
        .expect(200);
      expect(cleared.body.role).toBeNull();
    });

    it('refuses a position in the patch, because order has one way in', async () => {
      const team = await createTeam();
      const agent = createAgent('One');
      await addMember(team.id, agent.id);

      await testApp
        .request()
        .patch(`/api/v1/teams/${team.id}/members/${agent.id}`)
        .send({ position: 5 })
        .expect(400);
    });

    it('closes the gap when an agent is taken off', async () => {
      const team = await createTeam();
      const agents = [createAgent('A'), createAgent('B'), createAgent('C')];
      for (const agent of agents) {
        await addMember(team.id, agent.id);
      }

      await testApp
        .request()
        .delete(`/api/v1/teams/${team.id}/members/${agents[0].id}`)
        .expect(204);

      const response = await testApp
        .request()
        .get(`/api/v1/teams/${team.id}/members`)
        .expect(200);
      expect(
        response.body.items.map((m: { position: number }) => m.position),
      ).toEqual([0, 1]);
    });

    it('scopes every membership route to the team in the URL', async () => {
      const mine = await createTeam({ name: 'Mine' });
      const theirs = await createTeam({ name: 'Theirs' });
      const agent = createAgent('One');
      await addMember(theirs.id, agent.id);

      await testApp
        .request()
        .get(`/api/v1/teams/${mine.id}/members/${agent.id}`)
        .expect(404);
      await testApp
        .request()
        .patch(`/api/v1/teams/${mine.id}/members/${agent.id}`)
        .send({ role: 'x' })
        .expect(404);
      await testApp
        .request()
        .delete(`/api/v1/teams/${mine.id}/members/${agent.id}`)
        .expect(404);

      // The other team's roster is untouched by all three attempts.
      expect(await roster(theirs.id)).toEqual([agent.id]);
    });

    it('reports 404 for a roster under a team that does not exist', async () => {
      await testApp.request().get('/api/v1/teams/nope/members').expect(404);
    });
  });

  describe('the turn order', () => {
    it('is rewritten in one call', async () => {
      const team = await createTeam();
      const agents = [createAgent('A'), createAgent('B'), createAgent('C')];
      for (const agent of agents) {
        await addMember(team.id, agent.id);
      }

      const response = await testApp
        .request()
        .put(`/api/v1/teams/${team.id}/members/order`)
        .send({ agentIds: [agents[2].id, agents[0].id, agents[1].id] })
        .expect(200);

      expect(
        response.body.items.map((m: { agentId: string }) => m.agentId),
      ).toEqual([agents[2].id, agents[0].id, agents[1].id]);
      expect(await roster(team.id)).toEqual([
        agents[2].id,
        agents[0].id,
        agents[1].id,
      ]);
    });

    it('refuses a list that does not match the current roster', async () => {
      const team = await createTeam();
      const agents = [createAgent('A'), createAgent('B')];
      for (const agent of agents) {
        await addMember(team.id, agent.id);
      }

      const response = await testApp
        .request()
        .put(`/api/v1/teams/${team.id}/members/order`)
        .send({ agentIds: [agents[0].id] })
        .expect(409);

      expect(response.body.code).toBe('ROSTER_MISMATCH');
      expect(await roster(team.id)).toEqual([agents[0].id, agents[1].id]);
    });

    it('refuses an empty list', async () => {
      const team = await createTeam();

      await testApp
        .request()
        .put(`/api/v1/teams/${team.id}/members/order`)
        .send({ agentIds: [] })
        .expect(400);
    });
  });

  describe('deleting a team', () => {
    it('takes the roster with it and leaves the agents alone', async () => {
      const team = await createTeam();
      const agent = createAgent('One');
      await addMember(team.id, agent.id);

      await testApp.request().delete(`/api/v1/teams/${team.id}`).expect(204);

      expect(
        testApp.db.all('SELECT * FROM team_members WHERE team_id = ?', [
          team.id,
        ]),
      ).toHaveLength(0);
      await testApp.request().get(`/api/v1/agents/${agent.id}`).expect(200);
    });
  });
});
