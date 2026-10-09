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
      expect(res.body.items[0].tags).toEqual(['frontend', 'style']);
    });

    it('proves tag filtering composes correctly in SQL with pagination across pages', async () => {
      // Seed 10 untagged memories first
      for (let i = 1; i <= 10; i++) {
        await testApp
          .request()
          .post('/api/v1/memories')
          .send({ content: `Untagged background item ${i}` })
          .expect(201);
      }

      // Seed 5 tagged memories
      for (let i = 1; i <= 5; i++) {
        await testApp
          .request()
          .post('/api/v1/memories')
          .send({
            content: `Tagged target item ${i}`,
            tags: ['filtered-topic'],
          })
          .expect(201);
      }

      // Request page 1 with limit=2 (if pagination happened in app before filter, this would return 0 items)
      const page1 = await testApp
        .request()
        .get('/api/v1/memories?tag=filtered-topic&limit=2&offset=0&sortBy=content&order=asc')
        .expect(200);

      expect(page1.body.total).toBe(5);
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.items[0].content).toBe('Tagged target item 1');
      expect(page1.body.items[1].content).toBe('Tagged target item 2');

      // Request page 2 with limit=2, offset=2
      const page2 = await testApp
        .request()
        .get('/api/v1/memories?tag=filtered-topic&limit=2&offset=2&sortBy=content&order=asc')
        .expect(200);

      expect(page2.body.total).toBe(5);
      expect(page2.body.items).toHaveLength(2);
      expect(page2.body.items[0].content).toBe('Tagged target item 3');
      expect(page2.body.items[1].content).toBe('Tagged target item 4');

      // Request page 3 with limit=2, offset=4
      const page3 = await testApp
        .request()
        .get('/api/v1/memories?tag=filtered-topic&limit=2&offset=4&sortBy=content&order=asc')
        .expect(200);

      expect(page3.body.total).toBe(5);
      expect(page3.body.items).toHaveLength(1);
      expect(page3.body.items[0].content).toBe('Tagged target item 5');
    });

    it('supports multi-tag filtering with all and any modes', async () => {
      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Both tags', tags: ['alpha', 'beta'] })
        .expect(201);

      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Alpha only', tags: ['alpha'] })
        .expect(201);

      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Beta only', tags: ['beta'] })
        .expect(201);

      // Mode all (default): requires alpha AND beta
      const allRes = await testApp
        .request()
        .get('/api/v1/memories?tags=alpha,beta&tagMode=all')
        .expect(200);

      expect(allRes.body.total).toBe(1);
      expect(allRes.body.items[0].content).toBe('Both tags');

      // Mode any: requires alpha OR beta
      const anyRes = await testApp
        .request()
        .get('/api/v1/memories?tags=alpha,beta&tagMode=any')
        .expect(200);

      expect(anyRes.body.total).toBe(3);
    });

    it('safely handles SQL injection attempts through tag query parameter', async () => {
      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Confidential knowledge', tags: ['confidential'] })
        .expect(201);

      const res = await testApp
        .request()
        .get("/api/v1/memories?tag=' OR '1'='1")
        .expect(200);

      expect(res.body.total).toBe(0);
      expect(res.body.items).toHaveLength(0);
    });

    it('gracefully degrades when database contains a row with malformed JSON tags', async () => {
      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Valid memory', tags: ['valid'] })
        .expect(201);

      // Manually corrupt one row's tags column
      testApp.db.run(
        `INSERT INTO shared_memories (id, content, tags, created_at, updated_at)
         VALUES ('bad-json-shared-e2e', 'Corrupt tags content', '{corrupt json', '2026-10-04T00:00:00.000Z', '2026-10-04T00:00:00.000Z')`,
      );

      // List endpoint succeeds and parses bad tags row as []
      const listRes = await testApp
        .request()
        .get('/api/v1/memories')
        .expect(200);

      expect(listRes.body.total).toBe(2);
      const corruptItem = listRes.body.items.find((i: any) => i.id === 'bad-json-shared-e2e');
      expect(corruptItem.tags).toEqual([]);

      // Filter query also succeeds without json_each throwing
      const filterRes = await testApp
        .request()
        .get('/api/v1/memories?tag=valid')
        .expect(200);

      expect(filterRes.body.total).toBe(1);
      expect(filterRes.body.items[0].content).toBe('Valid memory');
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

  describe('GET /api/v1/memories/:memoryId', () => {
    it('returns 200 with the memory resource when it exists', async () => {
      const createRes = await testApp
        .request()
        .post('/api/v1/memories')
        .send({
          content: 'Specific shared memory',
          tags: ['knowledge'],
        })
        .expect(201);

      const res = await testApp
        .request()
        .get(`/api/v1/memories/${createRes.body.id}`)
        .expect(200);

      expect(res.body).toEqual(createRes.body);
    });

    it('returns 404 when memory does not exist', async () => {
      await testApp
        .request()
        .get('/api/v1/memories/non-existent-memory-id')
        .expect(404);
    });

    it('returns 404 when passed an agent memory ID and leaves agent memory untouched', async () => {
      const agent = testApp.fixtures.createAgent();
      const agentMem = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Agent private secret' })
        .expect(201);

      await testApp
        .request()
        .get(`/api/v1/memories/${agentMem.body.id}`)
        .expect(404);

      // Verify agent memory is still in agent_memories table
      const agentMemCheck = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories/${agentMem.body.id}`)
        .expect(200);
      expect(agentMemCheck.body.content).toBe('Agent private secret');
    });
  });

  describe('PATCH /api/v1/memories/:memoryId', () => {
    it('updates only content and leaves tags intact', async () => {
      const createRes = await testApp
        .request()
        .post('/api/v1/memories')
        .send({
          content: 'Original content',
          tags: ['preserved-tag'],
        })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/memories/${createRes.body.id}`)
        .send({ content: 'Updated content only' })
        .expect(200);

      expect(res.body.content).toBe('Updated content only');
      expect(res.body.tags).toEqual(['preserved-tag']);
      expect(res.body.createdAt).toBe(createRes.body.createdAt);
      expect(res.body.updatedAt).toBeDefined();
    });

    it('updates only tags and leaves content intact', async () => {
      const createRes = await testApp
        .request()
        .post('/api/v1/memories')
        .send({
          content: 'Content stays intact',
          tags: ['old-tag'],
        })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/memories/${createRes.body.id}`)
        .send({ tags: ['new-tag-1', 'new-tag-2'] })
        .expect(200);

      expect(res.body.content).toBe('Content stays intact');
      expect(res.body.tags).toEqual(['new-tag-1', 'new-tag-2']);
    });

    it('clears tags when setting tags to empty array (normalised to SQL NULL in DB)', async () => {
      const createRes = await testApp
        .request()
        .post('/api/v1/memories')
        .send({
          content: 'Content',
          tags: ['initial-tag'],
        })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/memories/${createRes.body.id}`)
        .send({ tags: [] })
        .expect(200);

      expect(res.body.tags).toEqual([]);

      const dbRow = testApp.db.get<{ tags: string | null }>(
        'SELECT tags FROM shared_memories WHERE id = ?',
        [createRes.body.id],
      );
      expect(dbRow?.tags).toBeNull();
    });

    it('clears tags when setting tags to null (normalised to SQL NULL in DB)', async () => {
      const createRes = await testApp
        .request()
        .post('/api/v1/memories')
        .send({
          content: 'Content',
          tags: ['initial-tag'],
        })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/memories/${createRes.body.id}`)
        .send({ tags: null })
        .expect(200);

      expect(res.body.tags).toEqual([]);

      const dbRow = testApp.db.get<{ tags: string | null }>(
        'SELECT tags FROM shared_memories WHERE id = ?',
        [createRes.body.id],
      );
      expect(dbRow?.tags).toBeNull();
    });

    it('treats empty update body as an idempotent no-op without bumping updatedAt', async () => {
      const createRes = await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Unchanged content' })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/memories/${createRes.body.id}`)
        .send({})
        .expect(200);

      expect(res.body.updatedAt).toBe(createRes.body.updatedAt);
    });

    it('advances updatedAt on update while keeping createdAt unchanged', async () => {
      const createRes = await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Initial content' })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/memories/${createRes.body.id}`)
        .send({ content: 'Updated content' })
        .expect(200);

      expect(res.body.createdAt).toBe(createRes.body.createdAt);
      expect(res.body.content).toBe('Updated content');
    });

    it('returns 404 when memory does not exist', async () => {
      await testApp
        .request()
        .patch('/api/v1/memories/unknown-memory')
        .send({ content: 'Will fail' })
        .expect(404);
    });

    it('returns 404 when passing an agent memory ID and leaves agent memory untouched', async () => {
      const agent = testApp.fixtures.createAgent();
      const agentMem = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Agent private secret', tags: ['safe'] })
        .expect(201);

      await testApp
        .request()
        .patch(`/api/v1/memories/${agentMem.body.id}`)
        .send({ content: 'Tampered content' })
        .expect(404);

      // Verify agent memory in DB is untouched
      const agentMemCheck = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories/${agentMem.body.id}`)
        .expect(200);
      expect(agentMemCheck.body.content).toBe('Agent private secret');
      expect(agentMemCheck.body.tags).toEqual(['safe']);
    });

    it('rejects setting content to null with 400', async () => {
      const createRes = await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Initial' })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/memories/${createRes.body.id}`)
        .send({ content: null })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'content must be a string',
      );
    });

    it('rejects setting content to empty string with 400', async () => {
      const createRes = await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Initial' })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/memories/${createRes.body.id}`)
        .send({ content: '' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'content must not be empty',
      );
    });

    it('rejects non-string items in tags with 400', async () => {
      const createRes = await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Initial' })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/memories/${createRes.body.id}`)
        .send({ tags: ['valid', 12345] })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'each tag must be a string',
      );
    });

    it('rejects empty string in tags with 400', async () => {
      const createRes = await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Initial' })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/memories/${createRes.body.id}`)
        .send({ tags: ['valid', ''] })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'tags cannot contain empty strings',
      );
    });

    it('rejects agentId in PATCH body with 400', async () => {
      const createRes = await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Initial' })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/memories/${createRes.body.id}`)
        .send({ agentId: '018f3a9e-0000-7000-8000-000000000001' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'property agentId should not exist',
      );
    });

    it('rejects client-supplied id, createdAt, or updatedAt in PATCH body with 400', async () => {
      const createRes = await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Initial' })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/memories/${createRes.body.id}`)
        .send({
          id: 'new-id',
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z',
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/v1/memories/:memoryId', () => {
    it('returns 204 and permanently removes the memory', async () => {
      const createRes = await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'To be deleted' })
        .expect(201);

      const memoryId = createRes.body.id;

      await testApp
        .request()
        .delete(`/api/v1/memories/${memoryId}`)
        .expect(204);

      // Verify memory is gone via GET
      await testApp.request().get(`/api/v1/memories/${memoryId}`).expect(404);
    });

    it('returns 404 when memory does not exist', async () => {
      await testApp
        .request()
        .delete('/api/v1/memories/non-existent-memory')
        .expect(404);
    });

    it('returns 404 when passing an agent memory ID and leaves agent memory untouched', async () => {
      const agent = testApp.fixtures.createAgent();
      const agentMem = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Agent memory to survive' })
        .expect(201);

      await testApp
        .request()
        .delete(`/api/v1/memories/${agentMem.body.id}`)
        .expect(404);

      // Verify agent memory is untouched
      const agentMemCheck = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories/${agentMem.body.id}`)
        .expect(200);
      expect(agentMemCheck.body.content).toBe('Agent memory to survive');
    });
  });

  describe('DELETE /api/v1/memories (bulk deletion)', () => {
    it('returns 400 when ?confirm=true is missing or invalid, and leaves DB untouched', async () => {
      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Shared memory to survive without confirm' })
        .expect(201);

      // 1. Missing confirm query param
      const resNoConfirm = await testApp
        .request()
        .delete('/api/v1/memories')
        .expect(400);

      expect(resNoConfirm.body.statusCode).toBe(400);
      expect(JSON.stringify(resNoConfirm.body)).toContain('confirm');

      // 2. confirm=false
      const resConfirmFalse = await testApp
        .request()
        .delete('/api/v1/memories?confirm=false')
        .expect(400);

      expect(resConfirmFalse.body.statusCode).toBe(400);

      // Verify row still exists in DB
      const dbRows = testApp.db.all('SELECT * FROM shared_memories');
      expect(dbRows).toHaveLength(1);
    });

    it('returns 200 with { deleted: 0 } when shared memories collection is empty', async () => {
      const res = await testApp
        .request()
        .delete('/api/v1/memories?confirm=true')
        .expect(200);

      expect(res.body).toEqual({ deleted: 0 });
    });

    it("clears all shared memories, leaving all agents' private memories intact (cross-contamination guard)", async () => {
      const agentA = testApp.fixtures.createAgent({ name: 'Agent A' });
      const agentB = testApp.fixtures.createAgent({ name: 'Agent B' });

      // Seed memories for Agent A and Agent B
      await testApp
        .request()
        .post(`/api/v1/agents/${agentA.id}/memories`)
        .send({ content: 'Agent A private fact' })
        .expect(201);

      await testApp
        .request()
        .post(`/api/v1/agents/${agentB.id}/memories`)
        .send({ content: 'Agent B private fact' })
        .expect(201);

      // Seed 3 shared memories
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
      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Shared convention 3' })
        .expect(201);

      // Bulk clear shared memories
      const deleteRes = await testApp
        .request()
        .delete('/api/v1/memories?confirm=true')
        .expect(200);

      expect(deleteRes.body).toEqual({ deleted: 3 });

      // Verify shared memories is empty via GET
      const getSharedRes = await testApp
        .request()
        .get('/api/v1/memories')
        .expect(200);
      expect(getSharedRes.body.total).toBe(0);
      expect(getSharedRes.body.items).toHaveLength(0);

      // Verify in DB
      const dbShared = testApp.db.all('SELECT * FROM shared_memories');
      expect(dbShared).toHaveLength(0);

      // Verify both agents' memories survive
      const getResA = await testApp
        .request()
        .get(`/api/v1/agents/${agentA.id}/memories`)
        .expect(200);
      expect(getResA.body.total).toBe(1);
      expect(getResA.body.items[0].content).toBe('Agent A private fact');

      const getResB = await testApp
        .request()
        .get(`/api/v1/agents/${agentB.id}/memories`)
        .expect(200);
      expect(getResB.body.total).toBe(1);
      expect(getResB.body.items[0].content).toBe('Agent B private fact');
    });
  });
});
