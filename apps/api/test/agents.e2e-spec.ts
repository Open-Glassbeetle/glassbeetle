import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness/index.js';

describe('Agents endpoints (e2e)', () => {
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

  describe('GET /api/v1/agents', () => {
    it('returns an empty collection with 200 when database has no agents', async () => {
      const response = await testApp
        .request()
        .get('/api/v1/agents')
        .expect(200);

      expect(response.body).toEqual({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      });
    });

    it('returns seeded agents with correct envelope shape and data mappings', async () => {
      const agent = testApp.fixtures.createAgent({
        name: 'Agent Mulder',
        personality: 'Believer in the paranormal',
        instructions: 'Trust no one',
        temperature: 0.8,
        max_tokens: 1024,
        model_params: '{"top_p":0.9}',
        picture_path: 'pictures/mulder.jpg',
      });

      const response = await testApp
        .request()
        .get('/api/v1/agents')
        .expect(200);

      expect(response.body.total).toBe(1);
      expect(response.body.items).toHaveLength(1);

      const item = response.body.items[0];
      expect(item.id).toBe(agent.id);
      expect(item.name).toBe('Agent Mulder');
      expect(item.personality).toBe('Believer in the paranormal');
      expect(item.instructions).toBe('Trust no one');
      expect(item.temperature).toBe(0.8);
      expect(item.maxTokens).toBe(1024);
      expect(item.modelParams).toEqual({ top_p: 0.9 });
      expect(item.hasPicture).toBe(true);
      // picture_path must never leak as a filesystem path
      expect(item.picture_path).toBeUndefined();
      expect(item.picturePath).toBeUndefined();
      expect(typeof item.createdAt).toBe('string');
      expect(typeof item.updatedAt).toBe('string');
    });

    it('filters agents by name substring search', async () => {
      testApp.fixtures.createAgent({ name: 'Special Agent Fox' });
      testApp.fixtures.createAgent({ name: 'Special Agent Dana' });
      testApp.fixtures.createAgent({ name: 'Director Walter' });

      const response = await testApp
        .request()
        .get('/api/v1/agents?name=agent')
        .expect(200);

      expect(response.body.total).toBe(2);
      const names = response.body.items.map((i: any) => i.name);
      expect(names).toContain('Special Agent Fox');
      expect(names).toContain('Special Agent Dana');
    });

    it('filters agents with modelId="null"', async () => {
      const model = testApp.fixtures.createModel();
      testApp.fixtures.createAgent({ name: 'With Model', model_id: model.id });
      const unassigned = testApp.fixtures.createAgent({
        name: 'Without Model',
        model_id: null,
      });

      const response = await testApp
        .request()
        .get('/api/v1/agents?modelId=null')
        .expect(200);

      expect(response.body.total).toBe(1);
      expect(response.body.items[0].id).toBe(unassigned.id);
      expect(response.body.items[0].modelId).toBeNull();
    });

    it('paginates results using limit and offset', async () => {
      for (let i = 1; i <= 5; i++) {
        testApp.fixtures.createAgent({
          name: `Agent ${i}`,
          created_at: `2026-10-01T00:0${i}:00.000Z`,
        });
      }

      const response = await testApp
        .request()
        .get('/api/v1/agents?limit=2&offset=2&sort=name&order=asc')
        .expect(200);

      expect(response.body.total).toBe(5);
      expect(response.body.limit).toBe(2);
      expect(response.body.offset).toBe(2);
      expect(response.body.items).toHaveLength(2);
      expect(response.body.items[0].name).toBe('Agent 3');
      expect(response.body.items[1].name).toBe('Agent 4');
    });

    describe('query parameter validation errors (400)', () => {
      it('returns 400 when sort field is not whitelisted', async () => {
        const response = await testApp
          .request()
          .get('/api/v1/agents?sort=unwhitelisted')
          .expect(400);

        expect(response.body.statusCode).toBe(400);
        expect(response.body.error).toBe('Bad Request');
        expect(response.body.message).toContain('Invalid sort field');
      });

      it('returns 400 when SQL injection is attempted in sort', async () => {
        const response = await testApp
          .request()
          .get('/api/v1/agents?sort=name;DROP%20TABLE%20agents;--')
          .expect(400);

        expect(response.body.statusCode).toBe(400);
      });

      it('returns 400 when limit exceeds 100', async () => {
        const response = await testApp
          .request()
          .get('/api/v1/agents?limit=150')
          .expect(400);

        expect(response.body.statusCode).toBe(400);
      });

      it('returns 400 when limit is less than 1', async () => {
        const response = await testApp
          .request()
          .get('/api/v1/agents?limit=0')
          .expect(400);

        expect(response.body.statusCode).toBe(400);
      });

      it('returns 400 when offset is negative', async () => {
        const response = await testApp
          .request()
          .get('/api/v1/agents?offset=-1')
          .expect(400);

        expect(response.body.statusCode).toBe(400);
      });

      it('returns 400 when order is not asc or desc', async () => {
        const response = await testApp
          .request()
          .get('/api/v1/agents?order=sideways')
          .expect(400);

        expect(response.body.statusCode).toBe(400);
      });

      it('returns 400 when unknown non-whitelisted query params are sent', async () => {
        const response = await testApp
          .request()
          .get('/api/v1/agents?forbiddenParam=foo')
          .expect(400);

        expect(response.body.statusCode).toBe(400);
      });
    });
  });

  describe('GET /api/v1/agents/:agentId', () => {
    it('returns the agent resource for an existing ID with 200 OK', async () => {
      const agent = testApp.fixtures.createAgent({
        name: 'Scully',
        personality: 'Skeptic and medical doctor',
        instructions: 'Apply the scientific method',
        temperature: 0.3,
        max_tokens: 2000,
        model_params: '{"top_p":0.8}',
        picture_path: 'pictures/scully.jpg',
      });

      const response = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}`)
        .expect(200);

      const body = response.body;
      expect(body.id).toBe(agent.id);
      expect(body.name).toBe('Scully');
      expect(body.personality).toBe('Skeptic and medical doctor');
      expect(body.instructions).toBe('Apply the scientific method');
      expect(body.temperature).toBe(0.3);
      expect(body.maxTokens).toBe(2000);
      expect(body.modelParams).toEqual({ top_p: 0.8 });
      expect(body.hasPicture).toBe(true);
      expect(body.picture_path).toBeUndefined();
      expect(body.picturePath).toBeUndefined();
      expect(body.createdAt).toBe(agent.created_at);
      expect(body.updatedAt).toBe(agent.updated_at);
    });

    it('returns 404 with standard error envelope for an unknown agent ID', async () => {
      const unknownId = '018f3a9e-0000-7000-8000-000000000404';

      const response = await testApp
        .request()
        .get(`/api/v1/agents/${unknownId}`)
        .expect(404);

      expect(response.body).toMatchObject({
        statusCode: 404,
        error: 'Not Found',
        code: 'AGENT_NOT_FOUND',
        path: `/api/v1/agents/${unknownId}`,
      });
      expect(response.body.message).toContain(unknownId);
      expect(typeof response.body.timestamp).toBe('string');
    });

    it('safely handles an ID containing SQL metacharacters and returns 404', async () => {
      const injectionAttempt = "nonexistent' OR '1'='1";

      const response = await testApp
        .request()
        .get(`/api/v1/agents/${encodeURIComponent(injectionAttempt)}`)
        .expect(404);

      expect(response.body.statusCode).toBe(404);
      expect(response.body.code).toBe('AGENT_NOT_FOUND');
    });

    it('returns an agent with null modelId and null systemPromptId normally with 200', async () => {
      const agent = testApp.fixtures.createAgent({
        name: 'Detached Agent',
        model_id: null,
        system_prompt_id: null,
      });

      const response = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}`)
        .expect(200);

      expect(response.body.id).toBe(agent.id);
      expect(response.body.modelId).toBeNull();
      expect(response.body.systemPromptId).toBeNull();
    });
  });

  describe('POST /api/v1/agents', () => {
    it('creates an agent with minimal valid payload and sets Location header', async () => {
      const response = await testApp
        .request()
        .post('/api/v1/agents')
        .send({ name: 'Minimal Bot' })
        .expect(201);

      const agent = response.body;
      expect(agent.id).toBeDefined();
      expect(typeof agent.id).toBe('string');
      expect(agent.id).toHaveLength(36);
      expect(agent.name).toBe('Minimal Bot');
      expect(agent.personality).toBeNull();
      expect(agent.instructions).toBeNull();
      expect(agent.systemPromptId).toBeNull();
      expect(agent.modelId).toBeNull();
      expect(agent.temperature).toBeNull();
      expect(agent.maxTokens).toBeNull();
      expect(agent.modelParams).toBeNull();
      expect(agent.hasPicture).toBe(false);
      expect(agent.createdAt).toBeDefined();
      expect(agent.updatedAt).toBeDefined();

      // Verify Location header
      expect(response.headers['location']).toBe(`/api/v1/agents/${agent.id}`);

      // Verify readable via collection endpoint
      const listRes = await testApp
        .request()
        .get('/api/v1/agents')
        .expect(200);

      expect(listRes.body.total).toBe(1);
      expect(listRes.body.items[0].id).toBe(agent.id);

      // Verify readable via single-resource endpoint
      const getRes = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}`)
        .expect(200);
      expect(getRes.body.name).toBe('Minimal Bot');
    });

    it('creates an agent with all optional fields and round-trips modelParams', async () => {
      const model = testApp.fixtures.createModel();
      const prompt = testApp.fixtures.createSystemPrompt();

      const payload = {
        name: 'Full Agent',
        personality: 'Helpful and friendly',
        instructions: 'Speak clearly',
        systemPromptId: prompt.id,
        modelId: model.id,
        temperature: 0.7,
        maxTokens: 2048,
        modelParams: {
          top_p: 0.9,
          stop: ['STOP'],
          context: { level: 2 },
        },
      };

      const response = await testApp
        .request()
        .post('/api/v1/agents')
        .send(payload)
        .expect(201);

      const agent = response.body;
      expect(agent.name).toBe('Full Agent');
      expect(agent.personality).toBe('Helpful and friendly');
      expect(agent.instructions).toBe('Speak clearly');
      expect(agent.systemPromptId).toBe(prompt.id);
      expect(agent.modelId).toBe(model.id);
      expect(agent.temperature).toBe(0.7);
      expect(agent.maxTokens).toBe(2048);
      expect(agent.modelParams).toEqual(payload.modelParams);
      expect(agent.hasPicture).toBe(false);
    });

    it('rejects creation when name is missing with 400 Bad Request', async () => {
      const response = await testApp
        .request()
        .post('/api/v1/agents')
        .send({})
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.error).toBe('Bad Request');
    });

    it('rejects creation when name is empty string with 400 Bad Request', async () => {
      const response = await testApp
        .request()
        .post('/api/v1/agents')
        .send({ name: '' })
        .expect(400);

      expect(response.body.statusCode).toBe(400);
    });

    it('rejects client-supplied server-managed fields with 400 Bad Request', async () => {
      // Trying to supply id
      const resId = await testApp
        .request()
        .post('/api/v1/agents')
        .send({ name: 'Agent', id: '018f3a9e-0000-7000-8000-000000000001' })
        .expect(400);
      expect(resId.body.statusCode).toBe(400);

      // Trying to supply createdAt
      const resCreated = await testApp
        .request()
        .post('/api/v1/agents')
        .send({ name: 'Agent', createdAt: '2026-10-04T00:00:00.000Z' })
        .expect(400);
      expect(resCreated.body.statusCode).toBe(400);

      // Trying to supply picturePath
      const resPicture = await testApp
        .request()
        .post('/api/v1/agents')
        .send({ name: 'Agent', picturePath: 'pictures/avatar.png' })
        .expect(400);
      expect(resPicture.body.statusCode).toBe(400);
    });

    it('rejects non-existent modelId with 422 Unprocessable Entity', async () => {
      const badModelId = '018f3a9e-0000-7000-8000-999999999999';
      const response = await testApp
        .request()
        .post('/api/v1/agents')
        .send({ name: 'Agent', modelId: badModelId })
        .expect(422);

      expect(response.body.statusCode).toBe(422);
      expect(response.body.code).toBe('MODEL_NOT_FOUND');
      expect(response.body.message).toContain(badModelId);
    });

    it('rejects non-existent systemPromptId with 422 Unprocessable Entity', async () => {
      const badPromptId = '018f3a9e-0000-7000-8000-888888888888';
      const response = await testApp
        .request()
        .post('/api/v1/agents')
        .send({ name: 'Agent', systemPromptId: badPromptId })
        .expect(422);

      expect(response.body.statusCode).toBe(422);
      expect(response.body.code).toBe('SYSTEM_PROMPT_NOT_FOUND');
      expect(response.body.message).toContain(badPromptId);
    });
  });
});
