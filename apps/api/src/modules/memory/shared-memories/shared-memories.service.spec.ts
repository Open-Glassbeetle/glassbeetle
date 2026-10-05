import { BadRequestException } from '@nestjs/common';
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
});
