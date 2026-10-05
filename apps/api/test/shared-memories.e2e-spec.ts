import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness/index.js';

describe('Shared Memories Endpoints (e2e)', () => {
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

  describe('GET /api/v1/memories', () => {
    it('returns 200 with an empty paginated collection when there are none', async () => {
      const res = await testApp.request().get('/api/v1/memories').expect(200);

      expect(res.body).toEqual({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      });
    });

    it('returns a paginated list of created shared memories', async () => {
      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Shared convention 1' })
        .expect(201);

      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Shared convention 2' })
        .expect(201);

      const res = await testApp.request().get('/api/v1/memories').expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.items).toHaveLength(2);
      const contents = res.body.items.map((m: any) => m.content);
      expect(contents).toContain('Shared convention 1');
      expect(contents).toContain('Shared convention 2');
    });

    it('supports pagination query parameters (limit and offset)', async () => {
      for (let i = 1; i <= 4; i++) {
        await testApp
          .request()
          .post('/api/v1/memories')
          .send({ content: `Convention number ${i}` })
          .expect(201);
      }

      const page1 = await testApp
        .request()
        .get('/api/v1/memories?limit=2&offset=0&order=asc')
        .expect(200);

      expect(page1.body.total).toBe(4);
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.items[0].content).toBe('Convention number 1');
      expect(page1.body.items[1].content).toBe('Convention number 2');

      const page2 = await testApp
        .request()
        .get('/api/v1/memories?limit=2&offset=2&order=asc')
        .expect(200);

      expect(page2.body.total).toBe(4);
      expect(page2.body.items).toHaveLength(2);
      expect(page2.body.items[0].content).toBe('Convention number 3');
      expect(page2.body.items[1].content).toBe('Convention number 4');
    });

    it('supports sorting query parameters (sort and sortBy)', async () => {
      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Beta' })
        .expect(201);

      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Alpha' })
        .expect(201);

      const asc = await testApp
        .request()
        .get('/api/v1/memories?sortBy=content&order=asc')
        .expect(200);

      expect(asc.body.items.map((m: any) => m.content)).toEqual([
        'Alpha',
        'Beta',
      ]);

      const desc = await testApp
        .request()
        .get('/api/v1/memories?sort=content&order=desc')
        .expect(200);

      expect(desc.body.items.map((m: any) => m.content)).toEqual([
        'Beta',
        'Alpha',
      ]);
    });

    it('returns 400 for invalid sort column', async () => {
      const res = await testApp
        .request()
        .get('/api/v1/memories?sort=invalid_col')
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toContain('Invalid sort field');
    });

    it('supports filtering by tag', async () => {
      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Styling guide', tags: ['style', 'frontend'] })
        .expect(201);

      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Database guide', tags: ['database'] })
        .expect(201);

      const res = await testApp
        .request()
        .get('/api/v1/memories?tag=frontend')
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.items[0].content).toBe('Styling guide');
      expect(res.body.items[0].tags).toEqual(['style', 'frontend']);
    });

    it('supports filtering by content and search alias', async () => {
      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Use Prettier formatting' })
        .expect(201);

      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Use Oxlint rules' })
        .expect(201);

      const contentRes = await testApp
        .request()
        .get('/api/v1/memories?content=Prettier')
        .expect(200);

      expect(contentRes.body.total).toBe(1);
      expect(contentRes.body.items[0].content).toBe('Use Prettier formatting');

      const searchRes = await testApp
        .request()
        .get('/api/v1/memories?search=rules')
        .expect(200);

      expect(searchRes.body.total).toBe(1);
      expect(searchRes.body.items[0].content).toBe('Use Oxlint rules');
    });
  });

  describe('POST /api/v1/memories', () => {
    it('creates a new shared memory and returns 201 with Location header and server-managed fields', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/memories')
        .send({
          content: 'Global coding standard for the codebase.',
          tags: ['architecture', 'standards'],
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.content).toBe('Global coding standard for the codebase.');
      expect(res.body.tags).toEqual(['architecture', 'standards']);
      expect(res.body.createdAt).toBeDefined();
      expect(res.body.updatedAt).toBe(res.body.createdAt);

      expect(res.headers.location).toBe(`/api/v1/memories/${res.body.id}`);
    });

    it('round-trips tags as an array of strings, not a raw JSON string', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/memories')
        .send({
          content: 'Tag array check',
          tags: ['tag1', 'tag2'],
        })
        .expect(201);

      expect(Array.isArray(res.body.tags)).toBe(true);
      expect(res.body.tags).toEqual(['tag1', 'tag2']);

      const fetchRes = await testApp
        .request()
        .get('/api/v1/memories')
        .expect(200);

      expect(Array.isArray(fetchRes.body.items[0].tags)).toBe(true);
      expect(fetchRes.body.items[0].tags).toEqual(['tag1', 'tag2']);
    });

    it('normalises empty tags array to SQL NULL in storage and returns empty array', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/memories')
        .send({
          content: 'Empty tags memory',
          tags: [],
        })
        .expect(201);

      expect(res.body.tags).toEqual([]);

      const dbRow = testApp.db.get<{ tags: string | null }>(
        'SELECT tags FROM shared_memories WHERE id = ?',
        [res.body.id],
      );
      expect(dbRow?.tags).toBeNull();
    });

    it('normalises omitted tags to SQL NULL in storage and returns empty array', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/memories')
        .send({
          content: 'Omitted tags memory',
        })
        .expect(201);

      expect(res.body.tags).toEqual([]);

      const dbRow = testApp.db.get<{ tags: string | null }>(
        'SELECT tags FROM shared_memories WHERE id = ?',
        [res.body.id],
      );
      expect(dbRow?.tags).toBeNull();
    });

    it('rejects agentId in request body with 400 (shared memory has no scoping column)', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/memories')
        .send({
          content: 'Should not allow agentId',
          agentId: '018f3a9e-0000-7000-8000-000000000001',
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'property agentId should not exist',
      );
    });

    it('rejects client-supplied id, createdAt, or updatedAt with 400', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/memories')
        .send({
          content: 'Valid content',
          id: 'client-supplied-id',
          createdAt: '2026-10-04T00:00:00.000Z',
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'property id should not exist',
      );
      expect(JSON.stringify(res.body.details)).toContain(
        'property createdAt should not exist',
      );
    });

    it('rejects missing content with 400', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/memories')
        .send({ tags: ['preference'] })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'content must not be empty',
      );
    });

    it('rejects empty content string with 400', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: '', tags: ['preference'] })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'content must not be empty',
      );
    });

    it('rejects non-array tags with 400', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Valid content', tags: 'not-an-array' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'tags must be an array',
      );
    });

    it('rejects tags containing non-string items with 400', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Valid content', tags: ['valid', 12345] })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'each tag must be a string',
      );
    });

    it('rejects tags containing empty string with 400', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Valid content', tags: ['valid', ''] })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'tags cannot contain empty strings',
      );
    });
  });

  describe('Isolation between shared and agent memories', () => {
    it('asserts shared memories never appear in agent memory listing, and vice versa', async () => {
      const agent = testApp.fixtures.createAgent({ name: 'Special Agent' });

      // Create an agent-private memory
      const agentMemRes = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Agent private secret' })
        .expect(201);

      // Create a shared memory
      const sharedMemRes = await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Shared global fact' })
        .expect(201);

      // Verify GET /api/v1/memories contains only the shared memory
      const sharedListRes = await testApp
        .request()
        .get('/api/v1/memories')
        .expect(200);

      expect(sharedListRes.body.total).toBe(1);
      expect(sharedListRes.body.items[0].id).toBe(sharedMemRes.body.id);
      expect(sharedListRes.body.items[0].content).toBe('Shared global fact');
      expect(
        sharedListRes.body.items.some((m: any) => m.id === agentMemRes.body.id),
      ).toBe(false);

      // Verify GET /api/v1/agents/:agentId/memories contains only the agent memory
      const agentListRes = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories`)
        .expect(200);

      expect(agentListRes.body.total).toBe(1);
      expect(agentListRes.body.items[0].id).toBe(agentMemRes.body.id);
      expect(agentListRes.body.items[0].content).toBe('Agent private secret');
      expect(
        agentListRes.body.items.some((m: any) => m.id === sharedMemRes.body.id),
      ).toBe(false);
    });
  });
});
