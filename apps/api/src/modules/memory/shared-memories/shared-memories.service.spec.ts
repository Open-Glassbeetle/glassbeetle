import { BadRequestException, NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../database/database.service.js';
import { SharedMemoriesService } from './shared-memories.service.js';
import type { SharedMemoryRow } from './dto/shared-memory-response.dto.js';

describe('SharedMemoriesService', () => {
  let db: DatabaseService;
  let service: SharedMemoriesService;

  beforeEach(() => {
    db = new DatabaseService();
    db.connect(':memory:');
    service = new SharedMemoriesService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('findAll', () => {
    it('returns an empty paginated collection when there are no shared memories', async () => {
      const result = await service.findAll({ limit: 10, offset: 0 });

      expect(result).toEqual({
        items: [],
        total: 0,
        limit: 10,
        offset: 0,
      });
    });

    it('returns a paginated list of created shared memories', async () => {
      await service.create(
        { content: 'Shared convention 1' },
        { now: '2026-10-04T00:00:01.000Z' },
      );
      await service.create(
        { content: 'Shared convention 2' },
        { now: '2026-10-04T00:00:02.000Z' },
      );

      const result = await service.findAll({ limit: 10, offset: 0 });

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items.map((i) => i.content)).toEqual([
        'Shared convention 2',
        'Shared convention 1',
      ]);
    });

    it('supports pagination with limit and offset', async () => {
      for (let i = 1; i <= 5; i++) {
        await service.create(
          { content: `Convention ${i}` },
          { id: `mem-0${i}`, now: `2026-10-04T00:00:0${i}.000Z` },
        );
      }

      const page1 = await service.findAll({
        limit: 2,
        offset: 0,
        sort: 'createdAt',
        order: 'asc',
      });
      expect(page1.total).toBe(5);
      expect(page1.items).toHaveLength(2);
      expect(page1.items.map((i) => i.id)).toEqual(['mem-01', 'mem-02']);

      const page2 = await service.findAll({
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
      await service.create(
        { content: 'Bravo' },
        { now: '2026-10-04T00:00:02.000Z' },
      );
      await service.create(
        { content: 'Alpha' },
        { now: '2026-10-04T00:00:01.000Z' },
      );

      const sortedByContent = await service.findAll({
        limit: 10,
        offset: 0,
        sortBy: 'content',
        order: 'asc',
      });
      expect(sortedByContent.items.map((i) => i.content)).toEqual([
        'Alpha',
        'Bravo',
      ]);

      const sortedByDate = await service.findAll({
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
      await expect(
        service.findAll({ limit: 10, offset: 0, sort: 'disallowed_col' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('filters memories by exact tag match', async () => {
      await service.create({
        content: 'Project X guidelines',
        tags: ['project-x', 'guidelines'],
      });
      await service.create({
        content: 'Project XY note',
        tags: ['project-xy'],
      });
      await service.create({
        content: 'General note without tags',
      });

      const result = await service.findAll({
        limit: 10,
        offset: 0,
        tag: 'project-x',
      });

      expect(result.total).toBe(1);
      expect(result.items[0]?.content).toBe('Project X guidelines');
      expect(result.items[0]?.tags).toEqual(['project-x', 'guidelines']);
    });

    it('filters memories by content substring and search alias', async () => {
      await service.create({ content: 'Use Prettier for formatting' });
      await service.create({ content: 'Use Oxlint for linting' });
      await service.create({ content: 'Use Vitest for testing' });

      const contentResult = await service.findAll({
        limit: 10,
        offset: 0,
        content: 'formatting',
      });
      expect(contentResult.total).toBe(1);
      expect(contentResult.items[0]?.content).toBe(
        'Use Prettier for formatting',
      );

      const searchResult = await service.findAll({
        limit: 10,
        offset: 0,
        search: 'Oxlint',
      });
      expect(searchResult.total).toBe(1);
      expect(searchResult.items[0]?.content).toBe('Use Oxlint for linting');
    });
  });

  describe('create', () => {
    it('creates a memory with generated id and timestamps, storing tags as JSON array', async () => {
      const created = await service.create({
        content: 'TypeScript strict mode enabled',
        tags: ['typescript', 'rules'],
      });

      expect(created.id).toBeDefined();
      expect(created.content).toBe('TypeScript strict mode enabled');
      expect(created.tags).toEqual(['typescript', 'rules']);
      expect(created.createdAt).toBeDefined();
      expect(created.updatedAt).toBe(created.createdAt);

      const dbRow = db.get<SharedMemoryRow>(
        'SELECT * FROM shared_memories WHERE id = ?',
        [created.id],
      );
      expect(dbRow).toBeDefined();
      expect(dbRow?.tags).toBe('["typescript","rules"]');
    });

    it('normalises empty tags array to SQL NULL in storage and reads back as empty array', async () => {
      const created = await service.create({
        content: 'Empty tags convention',
        tags: [],
      });

      expect(created.tags).toEqual([]);

      const dbRow = db.get<SharedMemoryRow>(
        'SELECT * FROM shared_memories WHERE id = ?',
        [created.id],
      );
      expect(dbRow?.tags).toBeNull();
    });

    it('normalises omitted tags to SQL NULL in storage and reads back as empty array', async () => {
      const created = await service.create({
        content: 'Omitted tags convention',
      });

      expect(created.tags).toEqual([]);

      const dbRow = db.get<SharedMemoryRow>(
        'SELECT * FROM shared_memories WHERE id = ?',
        [created.id],
      );
      expect(dbRow?.tags).toBeNull();
    });
  });

  describe('findOne', () => {
    it('throws 404 when shared memory does not exist', async () => {
      await expect(service.findOne('non-existent-memory')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the memory when it exists', async () => {
      const created = await service.create({
        content: 'Global coding convention',
        tags: ['global', 'style'],
      });

      const found = await service.findOne(created.id);

      expect(found).toEqual(created);
    });

    it('returns 404 and leaves agent_memories untouched when an agent memory ID is passed', async () => {
      db.run(
        'INSERT INTO agents (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
        [
          'agent-1',
          'Test Agent',
          '2026-10-04T00:00:00.000Z',
          '2026-10-04T00:00:00.000Z',
        ],
      );
      db.run(
        'INSERT INTO agent_memories (id, agent_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [
          'agent-mem-1',
          'agent-1',
          'Agent private memory',
          '2026-10-04T00:00:00.000Z',
          '2026-10-04T00:00:00.000Z',
        ],
      );

      await expect(service.findOne('agent-mem-1')).rejects.toThrow(
        NotFoundException,
      );

      const agentMem = db.get<{ id: string; content: string }>(
        'SELECT id, content FROM agent_memories WHERE id = ?',
        ['agent-mem-1'],
      );
      expect(agentMem).toBeDefined();
      expect(agentMem?.content).toBe('Agent private memory');
    });
  });

  describe('update', () => {
    it('throws 404 when memory does not exist', async () => {
      await expect(
        service.update('non-existent-memory', { content: 'New text' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates only content and leaves tags intact', async () => {
      const created = await service.create({
        content: 'Original content',
        tags: ['preserved-tag'],
      });

      const updated = await service.update(created.id, {
        content: 'Updated content only',
      });

      expect(updated.content).toBe('Updated content only');
      expect(updated.tags).toEqual(['preserved-tag']);

      const row = db.get<SharedMemoryRow>(
        'SELECT * FROM shared_memories WHERE id = ?',
        [created.id],
      );
      expect(row?.content).toBe('Updated content only');
      expect(row?.tags).toBe('["preserved-tag"]');
    });

    it('updates only tags and leaves content intact', async () => {
      const created = await service.create({
        content: 'Preserved content text',
        tags: ['old-tag'],
      });

      const updated = await service.update(created.id, {
        tags: ['new-tag-1', 'new-tag-2'],
      });

      expect(updated.content).toBe('Preserved content text');
      expect(updated.tags).toEqual(['new-tag-1', 'new-tag-2']);

      const row = db.get<SharedMemoryRow>(
        'SELECT * FROM shared_memories WHERE id = ?',
        [created.id],
      );
      expect(row?.content).toBe('Preserved content text');
      expect(row?.tags).toBe('["new-tag-1","new-tag-2"]');
    });

    it('normalises empty tags array to SQL NULL and returns empty array', async () => {
      const created = await service.create({
        content: 'Content',
        tags: ['will-be-cleared'],
      });

      const updated = await service.update(created.id, {
        tags: [],
      });

      expect(updated.tags).toEqual([]);

      const row = db.get<SharedMemoryRow>(
        'SELECT * FROM shared_memories WHERE id = ?',
        [created.id],
      );
      expect(row?.tags).toBeNull();
    });

    it('normalises tags set to null to SQL NULL and returns empty array', async () => {
      const created = await service.create({
        content: 'Content',
        tags: ['will-be-cleared'],
      });

      const updated = await service.update(created.id, {
        tags: null,
      });

      expect(updated.tags).toEqual([]);

      const row = db.get<SharedMemoryRow>(
        'SELECT * FROM shared_memories WHERE id = ?',
        [created.id],
      );
      expect(row?.tags).toBeNull();
    });

    it('treats empty update body as an idempotent no-op without bumping updatedAt', async () => {
      const created = await service.create(
        { content: 'Static content', tags: ['tag'] },
        { now: '2026-10-04T00:00:00.000Z' },
      );

      const result = await service.update(
        created.id,
        {},
        { now: '2026-10-04T05:00:00.000Z' },
      );

      expect(result.updatedAt).toBe('2026-10-04T00:00:00.000Z');
      expect(result.createdAt).toBe('2026-10-04T00:00:00.000Z');
    });

    it('advances updatedAt when updating a field without altering createdAt or id', async () => {
      const created = await service.create(
        { content: 'Old content' },
        { now: '2026-10-04T00:00:00.000Z' },
      );

      const updated = await service.update(
        created.id,
        { content: 'New content' },
        { now: '2026-10-04T12:00:00.000Z' },
      );

      expect(updated.id).toBe(created.id);
      expect(updated.createdAt).toBe('2026-10-04T00:00:00.000Z');
      expect(updated.updatedAt).toBe('2026-10-04T12:00:00.000Z');
    });

    it('returns 404 and leaves agent_memories untouched when an agent memory ID is passed', async () => {
      db.run(
        'INSERT INTO agents (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
        [
          'agent-1',
          'Test Agent',
          '2026-10-04T00:00:00.000Z',
          '2026-10-04T00:00:00.000Z',
        ],
      );
      db.run(
        'INSERT INTO agent_memories (id, agent_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [
          'agent-mem-2',
          'agent-1',
          'Untouched agent memory',
          '2026-10-04T00:00:00.000Z',
          '2026-10-04T00:00:00.000Z',
        ],
      );

      await expect(
        service.update('agent-mem-2', { content: 'Tampered' }),
      ).rejects.toThrow(NotFoundException);

      const agentMem = db.get<{ id: string; content: string }>(
        'SELECT id, content FROM agent_memories WHERE id = ?',
        ['agent-mem-2'],
      );
      expect(agentMem?.content).toBe('Untouched agent memory');
    });
  });

  describe('remove', () => {
    it('throws 404 when memory does not exist', async () => {
      await expect(service.remove('non-existent-memory')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deletes the memory when it exists', async () => {
      const created = await service.create({ content: 'To delete' });

      await service.remove(created.id);

      const row = db.get<SharedMemoryRow>(
        'SELECT * FROM shared_memories WHERE id = ?',
        [created.id],
      );
      expect(row).toBeUndefined();
    });

    it('returns 404 and leaves agent_memories untouched when an agent memory ID is passed', async () => {
      db.run(
        'INSERT INTO agents (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
        [
          'agent-1',
          'Test Agent',
          '2026-10-04T00:00:00.000Z',
          '2026-10-04T00:00:00.000Z',
        ],
      );
      db.run(
        'INSERT INTO agent_memories (id, agent_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [
          'agent-mem-3',
          'agent-1',
          'Permanent agent memory',
          '2026-10-04T00:00:00.000Z',
          '2026-10-04T00:00:00.000Z',
        ],
      );

      await expect(service.remove('agent-mem-3')).rejects.toThrow(
        NotFoundException,
      );

      const agentMem = db.get<{ id: string; content: string }>(
        'SELECT id, content FROM agent_memories WHERE id = ?',
        ['agent-mem-3'],
      );
      expect(agentMem).toBeDefined();
      expect(agentMem?.content).toBe('Permanent agent memory');
    });
  });

  describe('removeAll (bulk delete)', () => {
    it('returns { deleted: 0 } when shared memories table is empty', async () => {
      const result = await service.removeAll();

      expect(result).toEqual({ deleted: 0 });
    });

    it('deletes all shared memories and returns deleted count', async () => {
      await service.create({ content: 'Shared fact 1' });
      await service.create({ content: 'Shared fact 2' });
      await service.create({ content: 'Shared fact 3' });

      const result = await service.removeAll();

      expect(result).toEqual({ deleted: 3 });

      const count = db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM shared_memories',
      );
      expect(count?.count).toBe(0);
    });

    it('leaves agent_memories untouched (strict isolation)', async () => {
      // Seed an agent and an agent memory
      db.run(
        'INSERT INTO agents (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
        [
          'agent-iso-1',
          'Agent Iso',
          '2026-10-04T00:00:00.000Z',
          '2026-10-04T00:00:00.000Z',
        ],
      );
      db.run(
        'INSERT INTO agent_memories (id, agent_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [
          'agent-mem-iso',
          'agent-iso-1',
          'Agent private secret that must survive',
          '2026-10-04T00:00:00.000Z',
          '2026-10-04T00:00:00.000Z',
        ],
      );

      // Create shared memories
      await service.create({ content: 'Shared to delete 1' });
      await service.create({ content: 'Shared to delete 2' });

      const result = await service.removeAll();
      expect(result).toEqual({ deleted: 2 });

      // Verify shared_memories is empty
      const sharedCount = db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM shared_memories',
      );
      expect(sharedCount?.count).toBe(0);

      // Verify agent memory survived
      const agentMem = db.get<{ id: string; content: string }>(
        'SELECT id, content FROM agent_memories WHERE id = ?',
        ['agent-mem-iso'],
      );
      expect(agentMem).toBeDefined();
      expect(agentMem?.content).toBe('Agent private secret that must survive');
    });
  });
});
