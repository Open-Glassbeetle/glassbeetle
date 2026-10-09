import { NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../database/database.service.js';
import { TestFixtures } from '../../../test/harness/fixtures.js';
import { TeamsService } from './teams.service.js';

describe('TeamsService', () => {
  let db: DatabaseService;
  let fixtures: TestFixtures;
  let service: TeamsService;

  beforeEach(() => {
    db = new DatabaseService();
    db.connect(':memory:');
    fixtures = new TestFixtures(db);
    service = new TeamsService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('findAll', () => {
    it('returns an empty paginated collection when there are no teams', async () => {
      expect(await service.findAll({ limit: 50, offset: 0 })).toEqual({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      });
    });

    it('maps columns to camelCase and counts the roster', async () => {
      const team = fixtures.createTeam({
        name: 'Research Desk',
        description: 'Finds things',
      });
      fixtures.createTeamMember(team.id, fixtures.createAgent().id);
      fixtures.createTeamMember(team.id, fixtures.createAgent().id, {
        position: 2,
      });

      const result = await service.findAll({ limit: 50, offset: 0 });

      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({
        id: team.id,
        name: 'Research Desk',
        description: 'Finds things',
        memberCount: 2,
      });
    });

    it('reports an empty team as zero rather than omitting the count', async () => {
      fixtures.createTeam();

      const result = await service.findAll({ limit: 50, offset: 0 });

      expect(result.items[0].memberCount).toBe(0);
    });

    it('counts each team separately', async () => {
      const busy = fixtures.createTeam({ name: 'Busy' });
      fixtures.createTeam({ name: 'Quiet' });
      fixtures.createTeamMember(busy.id, fixtures.createAgent().id);
      fixtures.createTeamMember(busy.id, fixtures.createAgent().id, {
        position: 2,
      });

      const result = await service.findAll({
        limit: 50,
        offset: 0,
        sort: 'name',
        order: 'asc',
      });

      expect(result.items.map((team) => [team.name, team.memberCount])).toEqual(
        [
          ['Busy', 2],
          ['Quiet', 0],
        ],
      );
    });

    it('filters by name, case-insensitively', async () => {
      fixtures.createTeam({ name: 'Research Desk' });
      fixtures.createTeam({ name: 'Release Crew' });

      const result = await service.findAll({
        limit: 50,
        offset: 0,
        name: 'research',
      });

      expect(result.total).toBe(1);
      expect(result.items[0].name).toBe('Research Desk');
    });

    it('treats a wildcard in the search term as a literal character', async () => {
      fixtures.createTeam({ name: 'Research Desk' });
      fixtures.createTeam({ name: '100% Crew' });

      const result = await service.findAll({
        limit: 50,
        offset: 0,
        search: '%',
      });

      expect(result.total).toBe(1);
      expect(result.items[0].name).toBe('100% Crew');
    });

    it('accepts search as an alias for name', async () => {
      fixtures.createTeam({ name: 'Research Desk' });

      expect(
        (await service.findAll({ limit: 50, offset: 0, search: 'desk' })).total,
      ).toBe(1);
    });

    it('sorts by name without the roster join making the column ambiguous', async () => {
      fixtures.createTeam({ name: 'Zulu' });
      fixtures.createTeam({ name: 'Alpha' });

      const result = await service.findAll({
        limit: 50,
        offset: 0,
        sort: 'name',
        order: 'asc',
      });

      expect(result.items.map((team) => team.name)).toEqual(['Alpha', 'Zulu']);
    });

    it('sorts by createdAt, which both joined tables have a column for', async () => {
      fixtures.createTeam({
        name: 'First',
        created_at: '2026-01-01T00:00:00.000Z',
      });
      fixtures.createTeam({
        name: 'Second',
        created_at: '2026-02-01T00:00:00.000Z',
      });

      const result = await service.findAll({
        limit: 50,
        offset: 0,
        sort: 'createdAt',
        order: 'asc',
      });

      expect(result.items.map((team) => team.name)).toEqual([
        'First',
        'Second',
      ]);
    });

    it('rejects a sort field that is not whitelisted', async () => {
      await expect(
        service.findAll({ limit: 50, offset: 0, sort: 'description' }),
      ).rejects.toThrow(/Invalid sort field/);
    });

    it('paginates, and reports the unpaginated total', async () => {
      for (let index = 0; index < 5; index += 1) {
        fixtures.createTeam({ name: `Team ${index}` });
      }

      const result = await service.findAll({
        limit: 2,
        offset: 2,
        sort: 'name',
        order: 'asc',
      });

      expect(result).toMatchObject({ total: 5, limit: 2, offset: 2 });
      expect(result.items.map((team) => team.name)).toEqual([
        'Team 2',
        'Team 3',
      ]);
    });
  });

  describe('findOne', () => {
    it('returns the team with its roster size', async () => {
      const team = fixtures.createTeam();
      fixtures.createTeamMember(team.id, fixtures.createAgent().id);

      expect(await service.findOne(team.id)).toMatchObject({
        id: team.id,
        memberCount: 1,
      });
    });

    it('reports 404 with a stable code for an unknown team', async () => {
      await expect(service.findOne('nope')).rejects.toMatchObject({
        response: { code: 'TEAM_NOT_FOUND' },
      });
      await expect(service.findOne('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('creates a team with an empty roster and server-managed fields', async () => {
      const created = await service.create({ name: 'Research Desk' });

      expect(created).toMatchObject({
        name: 'Research Desk',
        description: null,
        memberCount: 0,
      });
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.createdAt).toBe(created.updatedAt);
    });

    it('persists what it returns', async () => {
      const created = await service.create({
        name: 'Research Desk',
        description: 'Finds things',
      });

      expect(await service.findOne(created.id)).toEqual(created);
    });
  });

  describe('update', () => {
    it('changes supplied fields and leaves the rest alone', async () => {
      const team = fixtures.createTeam({ name: 'Old', description: 'Keep me' });

      const updated = await service.update(team.id, { name: 'New' });

      expect(updated.name).toBe('New');
      expect(updated.description).toBe('Keep me');
    });

    it('clears the description on an explicit null', async () => {
      const team = fixtures.createTeam({ description: 'Remove me' });

      expect(
        (await service.update(team.id, { description: null })).description,
      ).toBeNull();
    });

    it('treats an empty payload as a no-op and does not touch updatedAt', async () => {
      const team = fixtures.createTeam();

      const updated = await service.update(team.id, {});

      expect(updated.updatedAt).toBe(team.updated_at);
    });

    it('keeps the roster size in the response', async () => {
      const team = fixtures.createTeam();
      fixtures.createTeamMember(team.id, fixtures.createAgent().id);

      expect(
        (await service.update(team.id, { name: 'Renamed' })).memberCount,
      ).toBe(1);
    });

    it('reports 404 for an unknown team', async () => {
      await expect(service.update('nope', { name: 'x' })).rejects.toMatchObject(
        {
          response: { code: 'TEAM_NOT_FOUND' },
        },
      );
    });
  });

  describe('delete', () => {
    it('deletes the team and cascades the roster', async () => {
      const team = fixtures.createTeam();
      const agent = fixtures.createAgent();
      fixtures.createTeamMember(team.id, agent.id);

      await service.delete(team.id);

      expect(
        db.all('SELECT * FROM teams WHERE id = ?', [team.id]),
      ).toHaveLength(0);
      expect(
        db.all('SELECT * FROM team_members WHERE team_id = ?', [team.id]),
      ).toHaveLength(0);
    });

    it('leaves the agents themselves alone: membership is a relationship, not ownership', async () => {
      const team = fixtures.createTeam();
      const agent = fixtures.createAgent();
      fixtures.createTeamMember(team.id, agent.id);

      await service.delete(team.id);

      expect(
        db.all('SELECT * FROM agents WHERE id = ?', [agent.id]),
      ).toHaveLength(1);
    });

    it('reports 404 for an unknown team', async () => {
      await expect(service.delete('nope')).rejects.toMatchObject({
        response: { code: 'TEAM_NOT_FOUND' },
      });
    });
  });

  describe('touch', () => {
    it('moves updatedAt forward, so a roster change shows in a recently-changed list', async () => {
      const team = fixtures.createTeam({
        updated_at: '2026-01-01T00:00:00.000Z',
      });

      service.touch(team.id);

      expect((await service.findOne(team.id)).updatedAt).not.toBe(
        '2026-01-01T00:00:00.000Z',
      );
    });
  });
});
