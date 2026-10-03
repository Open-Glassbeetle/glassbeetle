import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness/index.js';

describe('Agents collection endpoint (e2e)', () => {
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
});
