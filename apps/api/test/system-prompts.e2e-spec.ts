import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness/index.js';

describe('System Prompts Endpoints (e2e)', () => {
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

  describe('GET /api/v1/system-prompts', () => {
    it('returns 200 with an empty paginated collection when there are none (not 404)', async () => {
      const res = await testApp
        .request()
        .get('/api/v1/system-prompts')
        .expect(200);

      expect(res.body).toEqual({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      });
    });

    it('returns a paginated list of created system prompts', async () => {
      testApp.fixtures.createSystemPrompt({ name: 'Prompt A' });
      testApp.fixtures.createSystemPrompt({ name: 'Prompt B' });

      const res = await testApp
        .request()
        .get('/api/v1/system-prompts')
        .expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.limit).toBe(50);
      expect(res.body.offset).toBe(0);
    });

    it('supports pagination query parameters (limit and offset)', async () => {
      testApp.fixtures.createSystemPrompt({ name: 'Prompt 1' });
      testApp.fixtures.createSystemPrompt({ name: 'Prompt 2' });
      testApp.fixtures.createSystemPrompt({ name: 'Prompt 3' });

      const page1 = await testApp
        .request()
        .get('/api/v1/system-prompts?limit=2&offset=0&sort=name&order=asc')
        .expect(200);

      expect(page1.body.total).toBe(3);
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.items[0].name).toBe('Prompt 1');
      expect(page1.body.items[1].name).toBe('Prompt 2');

      const page2 = await testApp
        .request()
        .get('/api/v1/system-prompts?limit=2&offset=2&sort=name&order=asc')
        .expect(200);

      expect(page2.body.total).toBe(3);
      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.items[0].name).toBe('Prompt 3');
    });

    it('supports sorting query parameters', async () => {
      testApp.fixtures.createSystemPrompt({ name: 'Alpha' });
      testApp.fixtures.createSystemPrompt({ name: 'Beta' });

      const asc = await testApp
        .request()
        .get('/api/v1/system-prompts?sort=name&order=asc')
        .expect(200);
      expect(asc.body.items[0].name).toBe('Alpha');
      expect(asc.body.items[1].name).toBe('Beta');

      const desc = await testApp
        .request()
        .get('/api/v1/system-prompts?sort=name&order=desc')
        .expect(200);
      expect(desc.body.items[0].name).toBe('Beta');
      expect(desc.body.items[1].name).toBe('Alpha');
    });

    it('supports filtering by name substring search', async () => {
      testApp.fixtures.createSystemPrompt({ name: 'Researcher Assistant' });
      testApp.fixtures.createSystemPrompt({ name: 'Coding Helper' });

      const res = await testApp
        .request()
        .get('/api/v1/system-prompts?name=Researcher')
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.items[0].name).toBe('Researcher Assistant');
    });

    it('supports filtering via search alias', async () => {
      testApp.fixtures.createSystemPrompt({ name: 'Researcher Assistant' });
      testApp.fixtures.createSystemPrompt({ name: 'Coding Helper' });

      const res = await testApp
        .request()
        .get('/api/v1/system-prompts?search=Coding')
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.items[0].name).toBe('Coding Helper');
    });

    it('returns 400 for invalid sort column', async () => {
      await testApp
        .request()
        .get('/api/v1/system-prompts?sort=invalid_col')
        .expect(400);
    });
  });

  describe('POST /api/v1/system-prompts', () => {
    it('creates a new system prompt and returns 201 with Location header and server-managed fields', async () => {
      const payload = {
        name: 'Standard Assistant',
        content: 'You are a helpful and polite AI assistant.',
      };

      const res = await testApp
        .request()
        .post('/api/v1/system-prompts')
        .send(payload)
        .expect(201);

      const created = res.body;
      expect(res.headers.location).toBe(`/api/v1/system-prompts/${created.id}`);
      expect(created.id).toBeDefined();
      expect(created.name).toBe(payload.name);
      expect(created.content).toBe(payload.content);
      expect(created.createdAt).toBeDefined();
      expect(created.updatedAt).toBe(created.createdAt);

      // Verify prompt can be fetched via GET
      const getRes = await testApp
        .request()
        .get(`/api/v1/system-prompts/${created.id}`)
        .expect(200);

      expect(getRes.body).toEqual(created);
    });

    it('returns 400 when name is missing', async () => {
      await testApp
        .request()
        .post('/api/v1/system-prompts')
        .send({ content: 'Only content.' })
        .expect(400);
    });

    it('returns 400 when name is empty string', async () => {
      await testApp
        .request()
        .post('/api/v1/system-prompts')
        .send({ name: '', content: 'Some content.' })
        .expect(400);
    });

    it('returns 400 when content is missing', async () => {
      await testApp
        .request()
        .post('/api/v1/system-prompts')
        .send({ name: 'Only name' })
        .expect(400);
    });

    it('returns 400 when content is empty string', async () => {
      await testApp
        .request()
        .post('/api/v1/system-prompts')
        .send({ name: 'Valid name', content: '' })
        .expect(400);
    });

    it('returns 400 when client attempts to set server-managed fields (id, createdAt, updatedAt)', async () => {
      await testApp
        .request()
        .post('/api/v1/system-prompts')
        .send({
          name: 'Hacker Prompt',
          content: 'You are hacked.',
          id: '018f3a9e-0000-7000-8000-000000000001',
        })
        .expect(400);

      await testApp
        .request()
        .post('/api/v1/system-prompts')
        .send({
          name: 'Hacker Prompt',
          content: 'You are hacked.',
          createdAt: '2020-01-01T00:00:00.000Z',
        })
        .expect(400);

      await testApp
        .request()
        .post('/api/v1/system-prompts')
        .send({
          name: 'Hacker Prompt',
          content: 'You are hacked.',
          updatedAt: '2020-01-01T00:00:00.000Z',
        })
        .expect(400);
    });
  });

  describe('GET /api/v1/system-prompts/:promptId', () => {
    it('returns 200 with the system prompt when it exists', async () => {
      const prompt = testApp.fixtures.createSystemPrompt({
        name: 'Lookup Prompt',
        content: 'Lookup Content',
      });

      const res = await testApp
        .request()
        .get(`/api/v1/system-prompts/${prompt.id}`)
        .expect(200);

      expect(res.body.id).toBe(prompt.id);
      expect(res.body.name).toBe('Lookup Prompt');
      expect(res.body.content).toBe('Lookup Content');
    });

    it('returns 404 when prompt ID is not found', async () => {
      const res = await testApp
        .request()
        .get('/api/v1/system-prompts/018f3a9e-0000-7000-8000-000000000999')
        .expect(404);

      expect(res.body.code).toBe('SYSTEM_PROMPT_NOT_FOUND');
    });
  });

  describe('PATCH /api/v1/system-prompts/:promptId', () => {
    it('updates only name and leaves content intact', async () => {
      const prompt = testApp.fixtures.createSystemPrompt({
        name: 'Initial Name',
        content: 'Content that must not change.',
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
      });

      const res = await testApp
        .request()
        .patch(`/api/v1/system-prompts/${prompt.id}`)
        .send({ name: 'New Name Only' })
        .expect(200);

      expect(res.body.id).toBe(prompt.id);
      expect(res.body.name).toBe('New Name Only');
      expect(res.body.content).toBe('Content that must not change.');
      expect(res.body.createdAt).toBe('2026-09-01T00:00:00.000Z');
      expect(res.body.updatedAt).not.toBe('2026-09-01T00:00:00.000Z');
    });

    it('updates only content and leaves name intact', async () => {
      const prompt = testApp.fixtures.createSystemPrompt({
        name: 'Name that must not change',
        content: 'Initial Content',
      });

      const res = await testApp
        .request()
        .patch(`/api/v1/system-prompts/${prompt.id}`)
        .send({ content: 'New Content Only' })
        .expect(200);

      expect(res.body.id).toBe(prompt.id);
      expect(res.body.name).toBe('Name that must not change');
      expect(res.body.content).toBe('New Content Only');
    });

    it('treats empty update body as an idempotent no-op without bumping updatedAt', async () => {
      const fixedTime = '2026-09-01T00:00:00.000Z';
      const prompt = testApp.fixtures.createSystemPrompt({
        name: 'Stable Prompt',
        content: 'Stable Content',
        created_at: fixedTime,
        updated_at: fixedTime,
      });

      const res = await testApp
        .request()
        .patch(`/api/v1/system-prompts/${prompt.id}`)
        .send({})
        .expect(200);

      expect(res.body.name).toBe('Stable Prompt');
      expect(res.body.content).toBe('Stable Content');
      expect(res.body.updatedAt).toBe(fixedTime);
    });

    it('returns 400 when setting name to null', async () => {
      const prompt = testApp.fixtures.createSystemPrompt();

      await testApp
        .request()
        .patch(`/api/v1/system-prompts/${prompt.id}`)
        .send({ name: null })
        .expect(400);
    });

    it('returns 400 when setting name to empty string', async () => {
      const prompt = testApp.fixtures.createSystemPrompt();

      await testApp
        .request()
        .patch(`/api/v1/system-prompts/${prompt.id}`)
        .send({ name: '' })
        .expect(400);
    });

    it('returns 400 when setting content to null', async () => {
      const prompt = testApp.fixtures.createSystemPrompt();

      await testApp
        .request()
        .patch(`/api/v1/system-prompts/${prompt.id}`)
        .send({ content: null })
        .expect(400);
    });

    it('returns 400 when setting content to empty string', async () => {
      const prompt = testApp.fixtures.createSystemPrompt();

      await testApp
        .request()
        .patch(`/api/v1/system-prompts/${prompt.id}`)
        .send({ content: '' })
        .expect(400);
    });

    it('returns 400 when client attempts to update server-managed fields', async () => {
      const prompt = testApp.fixtures.createSystemPrompt();

      await testApp
        .request()
        .patch(`/api/v1/system-prompts/${prompt.id}`)
        .send({ id: '018f3a9e-0000-7000-8000-000000000999' })
        .expect(400);

      await testApp
        .request()
        .patch(`/api/v1/system-prompts/${prompt.id}`)
        .send({ createdAt: '2020-01-01T00:00:00.000Z' })
        .expect(400);

      await testApp
        .request()
        .patch(`/api/v1/system-prompts/${prompt.id}`)
        .send({ updatedAt: '2020-01-01T00:00:00.000Z' })
        .expect(400);
    });

    it('returns 404 when updating nonexistent prompt ID', async () => {
      await testApp
        .request()
        .patch('/api/v1/system-prompts/018f3a9e-0000-7000-8000-000000000999')
        .send({ name: 'New Name' })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/system-prompts/:promptId', () => {
    it('deletes an existing prompt and returns 204 No Content', async () => {
      const prompt = testApp.fixtures.createSystemPrompt({
        name: 'To Delete',
      });

      await testApp
        .request()
        .delete(`/api/v1/system-prompts/${prompt.id}`)
        .expect(204);

      // Subsequent GET returns 404
      await testApp
        .request()
        .get(`/api/v1/system-prompts/${prompt.id}`)
        .expect(404);
    });

    it('returns 404 when deleting unknown prompt ID', async () => {
      await testApp
        .request()
        .delete('/api/v1/system-prompts/018f3a9e-0000-7000-8000-000000000999')
        .expect(404);
    });

    it('asserts ON DELETE SET NULL on referencing agent: deleting a prompt leaves the agent intact with systemPromptId cleared', async () => {
      // 1. Create a system prompt
      const promptRes = await testApp
        .request()
        .post('/api/v1/system-prompts')
        .send({
          name: 'Coding Persona',
          content: 'You write excellent TypeScript code.',
        })
        .expect(201);
      const promptId = promptRes.body.id;

      // 2. Create an agent referencing this prompt
      const agentRes = await testApp
        .request()
        .post('/api/v1/agents')
        .send({
          name: 'Developer Agent',
          systemPromptId: promptId,
        })
        .expect(201);
      const agentId = agentRes.body.id;
      expect(agentRes.body.systemPromptId).toBe(promptId);

      // 3. Delete the system prompt
      await testApp
        .request()
        .delete(`/api/v1/system-prompts/${promptId}`)
        .expect(204);

      // 4. Verify system prompt is gone
      await testApp
        .request()
        .get(`/api/v1/system-prompts/${promptId}`)
        .expect(404);

      // 5. Verify the referencing agent survives intact with systemPromptId set to null
      const agentAfter = await testApp
        .request()
        .get(`/api/v1/agents/${agentId}`)
        .expect(200);

      expect(agentAfter.body.id).toBe(agentId);
      expect(agentAfter.body.name).toBe('Developer Agent');
      expect(agentAfter.body.systemPromptId).toBeNull();
    });
  });
});
