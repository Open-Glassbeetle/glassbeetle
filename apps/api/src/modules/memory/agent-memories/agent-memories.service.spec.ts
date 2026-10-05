import { BadRequestException, NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../database/database.service.js';
import { TestFixtures } from '../../../../test/harness/fixtures.js';
import { AgentMemoriesService } from './agent-memories.service.js';
import type { AgentMemoryRow } from './dto/agent-memory-response.dto.js';

describe('AgentMemoriesService', () => {
  let db: DatabaseService;
  let fixtures: TestFixtures;
  let service: AgentMemoriesService;

  beforeEach(() => {
    db = new DatabaseService();
    db.connect(':memory:');
    fixtures = new TestFixtures(db);
    service = new AgentMemoriesService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('findAll', () => {
    it('throws 404 with AGENT_NOT_FOUND when agent does not exist', async () => {
      await expect(
        service.findAll('non-existent-agent-id', { limit: 10, offset: 0 }),
      ).rejects.toThrow(NotFoundException);

      try {
        await service.findAll('non-existent-agent-id', {
          limit: 10,
          offset: 0,
        });
      } catch (err: any) {
        expect(err.getResponse()).toEqual({
          code: 'AGENT_NOT_FOUND',
          message: 'Agent with ID "non-existent-agent-id" not found',
        });
      }
    });

    it('returns 200 with an empty paginated collection when agent has no memories', async () => {
      const agent = fixtures.createAgent({ name: 'Agent Without Memories' });

      const result = await service.findAll(agent.id, { limit: 10, offset: 0 });

      expect(result).toEqual({
        items: [],
        total: 0,
        limit: 10,
        offset: 0,
      });
    });

    it('returns only memories belonging to the specified agent (isolation between agents)', async () => {
      const agentA = fixtures.createAgent({ name: 'Agent A' });
      const agentB = fixtures.createAgent({ name: 'Agent B' });

      await service.create(
        agentA.id,
        { content: 'Agent A fact 1' },
        { now: '2026-10-04T00:00:01.000Z' },
      );
      await service.create(
        agentA.id,
        { content: 'Agent A fact 2' },
        { now: '2026-10-04T00:00:02.000Z' },
      );
      await service.create(agentB.id, { content: 'Agent B private note' });

      const resultA = await service.findAll(agentA.id, {
        limit: 10,
        offset: 0,
      });
      const resultB = await service.findAll(agentB.id, {
        limit: 10,
        offset: 0,
      });

      expect(resultA.total).toBe(2);
      expect(resultA.items).toHaveLength(2);
      expect(resultA.items.map((i) => i.content)).toEqual([
        'Agent A fact 2',
        'Agent A fact 1',
      ]);
      expect(resultA.items.every((i) => i.agentId === agentA.id)).toBe(true);

      expect(resultB.total).toBe(1);
      expect(resultB.items).toHaveLength(1);
      expect(resultB.items[0]?.content).toBe('Agent B private note');
      expect(resultB.items[0]?.agentId).toBe(agentB.id);
    });

    it('supports pagination with limit and offset', async () => {
      const agent = fixtures.createAgent();

      for (let i = 1; i <= 5; i++) {
        await service.create(
          agent.id,
          { content: `Memory ${i}` },
          { id: `mem-0${i}`, now: `2026-10-04T00:00:0${i}.000Z` },
        );
      }

      const page1 = await service.findAll(agent.id, {
        limit: 2,
        offset: 0,
        sort: 'createdAt',
        order: 'asc',
      });
      expect(page1.total).toBe(5);
      expect(page1.items).toHaveLength(2);
      expect(page1.items.map((i) => i.id)).toEqual(['mem-01', 'mem-02']);

      const page2 = await service.findAll(agent.id, {
        limit: 2,
        offset: 2,
        sort: 'createdAt',
        order: 'asc',
      });
      expect(page2.total).toBe(5);
      expect(page2.items).toHaveLength(2);
      expect(page2.items.map((i) => i.id)).toEqual(['mem-03', 'mem-04']);
    });

    it('supports sorting by allowed columns and sortBy alias', async () => {
      const agent = fixtures.createAgent();

      await service.create(
        agent.id,
        { content: 'Bravo' },
        { now: '2026-10-04T00:00:02.000Z' },
      );
      await service.create(
        agent.id,
        { content: 'Alpha' },
        { now: '2026-10-04T00:00:01.000Z' },
      );

      const sortedByContent = await service.findAll(agent.id, {
        limit: 10,
        offset: 0,
        sortBy: 'content',
        order: 'asc',
      });
      expect(sortedByContent.items.map((i) => i.content)).toEqual([
        'Alpha',
        'Bravo',
      ]);

      const sortedByDate = await service.findAll(agent.id, {
        limit: 10,
        offset: 0,
        sort: 'createdAt',
        order: 'desc',
      });
      expect(sortedByDate.items.map((i) => i.content)).toEqual([
        'Bravo',
        'Alpha',
      ]);
    });

    it('throws BadRequestException for invalid sort field', async () => {
      const agent = fixtures.createAgent();

      await expect(
        service.findAll(agent.id, {
          limit: 10,
          offset: 0,
          sort: 'hacked_column',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('filters memories by exact tag match', async () => {
      const agent = fixtures.createAgent();

      await service.create(agent.id, {
        content: 'Project X details',
        tags: ['project-x', 'secret'],
      });
      await service.create(agent.id, {
        content: 'Project XY note',
        tags: ['project-xy'],
      });
      await service.create(agent.id, {
        content: 'Untagged note',
      });

      const result = await service.findAll(agent.id, {
        limit: 10,
        offset: 0,
        tag: 'project-x',
      });

      expect(result.total).toBe(1);
      expect(result.items[0]?.content).toBe('Project X details');
      expect(result.items[0]?.tags).toEqual(['project-x', 'secret']);
    });

    it('filters memories by content substring and search alias', async () => {
      const agent = fixtures.createAgent();

      await service.create(agent.id, { content: 'Prefers TypeScript' });
      await service.create(agent.id, { content: 'Avoids JavaScript' });
      await service.create(agent.id, { content: 'Likes Python' });

      const contentResult = await service.findAll(agent.id, {
        limit: 10,
        offset: 0,
        content: 'Script',
      });
      expect(contentResult.total).toBe(2);

      const searchResult = await service.findAll(agent.id, {
        limit: 10,
        offset: 0,
        search: 'Python',
      });
      expect(searchResult.total).toBe(1);
      expect(searchResult.items[0]?.content).toBe('Likes Python');
    });
  });

  describe('create', () => {
    it('throws 404 with AGENT_NOT_FOUND when agent does not exist', async () => {
      await expect(
        service.create('non-existent-agent-id', { content: 'Fact' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a memory with generated id and timestamps, storing tags as JSON array', async () => {
      const agent = fixtures.createAgent();

      const created = await service.create(agent.id, {
        content: 'Prefers clean architecture',
        tags: ['architecture', 'preference'],
      });

      expect(created.id).toBeDefined();
      expect(created.agentId).toBe(agent.id);
      expect(created.content).toBe('Prefers clean architecture');
      expect(created.tags).toEqual(['architecture', 'preference']);
      expect(created.createdAt).toBeDefined();
      expect(created.updatedAt).toBe(created.createdAt);

      const dbRow = db.get<AgentMemoryRow>(
        'SELECT * FROM agent_memories WHERE id = ?',
        [created.id],
      );
      expect(dbRow).toBeDefined();
      expect(dbRow?.tags).toBe('["architecture","preference"]');
    });

    it('normalises empty tags array to SQL NULL in storage and reads back as empty array', async () => {
      const agent = fixtures.createAgent();

      const created = await service.create(agent.id, {
        content: 'Empty tags memory',
        tags: [],
      });

      expect(created.tags).toEqual([]);

      const dbRow = db.get<AgentMemoryRow>(
        'SELECT * FROM agent_memories WHERE id = ?',
        [created.id],
      );
      expect(dbRow?.tags).toBeNull();
    });

    it('normalises omitted tags to SQL NULL in storage and reads back as empty array', async () => {
      const agent = fixtures.createAgent();

      const created = await service.create(agent.id, {
        content: 'Omitted tags memory',
      });

      expect(created.tags).toEqual([]);

      const dbRow = db.get<AgentMemoryRow>(
        'SELECT * FROM agent_memories WHERE id = ?',
        [created.id],
      );
      expect(dbRow?.tags).toBeNull();
    });
  });

  describe('Foreign key cascade ON DELETE CASCADE', () => {
    it('deletes all agent memories when the referencing agent is deleted', async () => {
      const agent = fixtures.createAgent();

      const mem1 = await service.create(agent.id, { content: 'Mem 1' });
      await service.create(agent.id, { content: 'Mem 2' });

      const beforeCount = db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM agent_memories WHERE agent_id = ?',
        [agent.id],
      );
      expect(beforeCount?.count).toBe(2);

      db.run('DELETE FROM agents WHERE id = ?', [agent.id]);

      const afterCount = db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM agent_memories WHERE agent_id = ?',
        [agent.id],
      );
      expect(afterCount?.count).toBe(0);

      const memRow = db.get<AgentMemoryRow>(
        'SELECT * FROM agent_memories WHERE id = ?',
        [mem1.id],
      );
      expect(memRow).toBeUndefined();
    });
  });
});
