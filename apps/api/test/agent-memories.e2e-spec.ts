import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness/index.js';

describe('Agent Memories Endpoints (e2e)', () => {
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

  describe('GET /api/v1/agents/:agentId/memories', () => {
    it('returns 404 when agent does not exist', async () => {
      const res = await testApp
        .request()
        .get('/api/v1/agents/unknown-agent-id/memories')
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('AGENT_NOT_FOUND');
    });

    it('returns 200 with an empty paginated collection when agent has no memories (not 404)', async () => {
      const agent = testApp.fixtures.createAgent({ name: 'Empty Agent' });

      const res = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories`)
        .expect(200);

      expect(res.body).toEqual({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      });
    });

    it("returns only that agent's memories and no others (isolation between agents)", async () => {
      const agentA = testApp.fixtures.createAgent({ name: 'Agent A' });
      const agentB = testApp.fixtures.createAgent({ name: 'Agent B' });

      await testApp
        .request()
        .post(`/api/v1/agents/${agentA.id}/memories`)
        .send({ content: 'Agent A memory 1', tags: ['alpha'] })
        .expect(201);

      await testApp
        .request()
        .post(`/api/v1/agents/${agentA.id}/memories`)
        .send({ content: 'Agent A memory 2' })
        .expect(201);

      await testApp
        .request()
        .post(`/api/v1/agents/${agentB.id}/memories`)
        .send({ content: 'Agent B private fact' })
        .expect(201);

      const resA = await testApp
        .request()
        .get(`/api/v1/agents/${agentA.id}/memories`)
        .expect(200);

      expect(resA.body.total).toBe(2);
      expect(resA.body.items).toHaveLength(2);
      const contentsA = resA.body.items.map((m: any) => m.content);
      expect(contentsA).toContain('Agent A memory 1');
      expect(contentsA).toContain('Agent A memory 2');

      const resB = await testApp
        .request()
        .get(`/api/v1/agents/${agentB.id}/memories`)
        .expect(200);

      expect(resB.body.total).toBe(1);
      expect(resB.body.items).toHaveLength(1);
      expect(resB.body.items[0].agentId).toBe(agentB.id);
      expect(resB.body.items[0].content).toBe('Agent B private fact');
    });

    it('supports pagination query parameters (limit and offset)', async () => {
      const agent = testApp.fixtures.createAgent();

      for (let i = 1; i <= 4; i++) {
        await testApp
          .request()
          .post(`/api/v1/agents/${agent.id}/memories`)
          .send({ content: `Memory number ${i}` })
          .expect(201);
      }

      const page1 = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories?limit=2&offset=0&order=asc`)
        .expect(200);

      expect(page1.body.total).toBe(4);
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.items[0].content).toBe('Memory number 1');
      expect(page1.body.items[1].content).toBe('Memory number 2');

      const page2 = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories?limit=2&offset=2&order=asc`)
        .expect(200);

      expect(page2.body.total).toBe(4);
      expect(page2.body.items).toHaveLength(2);
      expect(page2.body.items[0].content).toBe('Memory number 3');
      expect(page2.body.items[1].content).toBe('Memory number 4');
    });

    it('supports sorting query parameters (sort and sortBy)', async () => {
      const agent = testApp.fixtures.createAgent();

      await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Beta' })
        .expect(201);

      await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Alpha' })
        .expect(201);

      const asc = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories?sortBy=content&order=asc`)
        .expect(200);

      expect(asc.body.items.map((m: any) => m.content)).toEqual([
        'Alpha',
        'Beta',
      ]);

      const desc = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories?sort=content&order=desc`)
        .expect(200);

      expect(desc.body.items.map((m: any) => m.content)).toEqual([
        'Beta',
        'Alpha',
      ]);
    });

    it('returns 400 for invalid sort column', async () => {
      const agent = testApp.fixtures.createAgent();

      const res = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories?sort=unsupported_col`)
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toContain('Invalid sort field');
    });

    it('supports filtering by tag', async () => {
      const agent = testApp.fixtures.createAgent();

      await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Work memory', tags: ['work', 'project-x'] })
        .expect(201);

      await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Personal memory', tags: ['personal'] })
        .expect(201);

      const res = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories?tag=project-x`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.items[0].content).toBe('Work memory');
      expect(res.body.items[0].tags).toEqual(['work', 'project-x']);
    });

    it('supports filtering by content and search alias', async () => {
      const agent = testApp.fixtures.createAgent();

      await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'TypeScript is preferred' })
        .expect(201);

      await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Python is also good' })
        .expect(201);

      const contentRes = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories?content=TypeScript`)
        .expect(200);

      expect(contentRes.body.total).toBe(1);
      expect(contentRes.body.items[0].content).toBe('TypeScript is preferred');

      const searchRes = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories?search=preferred`)
        .expect(200);

      expect(searchRes.body.total).toBe(1);
      expect(searchRes.body.items[0].content).toBe('TypeScript is preferred');
    });
  });

  describe('POST /api/v1/agents/:agentId/memories', () => {
    it('returns 404 when agent does not exist', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/agents/unknown-agent-id/memories')
        .send({ content: 'Will fail' })
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('AGENT_NOT_FOUND');
    });

    it('creates a new memory and returns 201 with Location header and server-managed fields', async () => {
      const agent = testApp.fixtures.createAgent();

      const res = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({
          content: 'Remember that the API uses UUIDv7 identifiers.',
          tags: ['architecture', 'conventions'],
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.agentId).toBe(agent.id);
      expect(res.body.content).toBe(
        'Remember that the API uses UUIDv7 identifiers.',
      );
      expect(res.body.tags).toEqual(['architecture', 'conventions']);
      expect(res.body.createdAt).toBeDefined();
      expect(res.body.updatedAt).toBe(res.body.createdAt);

      expect(res.headers.location).toBe(
        `/api/v1/agents/${agent.id}/memories/${res.body.id}`,
      );
    });

    it('round-trips tags as an array of strings, not a raw JSON string', async () => {
      const agent = testApp.fixtures.createAgent();

      const res = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({
          content: 'Tag array verification',
          tags: ['tag1', 'tag2'],
        })
        .expect(201);

      expect(Array.isArray(res.body.tags)).toBe(true);
      expect(res.body.tags).toEqual(['tag1', 'tag2']);

      const fetchRes = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories`)
        .expect(200);

      expect(Array.isArray(fetchRes.body.items[0].tags)).toBe(true);
      expect(fetchRes.body.items[0].tags).toEqual(['tag1', 'tag2']);
    });

    it('normalises empty tags array to SQL NULL in storage and returns empty array', async () => {
      const agent = testApp.fixtures.createAgent();

      const res = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({
          content: 'Memory with empty tags array',
          tags: [],
        })
        .expect(201);

      expect(res.body.tags).toEqual([]);

      const dbRow = testApp.db.get<{ tags: string | null }>(
        'SELECT tags FROM agent_memories WHERE id = ?',
        [res.body.id],
      );
      expect(dbRow?.tags).toBeNull();
    });

    it('normalises omitted tags to SQL NULL in storage and returns empty array', async () => {
      const agent = testApp.fixtures.createAgent();

      const res = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({
          content: 'Memory with omitted tags',
        })
        .expect(201);

      expect(res.body.tags).toEqual([]);

      const dbRow = testApp.db.get<{ tags: string | null }>(
        'SELECT tags FROM agent_memories WHERE id = ?',
        [res.body.id],
      );
      expect(dbRow?.tags).toBeNull();
    });

    it('rejects agentId in request body with 400', async () => {
      const agent = testApp.fixtures.createAgent();

      const res = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({
          content: 'Valid content',
          agentId: agent.id,
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'property agentId should not exist',
      );
    });

    it('rejects client-supplied id, createdAt, or updatedAt with 400', async () => {
      const agent = testApp.fixtures.createAgent();

      const res = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
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
      const agent = testApp.fixtures.createAgent();

      const res = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ tags: ['preference'] })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'content must not be empty',
      );
    });

    it('rejects empty content string with 400', async () => {
      const agent = testApp.fixtures.createAgent();

      const res = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: '', tags: ['preference'] })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'content must not be empty',
      );
    });

    it('rejects non-array tags with 400', async () => {
      const agent = testApp.fixtures.createAgent();

      const res = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Valid content', tags: 'not-an-array' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'tags must be an array',
      );
    });

    it('rejects tags containing non-string items with 400', async () => {
      const agent = testApp.fixtures.createAgent();

      const res = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Valid content', tags: ['valid', 12345] })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'each tag must be a string',
      );
    });

    it('rejects tags containing empty string with 400', async () => {
      const agent = testApp.fixtures.createAgent();

      const res = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Valid content', tags: ['valid', ''] })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'tags cannot contain empty strings',
      );
    });
  });

  describe('GET /api/v1/agents/:agentId/memories/:memoryId', () => {
    it('returns 200 with the memory resource when it exists and belongs to the agent', async () => {
      const agent = testApp.fixtures.createAgent();
      const createRes = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({
          content: 'Specific agent memory',
          tags: ['knowledge'],
        })
        .expect(201);

      const res = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories/${createRes.body.id}`)
        .expect(200);

      expect(res.body).toEqual(createRes.body);
    });

    it('returns 404 when agent does not exist', async () => {
      const res = await testApp
        .request()
        .get('/api/v1/agents/unknown-agent/memories/mem-1')
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('AGENT_NOT_FOUND');
    });

    it('returns 404 when memory does not exist for an existing agent', async () => {
      const agent = testApp.fixtures.createAgent();

      await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories/non-existent-memory-id`)
        .expect(404);
    });

    it('returns 404 when memory exists but belongs to a different agent (cross-agent isolation)', async () => {
      const agentA = testApp.fixtures.createAgent({ name: 'Agent A' });
      const agentB = testApp.fixtures.createAgent({ name: 'Agent B' });

      const memoryA = await testApp
        .request()
        .post(`/api/v1/agents/${agentA.id}/memories`)
        .send({ content: 'Agent A secret knowledge' })
        .expect(201);

      // Attempt to access Agent A's memory through Agent B's URL
      await testApp
        .request()
        .get(`/api/v1/agents/${agentB.id}/memories/${memoryA.body.id}`)
        .expect(404);
    });
  });

  describe('PATCH /api/v1/agents/:agentId/memories/:memoryId', () => {
    it('updates only content and leaves tags intact', async () => {
      const agent = testApp.fixtures.createAgent();
      const createRes = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({
          content: 'Original content',
          tags: ['preserved-tag'],
        })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}/memories/${createRes.body.id}`)
        .send({ content: 'Updated content only' })
        .expect(200);

      expect(res.body.content).toBe('Updated content only');
      expect(res.body.tags).toEqual(['preserved-tag']);
      expect(res.body.createdAt).toBe(createRes.body.createdAt);
      expect(res.body.updatedAt).toBeDefined();
    });

    it('updates only tags and leaves content intact', async () => {
      const agent = testApp.fixtures.createAgent();
      const createRes = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({
          content: 'Content stays intact',
          tags: ['old-tag'],
        })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}/memories/${createRes.body.id}`)
        .send({ tags: ['new-tag-1', 'new-tag-2'] })
        .expect(200);

      expect(res.body.content).toBe('Content stays intact');
      expect(res.body.tags).toEqual(['new-tag-1', 'new-tag-2']);
    });

    it('clears tags when setting tags to empty array (normalised to SQL NULL in DB)', async () => {
      const agent = testApp.fixtures.createAgent();
      const createRes = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({
          content: 'Content',
          tags: ['initial-tag'],
        })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}/memories/${createRes.body.id}`)
        .send({ tags: [] })
        .expect(200);

      expect(res.body.tags).toEqual([]);

      const dbRow = testApp.db.get<{ tags: string | null }>(
        'SELECT tags FROM agent_memories WHERE id = ?',
        [createRes.body.id],
      );
      expect(dbRow?.tags).toBeNull();
    });

    it('clears tags when setting tags to null (normalised to SQL NULL in DB)', async () => {
      const agent = testApp.fixtures.createAgent();
      const createRes = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({
          content: 'Content',
          tags: ['initial-tag'],
        })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}/memories/${createRes.body.id}`)
        .send({ tags: null })
        .expect(200);

      expect(res.body.tags).toEqual([]);

      const dbRow = testApp.db.get<{ tags: string | null }>(
        'SELECT tags FROM agent_memories WHERE id = ?',
        [createRes.body.id],
      );
      expect(dbRow?.tags).toBeNull();
    });

    it('treats empty update body as an idempotent no-op without bumping updatedAt', async () => {
      const agent = testApp.fixtures.createAgent();
      const createRes = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Unchanged content' })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}/memories/${createRes.body.id}`)
        .send({})
        .expect(200);

      expect(res.body.updatedAt).toBe(createRes.body.updatedAt);
    });

    it('returns 404 when agent does not exist', async () => {
      await testApp
        .request()
        .patch('/api/v1/agents/unknown-agent/memories/mem-1')
        .send({ content: 'Will fail' })
        .expect(404);
    });

    it('returns 404 when memory does not exist', async () => {
      const agent = testApp.fixtures.createAgent();

      await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}/memories/unknown-memory`)
        .send({ content: 'Will fail' })
        .expect(404);
    });

    it('returns 404 when attempting to update another agent memory and leaves DB intact (cross-agent isolation)', async () => {
      const agentA = testApp.fixtures.createAgent({ name: 'Agent A' });
      const agentB = testApp.fixtures.createAgent({ name: 'Agent B' });

      const memoryA = await testApp
        .request()
        .post(`/api/v1/agents/${agentA.id}/memories`)
        .send({ content: 'Agent A original content', tags: ['safe'] })
        .expect(201);

      // Attempt update through Agent B's route
      await testApp
        .request()
        .patch(`/api/v1/agents/${agentB.id}/memories/${memoryA.body.id}`)
        .send({ content: 'Tampered content' })
        .expect(404);

      // Verify row in DB remains untouched
      const row = testApp.db.get<{ content: string; tags: string }>(
        'SELECT content, tags FROM agent_memories WHERE id = ?',
        [memoryA.body.id],
      );
      expect(row?.content).toBe('Agent A original content');
      expect(row?.tags).toBe('["safe"]');
    });

    it('rejects setting content to null with 400', async () => {
      const agent = testApp.fixtures.createAgent();
      const createRes = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Initial' })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}/memories/${createRes.body.id}`)
        .send({ content: null })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'content must be a string',
      );
    });

    it('rejects setting content to empty string with 400', async () => {
      const agent = testApp.fixtures.createAgent();
      const createRes = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Initial' })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}/memories/${createRes.body.id}`)
        .send({ content: '' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'content must not be empty',
      );
    });

    it('rejects non-string items in tags with 400', async () => {
      const agent = testApp.fixtures.createAgent();
      const createRes = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Initial' })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}/memories/${createRes.body.id}`)
        .send({ tags: ['valid', 12345] })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'each tag must be a string',
      );
    });

    it('rejects empty string in tags with 400', async () => {
      const agent = testApp.fixtures.createAgent();
      const createRes = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Initial' })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}/memories/${createRes.body.id}`)
        .send({ tags: ['valid', ''] })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'tags cannot contain empty strings',
      );
    });

    it('rejects agentId in PATCH body with 400', async () => {
      const agent = testApp.fixtures.createAgent();
      const createRes = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Initial' })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}/memories/${createRes.body.id}`)
        .send({ agentId: 'another-agent-id' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        'property agentId should not exist',
      );
    });

    it('rejects client-supplied id, createdAt, updatedAt in PATCH body with 400', async () => {
      const agent = testApp.fixtures.createAgent();
      const createRes = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Initial' })
        .expect(201);

      const res = await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}/memories/${createRes.body.id}`)
        .send({
          id: 'new-id',
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z',
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/v1/agents/:agentId/memories/:memoryId', () => {
    it('returns 204 and permanently removes the memory', async () => {
      const agent = testApp.fixtures.createAgent();
      const createRes = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'To be deleted' })
        .expect(201);

      const memoryId = createRes.body.id;

      await testApp
        .request()
        .delete(`/api/v1/agents/${agent.id}/memories/${memoryId}`)
        .expect(204);

      // Verify memory is gone via GET
      await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories/${memoryId}`)
        .expect(404);

      // Verify memory is gone in DB
      const dbRow = testApp.db.get(
        'SELECT * FROM agent_memories WHERE id = ?',
        [memoryId],
      );
      expect(dbRow).toBeUndefined();
    });

    it('returns 404 when agent does not exist', async () => {
      await testApp
        .request()
        .delete('/api/v1/agents/unknown-agent/memories/mem-1')
        .expect(404);
    });

    it('returns 404 when memory does not exist', async () => {
      const agent = testApp.fixtures.createAgent();

      await testApp
        .request()
        .delete(`/api/v1/agents/${agent.id}/memories/unknown-memory`)
        .expect(404);
    });

    it('returns 404 when attempting to delete another agent memory and leaves DB intact (cross-agent isolation)', async () => {
      const agentA = testApp.fixtures.createAgent({ name: 'Agent A' });
      const agentB = testApp.fixtures.createAgent({ name: 'Agent B' });

      const memoryA = await testApp
        .request()
        .post(`/api/v1/agents/${agentA.id}/memories`)
        .send({ content: 'Agent A indispensable memory' })
        .expect(201);

      // Attempt delete through Agent B's URL
      await testApp
        .request()
        .delete(`/api/v1/agents/${agentB.id}/memories/${memoryA.body.id}`)
        .expect(404);

      // Verify row still exists in DB
      const dbRow = testApp.db.get(
        'SELECT * FROM agent_memories WHERE id = ?',
        [memoryA.body.id],
      );
      expect(dbRow).toBeDefined();
    });
  });

  describe('ON DELETE CASCADE behaviour', () => {
    it('deletes agent memories automatically when the referencing agent is deleted', async () => {
      const agent = testApp.fixtures.createAgent();

      const createRes = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Memory to cascade' })
        .expect(201);

      const memoryId = createRes.body.id;

      // Verify row exists in DB
      const rowBefore = testApp.db.get(
        'SELECT * FROM agent_memories WHERE id = ?',
        [memoryId],
      );
      expect(rowBefore).toBeDefined();

      // Delete the agent via API
      await testApp.request().delete(`/api/v1/agents/${agent.id}`).expect(204);

      // Verify memory is deleted from DB via CASCADE
      const rowAfter = testApp.db.get(
        'SELECT * FROM agent_memories WHERE id = ?',
        [memoryId],
      );
      expect(rowAfter).toBeUndefined();

      // Verify querying memories endpoint for this agent now returns 404
      await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories`)
        .expect(404);
    });
  });

  describe('DELETE /api/v1/agents/:agentId/memories (bulk deletion)', () => {
    it('returns 400 when ?confirm=true is missing or invalid, and leaves DB untouched', async () => {
      const agent = testApp.fixtures.createAgent();
      await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Memory that must survive absent confirm' })
        .expect(201);

      // 1. Missing confirm query param
      const resNoConfirm = await testApp
        .request()
        .delete(`/api/v1/agents/${agent.id}/memories`)
        .expect(400);

      expect(resNoConfirm.body.statusCode).toBe(400);
      expect(JSON.stringify(resNoConfirm.body)).toContain('confirm');

      // 2. confirm=false
      const resConfirmFalse = await testApp
        .request()
        .delete(`/api/v1/agents/${agent.id}/memories?confirm=false`)
        .expect(400);

      expect(resConfirmFalse.body.statusCode).toBe(400);

      // Verify row still exists in DB
      const dbRows = testApp.db.all(
        'SELECT * FROM agent_memories WHERE agent_id = ?',
        [agent.id],
      );
      expect(dbRows).toHaveLength(1);
    });

    it('returns 404 when agent does not exist', async () => {
      const res = await testApp
        .request()
        .delete('/api/v1/agents/unknown-agent-id/memories?confirm=true')
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('AGENT_NOT_FOUND');
    });

    it('returns 200 with { deleted: 0 } when agent has no memories (not 404)', async () => {
      const agent = testApp.fixtures.createAgent({ name: 'Empty Agent' });

      const res = await testApp
        .request()
        .delete(`/api/v1/agents/${agent.id}/memories?confirm=true`)
        .expect(200);

      expect(res.body).toEqual({ deleted: 0 });
    });

    it("clears only the target agent's memories, leaving other agents and shared memories intact (cross-contamination guard)", async () => {
      const agentA = testApp.fixtures.createAgent({ name: 'Agent A' });
      const agentB = testApp.fixtures.createAgent({ name: 'Agent B' });

      // Seed 2 memories for Agent A
      await testApp
        .request()
        .post(`/api/v1/agents/${agentA.id}/memories`)
        .send({ content: 'Agent A fact 1' })
        .expect(201);
      await testApp
        .request()
        .post(`/api/v1/agents/${agentA.id}/memories`)
        .send({ content: 'Agent A fact 2' })
        .expect(201);

      // Seed 2 memories for Agent B
      await testApp
        .request()
        .post(`/api/v1/agents/${agentB.id}/memories`)
        .send({ content: 'Agent B fact 1' })
        .expect(201);
      await testApp
        .request()
        .post(`/api/v1/agents/${agentB.id}/memories`)
        .send({ content: 'Agent B fact 2' })
        .expect(201);

      // Seed 2 shared memories
      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Global shared memory 1' })
        .expect(201);
      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Global shared memory 2' })
        .expect(201);

      // Clear Agent A's memories
      const deleteRes = await testApp
        .request()
        .delete(`/api/v1/agents/${agentA.id}/memories?confirm=true`)
        .expect(200);

      expect(deleteRes.body).toEqual({ deleted: 2 });

      // Verify Agent A has 0 memories via GET
      const getResA = await testApp
        .request()
        .get(`/api/v1/agents/${agentA.id}/memories`)
        .expect(200);
      expect(getResA.body.total).toBe(0);
      expect(getResA.body.items).toHaveLength(0);

      // Verify Agent B still has all 2 memories
      const getResB = await testApp
        .request()
        .get(`/api/v1/agents/${agentB.id}/memories`)
        .expect(200);
      expect(getResB.body.total).toBe(2);
      expect(getResB.body.items).toHaveLength(2);

      // Verify shared memories are untouched
      const getSharedRes = await testApp
        .request()
        .get('/api/v1/memories')
        .expect(200);
      expect(getSharedRes.body.total).toBe(2);
      expect(getSharedRes.body.items).toHaveLength(2);
    });
  });
});
