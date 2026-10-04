import { tmpdir } from 'node:os';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveDefaultDataDir } from '../src/config/data-dir.js';
import { FileStorageService } from '../src/file-storage/file-storage.service.js';
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

  describe('Test isolation & database safety assertions', () => {
    it('asserts foreign-key enforcement is enabled in the test SQLite database (PRAGMA foreign_keys = ON)', () => {
      // Foreign-key enforcement must be active, otherwise ON DELETE CASCADE/SET NULL tests pass vacuously
      const result = testApp.db.get<{ foreign_keys: number }>(
        'PRAGMA foreign_keys',
      );
      expect(result?.foreign_keys).toBe(1);
    });

    it('asserts test database runs in an isolated temporary location and never touches user data directory', () => {
      // Safety constraint: test runs must never touch or mutate the user's real data directory
      const dbPath = (testApp.db as any).dbInstance?.name;
      expect(dbPath).toContain(tmpdir());
      expect(dbPath).not.toContain(resolveDefaultDataDir());
    });

    it('rejects foreign-key violations at the database layer directly', () => {
      expect(() => {
        testApp.db.run(
          'INSERT INTO agents (id, name, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          [
            '018f3a9e-0000-7000-8000-000000000999',
            'Invalid FK Agent',
            '018f3a9e-0000-7000-8000-nonexistent01',
            '2026-10-04T00:00:00.000Z',
            '2026-10-04T00:00:00.000Z',
          ],
        );
      }).toThrow(/FOREIGN KEY/);
    });
  });

  describe('Full Agent Lifecycle & Cross-Endpoint Consistency', () => {
    it('covers create -> read -> list -> update -> delete and asserts representation is identical across create, list, and get', async () => {
      const provider = testApp.fixtures.createProvider();
      const model = testApp.fixtures.createModel({ provider_id: provider.id });
      const prompt = testApp.fixtures.createSystemPrompt();

      const createPayload = {
        name: 'Lifecycle Assistant',
        personality: 'Methodical and inquisitive',
        instructions: 'Always cite sources in IEEE style',
        systemPromptId: prompt.id,
        modelId: model.id,
        temperature: 0.65,
        maxTokens: 4096,
        modelParams: {
          top_p: 0.9,
          frequency_penalty: 0.5,
          custom_tags: ['research', 'v1'],
        },
      };

      // 1. CREATE
      const createRes = await testApp
        .request()
        .post('/api/v1/agents')
        .send(createPayload)
        .expect(201);

      const created = createRes.body;
      expect(createRes.headers.location).toBe(`/api/v1/agents/${created.id}`);
      expect(created.id).toBeDefined();
      expect(created.name).toBe(createPayload.name);
      expect(created.personality).toBe(createPayload.personality);
      expect(created.instructions).toBe(createPayload.instructions);
      expect(created.systemPromptId).toBe(prompt.id);
      expect(created.modelId).toBe(model.id);
      expect(created.temperature).toBe(0.65);
      expect(created.maxTokens).toBe(4096);
      expect(created.modelParams).toEqual(createPayload.modelParams);
      expect(created.hasPicture).toBe(false);
      expect(created.picture_path).toBeUndefined();
      expect(typeof created.createdAt).toBe('string');
      expect(typeof created.updatedAt).toBe('string');

      // 2. GET (Single-resource read)
      const getRes = await testApp
        .request()
        .get(`/api/v1/agents/${created.id}`)
        .expect(200);

      const fetched = getRes.body;
      // Representation must be IDENTICAL between create and get
      expect(fetched).toEqual(created);

      // 3. LIST (Collection read)
      const listRes = await testApp
        .request()
        .get('/api/v1/agents')
        .expect(200);

      expect(listRes.body.total).toBe(1);
      const listed = listRes.body.items.find((item: any) => item.id === created.id);
      expect(listed).toBeDefined();
      // Representation must be IDENTICAL across create, get, and list
      expect(listed).toEqual(created);

      // 4. UPDATE (Partial update via PATCH)
      const updatePayload = {
        name: 'Updated Lifecycle Assistant',
        temperature: 0.1,
      };

      const patchRes = await testApp
        .request()
        .patch(`/api/v1/agents/${created.id}`)
        .send(updatePayload)
        .expect(200);

      const updated = patchRes.body;
      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe('Updated Lifecycle Assistant');
      expect(updated.temperature).toBe(0.1);
      expect(updated.personality).toBe(created.personality);
      expect(updated.instructions).toBe(created.instructions);
      expect(updated.systemPromptId).toBe(created.systemPromptId);
      expect(updated.modelId).toBe(created.modelId);
      expect(updated.maxTokens).toBe(created.maxTokens);
      expect(updated.modelParams).toEqual(created.modelParams);
      expect(updated.hasPicture).toBe(created.hasPicture);
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.updatedAt).not.toBe(created.updatedAt);

      // Verify GET reflects the updated representation identically
      const getAfterUpdate = await testApp
        .request()
        .get(`/api/v1/agents/${created.id}`)
        .expect(200);
      expect(getAfterUpdate.body).toEqual(updated);

      // 5. DELETE
      await testApp
        .request()
        .delete(`/api/v1/agents/${created.id}`)
        .expect(204);

      // 6. CONFIRM GONE
      await testApp
        .request()
        .get(`/api/v1/agents/${created.id}`)
        .expect(404);

      const listAfterDelete = await testApp
        .request()
        .get('/api/v1/agents')
        .expect(200);
      expect(listAfterDelete.body.total).toBe(0);
      expect(listAfterDelete.body.items).toHaveLength(0);
    });
  });

  describe('Referential integrity & ON DELETE SET NULL on referenced models and prompts', () => {
    it('survives deletion of referenced system prompt with systemPromptId set to null', async () => {
      const prompt = testApp.fixtures.createSystemPrompt({
        name: 'Referenced Prompt',
      });
      const agent = testApp.fixtures.createAgent({
        name: 'Prompt Consumer',
        system_prompt_id: prompt.id,
      });

      // Confirm initial state
      const beforeRes = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}`)
        .expect(200);
      expect(beforeRes.body.systemPromptId).toBe(prompt.id);

      // Delete the referenced system prompt
      testApp.db.run('DELETE FROM system_prompts WHERE id = ?', [prompt.id]);

      // Agent survives and systemPromptId is now null
      const afterRes = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}`)
        .expect(200);
      expect(afterRes.body.id).toBe(agent.id);
      expect(afterRes.body.systemPromptId).toBeNull();
    });

    it('survives deletion of referenced model with modelId set to null', async () => {
      const provider = testApp.fixtures.createProvider();
      const model = testApp.fixtures.createModel({
        provider_id: provider.id,
        name: 'Referenced Model',
      });
      const agent = testApp.fixtures.createAgent({
        name: 'Model Consumer',
        model_id: model.id,
      });

      // Confirm initial state
      const beforeRes = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}`)
        .expect(200);
      expect(beforeRes.body.modelId).toBe(model.id);

      // Delete the referenced model
      testApp.db.run('DELETE FROM models WHERE id = ?', [model.id]);

      // Agent survives and modelId is now null
      const afterRes = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}`)
        .expect(200);
      expect(afterRes.body.id).toBe(agent.id);
      expect(afterRes.body.modelId).toBeNull();
    });

    it('survives deletion of provider (cascading to model, which sets agent modelId to null)', async () => {
      const provider = testApp.fixtures.createProvider({ name: 'Root Provider' });
      const model = testApp.fixtures.createModel({ provider_id: provider.id });
      const agent = testApp.fixtures.createAgent({ model_id: model.id });

      // Deleting provider triggers ON DELETE CASCADE on models, which triggers ON DELETE SET NULL on agents
      testApp.db.run('DELETE FROM providers WHERE id = ?', [provider.id]);

      const afterRes = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}`)
        .expect(200);
      expect(afterRes.body.id).toBe(agent.id);
      expect(afterRes.body.modelId).toBeNull();
    });
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

  describe('PATCH /api/v1/agents/:agentId', () => {
    it('updates a single field on a fully-populated agent and preserves every other field', async () => {
      const model = testApp.fixtures.createModel();
      const prompt = testApp.fixtures.createSystemPrompt();

      const initialTime = '2026-10-01T00:00:00.000Z';
      const agent = testApp.fixtures.createAgent({
        name: 'Initial Agent',
        personality: 'Friendly and witty',
        instructions: 'Answer in bullet points',
        system_prompt_id: prompt.id,
        model_id: model.id,
        temperature: 0.7,
        max_tokens: 1500,
        model_params: '{"top_p":0.95,"stop":["EXIT"]}',
        picture_path: 'pictures/agent.jpg',
        created_at: initialTime,
        updated_at: initialTime,
      });

      const response = await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}`)
        .send({ name: 'Updated Agent Name' })
        .expect(200);

      expect(response.body.id).toBe(agent.id);
      expect(response.body.name).toBe('Updated Agent Name');
      expect(response.body.personality).toBe('Friendly and witty');
      expect(response.body.instructions).toBe('Answer in bullet points');
      expect(response.body.systemPromptId).toBe(prompt.id);
      expect(response.body.modelId).toBe(model.id);
      expect(response.body.temperature).toBe(0.7);
      expect(response.body.maxTokens).toBe(1500);
      expect(response.body.modelParams).toEqual({
        top_p: 0.95,
        stop: ['EXIT'],
      });
      expect(response.body.hasPicture).toBe(true);
      expect(response.body.picturePath).toBeUndefined();
      expect(response.body.createdAt).toBe(initialTime);
      expect(response.body.updatedAt).not.toBe(initialTime);
      expect(new Date(response.body.updatedAt).getTime()).toBeGreaterThan(
        new Date(initialTime).getTime(),
      );

      // Verify GET returns the exact same persisted state
      const getRes = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}`)
        .expect(200);
      expect(getRes.body).toEqual(response.body);
    });

    it('clears nullable fields when set to null and preserves omitted fields', async () => {
      const model = testApp.fixtures.createModel();
      const prompt = testApp.fixtures.createSystemPrompt();

      const agent = testApp.fixtures.createAgent({
        name: 'Stable Name',
        personality: 'Will be cleared',
        instructions: 'Will be cleared',
        system_prompt_id: prompt.id,
        model_id: model.id,
        temperature: 0.8,
        max_tokens: 2000,
        model_params: '{"seed":42}',
      });

      const response = await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}`)
        .send({
          personality: null,
          instructions: null,
          systemPromptId: null,
          modelId: null,
          temperature: null,
          maxTokens: null,
          modelParams: null,
        })
        .expect(200);

      expect(response.body.name).toBe('Stable Name');
      expect(response.body.personality).toBeNull();
      expect(response.body.instructions).toBeNull();
      expect(response.body.systemPromptId).toBeNull();
      expect(response.body.modelId).toBeNull();
      expect(response.body.temperature).toBeNull();
      expect(response.body.maxTokens).toBeNull();
      expect(response.body.modelParams).toBeNull();
    });

    it('supports clearing only modelId (leaving agent detached from model)', async () => {
      const model = testApp.fixtures.createModel();
      const agent = testApp.fixtures.createAgent({
        name: 'Detached Agent',
        model_id: model.id,
      });

      const response = await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}`)
        .send({ modelId: null })
        .expect(200);

      expect(response.body.modelId).toBeNull();
    });

    it('handles empty body as an idempotent no-op without bumping updatedAt', async () => {
      const fixedTime = '2026-10-02T05:00:00.000Z';
      const agent = testApp.fixtures.createAgent({
        name: 'Untouched Agent',
        created_at: fixedTime,
        updated_at: fixedTime,
      });

      const response = await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}`)
        .send({})
        .expect(200);

      expect(response.body.id).toBe(agent.id);
      expect(response.body.name).toBe('Untouched Agent');
      expect(response.body.updatedAt).toBe(fixedTime);
    });

    it('returns 404 Not Found for non-existent agentId', async () => {
      const nonExistentId = '018f3a9e-0000-7000-8000-999999999999';

      const response = await testApp
        .request()
        .patch(`/api/v1/agents/${nonExistentId}`)
        .send({ name: 'Will Fail' })
        .expect(404);

      expect(response.body.statusCode).toBe(404);
      expect(response.body.code).toBe('AGENT_NOT_FOUND');
    });

    it('returns 404 Not Found for non-existent agentId even with empty body', async () => {
      const nonExistentId = '018f3a9e-0000-7000-8000-999999999999';

      const response = await testApp
        .request()
        .patch(`/api/v1/agents/${nonExistentId}`)
        .send({})
        .expect(404);

      expect(response.body.statusCode).toBe(404);
      expect(response.body.code).toBe('AGENT_NOT_FOUND');
    });

    it('rejects client-supplied server-managed and forbidden fields with 400 Bad Request', async () => {
      const agent = testApp.fixtures.createAgent();

      // id is forbidden
      await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}`)
        .send({ id: '018f3a9e-0000-7000-8000-000000000999' })
        .expect(400);

      // createdAt is forbidden
      await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}`)
        .send({ createdAt: '2026-10-04T00:00:00.000Z' })
        .expect(400);

      // updatedAt is forbidden
      await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}`)
        .send({ updatedAt: '2026-10-04T00:00:00.000Z' })
        .expect(400);

      // picture is forbidden
      await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}`)
        .send({ picture: 'data:image/png;base64,...' })
        .expect(400);

      // picturePath is forbidden
      await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}`)
        .send({ picturePath: 'pictures/hacked.png' })
        .expect(400);
    });

    it('rejects invalid field values with 400 Bad Request', async () => {
      const agent = testApp.fixtures.createAgent();

      // name cannot be empty string
      await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}`)
        .send({ name: '' })
        .expect(400);

      // name cannot be null
      await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}`)
        .send({ name: null })
        .expect(400);

      // temperature out of range
      await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}`)
        .send({ temperature: 3.5 })
        .expect(400);

      // maxTokens out of range
      await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}`)
        .send({ maxTokens: 0 })
        .expect(400);

      // modelParams must be object
      await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}`)
        .send({ modelParams: 'invalid-string' })
        .expect(400);
    });

    it('rejects non-existent modelId with 422 Unprocessable Entity', async () => {
      const agent = testApp.fixtures.createAgent();
      const badModelId = '018f3a9e-0000-7000-8000-999999999999';

      const response = await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}`)
        .send({ modelId: badModelId })
        .expect(422);

      expect(response.body.statusCode).toBe(422);
      expect(response.body.code).toBe('MODEL_NOT_FOUND');
      expect(response.body.message).toContain(badModelId);
    });

    it('rejects non-existent systemPromptId with 422 Unprocessable Entity', async () => {
      const agent = testApp.fixtures.createAgent();
      const badPromptId = '018f3a9e-0000-7000-8000-888888888888';

      const response = await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}`)
        .send({ systemPromptId: badPromptId })
        .expect(422);

      expect(response.body.statusCode).toBe(422);
      expect(response.body.code).toBe('SYSTEM_PROMPT_NOT_FOUND');
      expect(response.body.message).toContain(badPromptId);
    });
  });

  describe('DELETE /api/v1/agents/:agentId', () => {
    it('removes the agent and returns 204 No Content', async () => {
      const agent = testApp.fixtures.createAgent({ name: 'To Be Deleted' });

      await testApp
        .request()
        .delete(`/api/v1/agents/${agent.id}`)
        .expect(204);

      // Verify agent is gone from DB via GET endpoint
      await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}`)
        .expect(404);
    });

    it('returns 404 Not Found for non-existent agentId', async () => {
      const nonExistentId = '018f3a9e-0000-7000-8000-999999999999';

      const response = await testApp
        .request()
        .delete(`/api/v1/agents/${nonExistentId}`)
        .expect(404);

      expect(response.body.statusCode).toBe(404);
      expect(response.body.code).toBe('AGENT_NOT_FOUND');
    });

    it('cascades across referencing tables (memories, team_members, messages, artifacts, usage_events)', async () => {
      const agent = testApp.fixtures.createAgent({ name: 'Cascaded Agent' });

      const memory = testApp.fixtures.createAgentMemory({
        agent_id: agent.id,
        content: 'Agent secret',
      });
      const team = testApp.fixtures.createTeam();
      testApp.fixtures.createTeamMember(team.id, agent.id);

      const teamChat = testApp.fixtures.createChat({ team_id: team.id });
      const message = testApp.fixtures.createMessage({
        chat_id: teamChat.id,
        agent_id: agent.id,
      });
      const artifact = testApp.fixtures.createArtifact({
        agent_id: agent.id,
      });
      const event = testApp.fixtures.createUsageEvent({
        agent_id: agent.id,
      });

      await testApp
        .request()
        .delete(`/api/v1/agents/${agent.id}`)
        .expect(204);

      // 1. agent_memories: deleted (CASCADE)
      const memoryRow = testApp.db.get(
        'SELECT * FROM agent_memories WHERE id = ?',
        [memory.id],
      );
      expect(memoryRow).toBeUndefined();

      // 2. team_members: deleted (CASCADE)
      const memberRow = testApp.db.get(
        'SELECT * FROM team_members WHERE team_id = ? AND agent_id = ?',
        [team.id, agent.id],
      );
      expect(memberRow).toBeUndefined();

      // 3. messages: agent_id set to null (SET NULL)
      const msgRow = testApp.db.get<{ agent_id: string | null }>(
        'SELECT agent_id FROM messages WHERE id = ?',
        [message.id],
      );
      expect(msgRow).toBeDefined();
      expect(msgRow?.agent_id).toBeNull();

      // 4. artifacts: agent_id set to null (SET NULL)
      const artRow = testApp.db.get<{ agent_id: string | null }>(
        'SELECT agent_id FROM artifacts WHERE id = ?',
        [artifact.id],
      );
      expect(artRow).toBeDefined();
      expect(artRow?.agent_id).toBeNull();

      // 5. usage_events: agent_id set to null (SET NULL)
      const evRow = testApp.db.get<{ agent_id: string | null }>(
        'SELECT agent_id FROM usage_events WHERE id = ?',
        [event.id],
      );
      expect(evRow).toBeDefined();
      expect(evRow?.agent_id).toBeNull();
    });

    it('unlinks the agent picture file from storage on deletion', async () => {
      const fileStorage = testApp.app.get(FileStorageService);
      // Write sample picture file to pictures bucket
      const stored = await fileStorage.write(
        'pictures',
        Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]), // JPEG header
      );

      const agent = testApp.fixtures.createAgent({
        name: 'Picture Agent',
        picture_path: stored.reference,
      });

      expect(await fileStorage.exists(stored.reference)).toBe(true);

      await testApp
        .request()
        .delete(`/api/v1/agents/${agent.id}`)
        .expect(204);

      // Verify picture file was deleted from disk
      expect(await fileStorage.exists(stored.reference)).toBe(false);
    });

    it('documents agent-owned chat behavior: deleting agent fails due to chats table CHECK constraint conflict', async () => {
      const agent = testApp.fixtures.createAgent({ name: 'Chat Owner Agent' });
      testApp.fixtures.createChat({ agent_id: agent.id });

      // When deleting an agent owning chats, SQLite triggers ON DELETE SET NULL on chats.agent_id,
      // which results in both agent_id and team_id being NULL, violating:
      // CHECK ((agent_id IS NOT NULL AND team_id IS NULL) OR (agent_id IS NULL AND team_id IS NOT NULL))
      await testApp
        .request()
        .delete(`/api/v1/agents/${agent.id}`)
        .expect(500);

      // Assert agent is still present in database
      const getRes = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}`)
        .expect(200);
      expect(getRes.body.id).toBe(agent.id);
    });
  });

  describe('PUT /api/v1/agents/:agentId/picture', () => {
    const validPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
    ]);

    const validJpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
    ]);

    it('uploads a valid picture, stores file in storage, updates database row, and returns 200 OK', async () => {
      const fileStorage = testApp.app.get(FileStorageService);
      const agent = testApp.fixtures.createAgent({
        name: 'Picture Upload Agent',
        created_at: '2026-10-04T10:00:00.000Z',
        updated_at: '2026-10-04T10:00:00.000Z',
      });

      const response = await testApp
        .request()
        .put(`/api/v1/agents/${agent.id}/picture`)
        .attach('file', validPng, 'avatar.png')
        .expect(200);

      // Verify response envelope
      expect(response.body.id).toBe(agent.id);
      expect(response.body.hasPicture).toBe(true);
      expect(response.body.name).toBe('Picture Upload Agent');
      expect(response.body.picture_path).toBeUndefined();
      expect(response.body.updatedAt).not.toBe('2026-10-04T10:00:00.000Z');

      // Verify database row
      const dbRow = testApp.db.get<{ picture_path: string; updated_at: string }>(
        'SELECT picture_path, updated_at FROM agents WHERE id = ?',
        [agent.id],
      );
      expect(dbRow?.picture_path).toMatch(/^pictures\/.*\.png$/);
      expect(await fileStorage.exists(dbRow!.picture_path)).toBe(true);

      // Verify stored bytes
      const fileBytes = await fileStorage.read(dbRow!.picture_path);
      expect(fileBytes).toEqual(validPng);
    });

    it('accepts upload with field name "picture" in addition to "file"', async () => {
      const agent = testApp.fixtures.createAgent({ name: 'Alternative Field Agent' });

      const response = await testApp
        .request()
        .put(`/api/v1/agents/${agent.id}/picture`)
        .attach('picture', validJpeg, 'photo.jpg')
        .expect(200);

      expect(response.body.id).toBe(agent.id);
      expect(response.body.hasPicture).toBe(true);
    });

    it('replaces an existing picture, writes the new file and deletes the old file from storage', async () => {
      const fileStorage = testApp.app.get(FileStorageService);
      const agent = testApp.fixtures.createAgent({ name: 'Replace Agent' });

      // First upload
      await testApp
        .request()
        .put(`/api/v1/agents/${agent.id}/picture`)
        .attach('file', validPng, 'first.png')
        .expect(200);

      const firstRow = testApp.db.get<{ picture_path: string }>(
        'SELECT picture_path FROM agents WHERE id = ?',
        [agent.id],
      );
      const firstPath = firstRow!.picture_path;
      expect(await fileStorage.exists(firstPath)).toBe(true);

      // Second upload (replacement)
      const secondResponse = await testApp
        .request()
        .put(`/api/v1/agents/${agent.id}/picture`)
        .attach('file', validJpeg, 'second.jpg')
        .expect(200);

      expect(secondResponse.body.hasPicture).toBe(true);

      const secondRow = testApp.db.get<{ picture_path: string }>(
        'SELECT picture_path FROM agents WHERE id = ?',
        [agent.id],
      );
      const secondPath = secondRow!.picture_path;

      // Old file must be gone
      expect(await fileStorage.exists(firstPath)).toBe(false);
      // New file must exist
      expect(await fileStorage.exists(secondPath)).toBe(true);
      expect(secondPath).not.toBe(firstPath);
    });

    it('rejects a non-image file disguised as image (magic bytes sniffing) with 400', async () => {
      const fileStorage = testApp.app.get(FileStorageService);
      const agent = testApp.fixtures.createAgent({ name: 'Spoofed Agent' });

      const textBuffer = Buffer.from('Just some plain text pretending to be PNG');

      const response = await testApp
        .request()
        .put(`/api/v1/agents/${agent.id}/picture`)
        .attach('file', textBuffer, 'innocent.png')
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');

      // Database row untouched
      const dbRow = testApp.db.get<{ picture_path: string | null }>(
        'SELECT picture_path FROM agents WHERE id = ?',
        [agent.id],
      );
      expect(dbRow?.picture_path).toBeNull();
    });

    it('rejects an SVG file due to stored-XSS concern with 400', async () => {
      const agent = testApp.fixtures.createAgent({ name: 'SVG Agent' });

      const svgBuffer = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      );

      const response = await testApp
        .request()
        .put(`/api/v1/agents/${agent.id}/picture`)
        .attach('file', svgBuffer, 'image.svg')
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('rejects a file exceeding the maximum size limit with 413 Payload Too Large', async () => {
      const agent = testApp.fixtures.createAgent({ name: 'Big File Agent' });

      // 5 MB + 1024 bytes (exceeds default 5 MB limit)
      const hugeBuffer = Buffer.alloc(5 * 1024 * 1024 + 1024);
      validPng.copy(hugeBuffer, 0, 0, validPng.length);

      const response = await testApp
        .request()
        .put(`/api/v1/agents/${agent.id}/picture`)
        .attach('file', hugeBuffer, 'huge.png')
        .expect(413);

      expect(response.body.statusCode).toBe(413);
      expect(response.body.code).toBe('FILE_TOO_LARGE');
    });

    it('rejects request with no file attached with 400 Bad Request', async () => {
      const agent = testApp.fixtures.createAgent({ name: 'No File Agent' });

      const response = await testApp
        .request()
        .put(`/api/v1/agents/${agent.id}/picture`)
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.code).toBe('MISSING_FILE');
    });

    it('stores file using server-generated UUIDv7 even if client filename has directory traversal ../', async () => {
      const fileStorage = testApp.app.get(FileStorageService);
      const agent = testApp.fixtures.createAgent({ name: 'Traversal Agent' });

      await testApp
        .request()
        .put(`/api/v1/agents/${agent.id}/picture`)
        .attach('file', validPng, '../../../../../../etc/shadow.png')
        .expect(200);

      const dbRow = testApp.db.get<{ picture_path: string }>(
        'SELECT picture_path FROM agents WHERE id = ?',
        [agent.id],
      );
      expect(dbRow?.picture_path).toMatch(/^pictures\/[0-9a-f-]+\.png$/);
      expect(await fileStorage.exists(dbRow!.picture_path)).toBe(true);
    });

    it('returns 404 Not Found for non-existent agent ID on upload', async () => {
      const nonExistentId = '018f3a9e-0000-7000-8000-999999999999';

      const response = await testApp
        .request()
        .put(`/api/v1/agents/${nonExistentId}/picture`)
        .attach('file', validPng, 'avatar.png')
        .expect(404);

      expect(response.body.statusCode).toBe(404);
      expect(response.body.code).toBe('AGENT_NOT_FOUND');
    });
  });

  describe('DELETE /api/v1/agents/:agentId/picture', () => {
    const validPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);

    it('removes the picture, unlinks the file from storage, sets picture_path to NULL and refreshes updated_at', async () => {
      const fileStorage = testApp.app.get(FileStorageService);
      const agent = testApp.fixtures.createAgent({
        name: 'Delete Picture Agent',
        created_at: '2026-10-04T10:00:00.000Z',
        updated_at: '2026-10-04T10:00:00.000Z',
      });

      // Upload first
      await testApp
        .request()
        .put(`/api/v1/agents/${agent.id}/picture`)
        .attach('file', validPng, 'avatar.png')
        .expect(200);

      const storedRow = testApp.db.get<{ picture_path: string }>(
        'SELECT picture_path FROM agents WHERE id = ?',
        [agent.id],
      );
      const filePath = storedRow!.picture_path;
      expect(await fileStorage.exists(filePath)).toBe(true);

      // Now remove the picture
      await testApp
        .request()
        .delete(`/api/v1/agents/${agent.id}/picture`)
        .expect(204);

      // File must be deleted from storage
      expect(await fileStorage.exists(filePath)).toBe(false);

      // Database row must have NULL picture_path
      const dbRow = testApp.db.get<{ picture_path: string | null; updated_at: string }>(
        'SELECT picture_path, updated_at FROM agents WHERE id = ?',
        [agent.id],
      );
      expect(dbRow?.picture_path).toBeNull();
      expect(dbRow?.updated_at).not.toBe('2026-10-04T10:00:00.000Z');

      // GET /api/v1/agents/:id confirms hasPicture is false
      const getRes = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}`)
        .expect(200);
      expect(getRes.body.hasPicture).toBe(false);
    });

    it('is idempotent: removing a picture from an agent that has none returns 204 No Content', async () => {
      const agent = testApp.fixtures.createAgent({
        name: 'Agent Without Picture',
        picture_path: null,
      });

      // First removal: returns 204
      await testApp
        .request()
        .delete(`/api/v1/agents/${agent.id}/picture`)
        .expect(204);

      // Second removal: also returns 204 (idempotent)
      await testApp
        .request()
        .delete(`/api/v1/agents/${agent.id}/picture`)
        .expect(204);

      // Row still has null picture_path
      const dbRow = testApp.db.get<{ picture_path: string | null }>(
        'SELECT picture_path FROM agents WHERE id = ?',
        [agent.id],
      );
      expect(dbRow?.picture_path).toBeNull();
    });

    it('returns 404 Not Found for non-existent agent ID on picture removal', async () => {
      const nonExistentId = '018f3a9e-0000-7000-8000-999999999999';

      const response = await testApp
        .request()
        .delete(`/api/v1/agents/${nonExistentId}/picture`)
        .expect(404);

      expect(response.body.statusCode).toBe(404);
      expect(response.body.code).toBe('AGENT_NOT_FOUND');
    });
  });

  describe('Field round-tripping for every column in data/agents/agents.sql', () => {
    it('creates an agent with every optional field and verifies exact database persistence and API read round-trip', async () => {
      const provider = testApp.fixtures.createProvider();
      const model = testApp.fixtures.createModel({ provider_id: provider.id });
      const prompt = testApp.fixtures.createSystemPrompt();

      const complexModelParams = {
        top_p: 0.95,
        frequency_penalty: 0.25,
        presence_penalty: 0.5,
        stop: ['\n\nUser:', '<|end|>'],
        nested: {
          profile: {
            deepKey: 'deepValue',
            numerical: 1337,
          },
        },
      };

      const payload = {
        name: 'Full Roundtrip Agent',
        personality: 'Analytical, formal, and precise',
        instructions: 'Write answers adhering to RFC specifications.',
        systemPromptId: prompt.id,
        modelId: model.id,
        temperature: 0.35,
        maxTokens: 8192,
        modelParams: complexModelParams,
      };

      const createRes = await testApp
        .request()
        .post('/api/v1/agents')
        .send(payload)
        .expect(201);

      const agentId = createRes.body.id;

      // 1. Verify GET /api/v1/agents/:id round-trip
      const getRes = await testApp
        .request()
        .get(`/api/v1/agents/${agentId}`)
        .expect(200);

      expect(getRes.body.id).toBe(agentId);
      expect(getRes.body.name).toBe(payload.name);
      expect(getRes.body.personality).toBe(payload.personality);
      expect(getRes.body.instructions).toBe(payload.instructions);
      expect(getRes.body.systemPromptId).toBe(prompt.id);
      expect(getRes.body.modelId).toBe(model.id);
      expect(getRes.body.temperature).toBe(0.35);
      expect(getRes.body.maxTokens).toBe(8192);
      expect(getRes.body.modelParams).toEqual(complexModelParams);
      expect(getRes.body.hasPicture).toBe(false);
      expect(getRes.body.picture_path).toBeUndefined();

      // 2. Verify raw SQLite database columns in data/agents/agents.sql
      const row = testApp.db.get<{
        id: string;
        name: string;
        personality: string;
        instructions: string;
        system_prompt_id: string;
        model_id: string;
        temperature: number;
        max_tokens: number;
        model_params: string;
        picture_path: string | null;
        created_at: string;
        updated_at: string;
      }>('SELECT * FROM agents WHERE id = ?', [agentId]);

      expect(row).toBeDefined();
      expect(row?.id).toBe(agentId);
      expect(row?.name).toBe(payload.name);
      expect(row?.personality).toBe(payload.personality);
      expect(row?.instructions).toBe(payload.instructions);
      expect(row?.system_prompt_id).toBe(prompt.id);
      expect(row?.model_id).toBe(model.id);
      expect(row?.temperature).toBe(0.35);
      expect(row?.max_tokens).toBe(8192);
      expect(JSON.parse(row!.model_params)).toEqual(complexModelParams);
      expect(row?.picture_path).toBeNull();
      expect(row?.created_at).toBe(getRes.body.createdAt);
      expect(row?.updated_at).toBe(getRes.body.updatedAt);
    });
  });

  describe('Not-Found (404) paths across all endpoints accepting :agentId', () => {
    const nonExistentId = '018f3a9e-0000-7000-8000-999999999999';
    const validPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);

    it('GET /api/v1/agents/:agentId returns 404 for unknown agent ID', async () => {
      const res = await testApp
        .request()
        .get(`/api/v1/agents/${nonExistentId}`)
        .expect(404);
      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('AGENT_NOT_FOUND');
    });

    it('PATCH /api/v1/agents/:agentId returns 404 for unknown agent ID', async () => {
      const res = await testApp
        .request()
        .patch(`/api/v1/agents/${nonExistentId}`)
        .send({ name: 'Will Not Update' })
        .expect(404);
      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('AGENT_NOT_FOUND');
    });

    it('DELETE /api/v1/agents/:agentId returns 404 for unknown agent ID', async () => {
      const res = await testApp
        .request()
        .delete(`/api/v1/agents/${nonExistentId}`)
        .expect(404);
      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('AGENT_NOT_FOUND');
    });

    it('PUT /api/v1/agents/:agentId/picture returns 404 for unknown agent ID', async () => {
      const res = await testApp
        .request()
        .put(`/api/v1/agents/${nonExistentId}/picture`)
        .attach('file', validPng, 'pic.png')
        .expect(404);
      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('AGENT_NOT_FOUND');
    });

    it('DELETE /api/v1/agents/:agentId/picture returns 404 for unknown agent ID', async () => {
      const res = await testApp
        .request()
        .delete(`/api/v1/agents/${nonExistentId}/picture`)
        .expect(404);
      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('AGENT_NOT_FOUND');
    });
  });
});


