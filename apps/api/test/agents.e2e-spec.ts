import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
});


