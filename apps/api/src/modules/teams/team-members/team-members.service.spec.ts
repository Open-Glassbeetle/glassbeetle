import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../database/database.service.js';
import { TestFixtures } from '../../../../test/harness/fixtures.js';
import { TeamsService } from '../teams.service.js';
import { TeamMembersService } from './team-members.service.js';

describe('TeamMembersService', () => {
  let db: DatabaseService;
  let fixtures: TestFixtures;
  let teams: TeamsService;
  let service: TeamMembersService;
  let teamId: string;

  beforeEach(() => {
    db = new DatabaseService();
    db.connect(':memory:');
    fixtures = new TestFixtures(db);
    teams = new TeamsService(db);
    service = new TeamMembersService(db, teams);
    teamId = fixtures.createTeam().id;
  });

  afterEach(() => {
    db.close();
  });

  /** Adds `count` agents to the team and returns their ids in roster order. */
  async function fillRoster(count: number): Promise<string[]> {
    const agentIds: string[] = [];

    for (let index = 0; index < count; index += 1) {
      const agent = fixtures.createAgent({ name: `Agent ${index}` });
      await service.add(teamId, { agentId: agent.id });
      agentIds.push(agent.id);
    }

    return agentIds;
  }

  async function rosterOrder(): Promise<string[]> {
    const page = await service.findAll(teamId, { limit: 100, offset: 0 });
    return page.items.map((member) => member.agentId);
  }

  describe('add', () => {
    it('appends to the end of the roster, counting from zero', async () => {
      const first = fixtures.createAgent();
      const second = fixtures.createAgent();

      expect((await service.add(teamId, { agentId: first.id })).position).toBe(
        0,
      );
      expect((await service.add(teamId, { agentId: second.id })).position).toBe(
        1,
      );
    });

    it('stores the role and reports the pair rather than an id of its own', async () => {
      const agent = fixtures.createAgent();

      const member = await service.add(teamId, {
        agentId: agent.id,
        role: 'Supervisor',
      });

      expect(member).toMatchObject({
        teamId,
        agentId: agent.id,
        role: 'Supervisor',
        position: 0,
      });
      expect((member as Record<string, unknown>).id).toBeUndefined();
    });

    it('defaults the role to null rather than an empty string', async () => {
      const agent = fixtures.createAgent();

      expect(
        (await service.add(teamId, { agentId: agent.id })).role,
      ).toBeNull();
    });

    it('reports 404 for an unknown team', async () => {
      const agent = fixtures.createAgent();

      await expect(
        service.add('nope', { agentId: agent.id }),
      ).rejects.toMatchObject({
        response: { code: 'TEAM_NOT_FOUND' },
      });
    });

    it('reports 422 for an agent that does not exist, because the team in the URL does', async () => {
      await expect(
        service.add(teamId, { agentId: 'nope' }),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'AGENT_NOT_FOUND' },
      });
    });

    it('refuses to add the same agent twice', async () => {
      const agent = fixtures.createAgent();
      await service.add(teamId, { agentId: agent.id });

      await expect(
        service.add(teamId, { agentId: agent.id }),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'AGENT_ALREADY_ON_TEAM' },
      });
    });

    it('leaves the roster untouched when it refuses', async () => {
      const agent = fixtures.createAgent();
      await service.add(teamId, { agentId: agent.id });

      await expect(
        service.add(teamId, { agentId: agent.id }),
      ).rejects.toThrow();

      expect(
        (await service.findAll(teamId, { limit: 50, offset: 0 })).total,
      ).toBe(1);
    });

    it('lets the same agent be on two teams at once', async () => {
      const other = fixtures.createTeam().id;
      const agent = fixtures.createAgent();

      await service.add(teamId, { agentId: agent.id });

      await expect(
        service.add(other, { agentId: agent.id }),
      ).resolves.toMatchObject({
        teamId: other,
        position: 0,
      });
    });

    it('moves the team forward in a recently-changed list', async () => {
      db.run('UPDATE teams SET updated_at = ? WHERE id = ?', [
        '2026-01-01',
        teamId,
      ]);

      await service.add(teamId, { agentId: fixtures.createAgent().id });

      expect((await teams.findOne(teamId)).updatedAt).not.toBe('2026-01-01');
    });
  });

  describe('findAll', () => {
    it('returns the roster in turn order, not insertion order by id', async () => {
      const agentIds = await fillRoster(3);
      await service.reorder(teamId, {
        agentIds: [agentIds[2], agentIds[0], agentIds[1]],
      });

      expect(await rosterOrder()).toEqual([
        agentIds[2],
        agentIds[0],
        agentIds[1],
      ]);
    });

    it('reports an empty roster rather than 404 for a team with no agents', async () => {
      expect(
        await service.findAll(teamId, { limit: 50, offset: 0 }),
      ).toMatchObject({
        items: [],
        total: 0,
      });
    });

    it('reports 404 for an unknown team', async () => {
      await expect(
        service.findAll('nope', { limit: 50, offset: 0 }),
      ).rejects.toMatchObject({ response: { code: 'TEAM_NOT_FOUND' } });
    });

    it('rejects any sort other than position, naming the one that works', async () => {
      await expect(
        service.findAll(teamId, { limit: 50, offset: 0, sort: 'role' }),
      ).rejects.toThrow(/Allowed sort fields: position/);
    });

    it('never returns another team roster through this team URL', async () => {
      const other = fixtures.createTeam().id;
      await service.add(other, { agentId: fixtures.createAgent().id });

      expect(
        (await service.findAll(teamId, { limit: 50, offset: 0 })).total,
      ).toBe(0);
    });
  });

  describe('findOne', () => {
    it('returns one membership', async () => {
      const [agentId] = await fillRoster(1);

      expect(await service.findOne(teamId, agentId)).toMatchObject({
        teamId,
        agentId,
      });
    });

    it('refuses to read a membership through the wrong team', async () => {
      const other = fixtures.createTeam().id;
      const agent = fixtures.createAgent();
      await service.add(other, { agentId: agent.id });

      await expect(service.findOne(teamId, agent.id)).rejects.toMatchObject({
        response: { code: 'MEMBER_NOT_FOUND' },
      });
    });
  });

  describe('update', () => {
    it('changes the role', async () => {
      const [agentId] = await fillRoster(1);

      expect(
        (await service.update(teamId, agentId, { role: 'Supervisor' })).role,
      ).toBe('Supervisor');
    });

    it('clears the role on an explicit null', async () => {
      const agent = fixtures.createAgent();
      await service.add(teamId, { agentId: agent.id, role: 'Supervisor' });

      expect(
        (await service.update(teamId, agent.id, { role: null })).role,
      ).toBeNull();
    });

    it('treats an empty payload as a no-op', async () => {
      const agent = fixtures.createAgent();
      await service.add(teamId, { agentId: agent.id, role: 'Supervisor' });
      db.run('UPDATE teams SET updated_at = ? WHERE id = ?', [
        '2026-01-01',
        teamId,
      ]);

      await service.update(teamId, agent.id, {});

      expect((await teams.findOne(teamId)).updatedAt).toBe('2026-01-01');
    });

    it('does not touch the team when the role is set to what it already is', async () => {
      const agent = fixtures.createAgent();
      await service.add(teamId, { agentId: agent.id, role: 'Supervisor' });
      db.run('UPDATE teams SET updated_at = ? WHERE id = ?', [
        '2026-01-01',
        teamId,
      ]);

      await service.update(teamId, agent.id, { role: 'Supervisor' });

      expect((await teams.findOne(teamId)).updatedAt).toBe('2026-01-01');
    });

    it('leaves the position alone', async () => {
      const agentIds = await fillRoster(2);

      await service.update(teamId, agentIds[1], { role: 'Second' });

      expect((await service.findOne(teamId, agentIds[1])).position).toBe(1);
    });
  });

  describe('remove', () => {
    it('takes the agent off the roster', async () => {
      const [agentId] = await fillRoster(1);

      await service.remove(teamId, agentId);

      expect(
        (await service.findAll(teamId, { limit: 50, offset: 0 })).total,
      ).toBe(0);
    });

    it('closes the gap so the order stays a dense sequence', async () => {
      const agentIds = await fillRoster(4);

      await service.remove(teamId, agentIds[1]);

      const page = await service.findAll(teamId, { limit: 50, offset: 0 });
      expect(page.items.map((member) => member.position)).toEqual([0, 1, 2]);
      expect(page.items.map((member) => member.agentId)).toEqual([
        agentIds[0],
        agentIds[2],
        agentIds[3],
      ]);
    });

    it('leaves the agent itself alone', async () => {
      const [agentId] = await fillRoster(1);

      await service.remove(teamId, agentId);

      expect(
        db.all('SELECT * FROM agents WHERE id = ?', [agentId]),
      ).toHaveLength(1);
    });

    it('reports 404 for an agent that is not on the team', async () => {
      const stranger = fixtures.createAgent();

      await expect(service.remove(teamId, stranger.id)).rejects.toMatchObject({
        response: { code: 'MEMBER_NOT_FOUND' },
      });
    });

    it('refuses to remove through the wrong team', async () => {
      const other = fixtures.createTeam().id;
      const agent = fixtures.createAgent();
      await service.add(other, { agentId: agent.id });

      await expect(service.remove(teamId, agent.id)).rejects.toMatchObject({
        response: { code: 'MEMBER_NOT_FOUND' },
      });
      expect(
        (await service.findAll(other, { limit: 50, offset: 0 })).total,
      ).toBe(1);
    });
  });

  describe('reorder', () => {
    it('rewrites the turn order and returns the new roster', async () => {
      const agentIds = await fillRoster(3);

      const result = await service.reorder(teamId, {
        agentIds: [agentIds[2], agentIds[1], agentIds[0]],
      });

      expect(result.items.map((member) => member.agentId)).toEqual([
        agentIds[2],
        agentIds[1],
        agentIds[0],
      ]);
      expect(result.items.map((member) => member.position)).toEqual([0, 1, 2]);
    });

    it('persists the new order', async () => {
      const agentIds = await fillRoster(3);

      await service.reorder(teamId, {
        agentIds: [agentIds[1], agentIds[2], agentIds[0]],
      });

      expect(await rosterOrder()).toEqual([
        agentIds[1],
        agentIds[2],
        agentIds[0],
      ]);
    });

    it('refuses a list that leaves someone out', async () => {
      const agentIds = await fillRoster(3);

      await expect(
        service.reorder(teamId, { agentIds: [agentIds[0], agentIds[1]] }),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'ROSTER_MISMATCH' },
      });
    });

    it('refuses a list naming an agent that is not on the team', async () => {
      const agentIds = await fillRoster(2);
      const stranger = fixtures.createAgent();

      await expect(
        service.reorder(teamId, { agentIds: [...agentIds, stranger.id] }),
      ).rejects.toMatchObject({ response: { code: 'ROSTER_MISMATCH' } });
    });

    it('refuses a list that repeats an agent', async () => {
      const agentIds = await fillRoster(2);

      await expect(
        service.reorder(teamId, { agentIds: [agentIds[0], agentIds[0]] }),
      ).rejects.toMatchObject({ response: { code: 'ROSTER_MISMATCH' } });
    });

    it('leaves the order untouched when it refuses', async () => {
      const agentIds = await fillRoster(3);

      await expect(
        service.reorder(teamId, { agentIds: [agentIds[2], agentIds[1]] }),
      ).rejects.toThrow();

      expect(await rosterOrder()).toEqual(agentIds);
    });

    it('reports 404 for an unknown team', async () => {
      await expect(
        service.reorder('nope', { agentIds: ['anything'] }),
      ).rejects.toMatchObject({ response: { code: 'TEAM_NOT_FOUND' } });
    });
  });
});
