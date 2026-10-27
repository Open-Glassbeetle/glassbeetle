import http from 'node:http';
import https from 'node:https';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from './harness/index.js';

describe('Global models endpoints (e2e)', () => {
  let testApp: TestApp;
  let httpRequestSpy: ReturnType<typeof vi.spyOn>;
  let httpsRequestSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    testApp = await createTestApp();
    httpRequestSpy = vi.spyOn(http, 'request');
    httpsRequestSpy = vi.spyOn(https, 'request');
  });

  afterAll(async () => {
    httpRequestSpy.mockRestore();
    httpsRequestSpy.mockRestore();
    await testApp.close();
  });

  beforeEach(() => {
    testApp.reset();
    httpRequestSpy.mockClear();
    httpsRequestSpy.mockClear();
  });

  const unknownModelId = '018f3a9e-0000-7000-8000-000000000000';

  // 1. GET /api/v1/models
  describe('GET /api/v1/models', () => {
    it('returns an empty paginated collection when no models exist', async () => {
      const res = await testApp
        .request()
        .get('/api/v1/models')
        .expect(200);

      expect(res.body).toEqual({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      });
    });

    it('returns models across all providers with provider summaries embedded', async () => {
      const p1 = testApp.fixtures.createProvider({
        name: 'Anthropic',
        kind: 'anthropic',
      });
      const p2 = testApp.fixtures.createProvider({
        name: 'OpenAI',
        kind: 'openai',
      });

      const m1 = testApp.fixtures.createModel({
        provider_id: p1.id,
        model_identifier: 'claude-3-5-sonnet',
        display_name: 'Claude 3.5 Sonnet',
        source: 'manual',
        context_window: 200000,
        default_temperature: 0.7,
        default_max_tokens: 8192,
        enabled: 1,
      });

      const m2 = testApp.fixtures.createModel({
        provider_id: p2.id,
        model_identifier: 'gpt-4o',
        display_name: 'GPT-4o',
        source: 'discovered',
        context_window: 128000,
        default_temperature: 0.5,
        default_max_tokens: 4096,
        enabled: 1,
      });

      const res = await testApp
        .request()
        .get('/api/v1/models')
        .expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.items).toHaveLength(2);

      const item1 = res.body.items.find((i: { id: string }) => i.id === m1.id);
      expect(item1).toBeDefined();
      expect(item1.displayName).toBe('Claude 3.5 Sonnet');
      expect(item1.providerId).toBe(p1.id);
      expect(item1.provider).toEqual({
        id: p1.id,
        name: 'Anthropic',
        kind: 'anthropic',
      });

      const item2 = res.body.items.find((i: { id: string }) => i.id === m2.id);
      expect(item2).toBeDefined();
      expect(item2.displayName).toBe('GPT-4o');
      expect(item2.providerId).toBe(p2.id);
      expect(item2.provider).toEqual({
        id: p2.id,
        name: 'OpenAI',
        kind: 'openai',
      });
    });

    it('lists models with identical modelIdentifier under different providers independently', async () => {
      const p1 = testApp.fixtures.createProvider({
        name: 'Local Ollama',
        kind: 'ollama',
      });
      const p2 = testApp.fixtures.createProvider({
        name: 'Remote LMStudio',
        kind: 'lmstudio',
      });

      const m1 = testApp.fixtures.createModel({
        provider_id: p1.id,
        model_identifier: 'qwen2.5:14b',
        display_name: 'Qwen 2.5 14B (Ollama)',
      });

      const m2 = testApp.fixtures.createModel({
        provider_id: p2.id,
        model_identifier: 'qwen2.5:14b',
        display_name: 'Qwen 2.5 14B (LMStudio)',
      });

      const res = await testApp
        .request()
        .get('/api/v1/models')
        .expect(200);

      expect(res.body.total).toBe(2);
      const identifiers = res.body.items.map((i: { modelIdentifier: string }) => i.modelIdentifier);
      expect(identifiers).toEqual(['qwen2.5:14b', 'qwen2.5:14b']);

      const found1 = res.body.items.find((i: { id: string }) => i.id === m1.id);
      expect(found1.provider.name).toBe('Local Ollama');

      const found2 = res.body.items.find((i: { id: string }) => i.id === m2.id);
      expect(found2.provider.name).toBe('Remote LMStudio');
    });

    it('filters by providerId', async () => {
      const p1 = testApp.fixtures.createProvider({ name: 'Provider 1' });
      const p2 = testApp.fixtures.createProvider({ name: 'Provider 2' });

      testApp.fixtures.createModel({ provider_id: p1.id, display_name: 'Model 1' });
      testApp.fixtures.createModel({ provider_id: p2.id, display_name: 'Model 2' });

      const res = await testApp
        .request()
        .get(`/api/v1/models?providerId=${p1.id}`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.items[0].displayName).toBe('Model 1');
      expect(res.body.items[0].providerId).toBe(p1.id);
    });

    it('filters by enabled boolean (?enabled=true and ?enabled=false)', async () => {
      const p = testApp.fixtures.createProvider();
      testApp.fixtures.createModel({
        provider_id: p.id,
        model_identifier: 'mod-active',
        display_name: 'Active',
        enabled: 1,
      });
      testApp.fixtures.createModel({
        provider_id: p.id,
        model_identifier: 'mod-disabled',
        display_name: 'Disabled',
        enabled: 0,
      });

      const resTrue = await testApp
        .request()
        .get('/api/v1/models?enabled=true')
        .expect(200);

      expect(resTrue.body.total).toBe(1);
      expect(resTrue.body.items[0].displayName).toBe('Active');
      expect(resTrue.body.items[0].enabled).toBe(true);

      const resFalse = await testApp
        .request()
        .get('/api/v1/models?enabled=false')
        .expect(200);

      expect(resFalse.body.total).toBe(1);
      expect(resFalse.body.items[0].displayName).toBe('Disabled');
      expect(resFalse.body.items[0].enabled).toBe(false);
    });

    it('filters by source (?source=manual and ?source=discovered)', async () => {
      const p = testApp.fixtures.createProvider();
      testApp.fixtures.createModel({
        provider_id: p.id,
        model_identifier: 'mod-manual',
        display_name: 'Manual Model',
        source: 'manual',
      });
      testApp.fixtures.createModel({
        provider_id: p.id,
        model_identifier: 'mod-discovered',
        display_name: 'Discovered Model',
        source: 'discovered',
      });

      const resManual = await testApp
        .request()
        .get('/api/v1/models?source=manual')
        .expect(200);

      expect(resManual.body.total).toBe(1);
      expect(resManual.body.items[0].displayName).toBe('Manual Model');

      const resDiscovered = await testApp
        .request()
        .get('/api/v1/models?source=discovered')
        .expect(200);

      expect(resDiscovered.body.total).toBe(1);
      expect(resDiscovered.body.items[0].displayName).toBe('Discovered Model');
    });

    it('supports pagination and sorting', async () => {
      const p = testApp.fixtures.createProvider();
      testApp.fixtures.createModel({
        provider_id: p.id,
        model_identifier: 'mod-alpha',
        display_name: 'Alpha',
      });
      testApp.fixtures.createModel({
        provider_id: p.id,
        model_identifier: 'mod-beta',
        display_name: 'Beta',
      });
      testApp.fixtures.createModel({
        provider_id: p.id,
        model_identifier: 'mod-gamma',
        display_name: 'Gamma',
      });

      const res = await testApp
        .request()
        .get('/api/v1/models?sort=displayName&order=asc&limit=2&offset=0')
        .expect(200);

      expect(res.body.total).toBe(3);
      expect(res.body.limit).toBe(2);
      expect(res.body.offset).toBe(0);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].displayName).toBe('Alpha');
      expect(res.body.items[1].displayName).toBe('Beta');

      const resPage2 = await testApp
        .request()
        .get('/api/v1/models?sort=displayName&order=asc&limit=2&offset=2')
        .expect(200);

      expect(resPage2.body.items).toHaveLength(1);
      expect(resPage2.body.items[0].displayName).toBe('Gamma');
    });

    it('rejects invalid query parameters with 400', async () => {
      const res = await testApp
        .request()
        .get('/api/v1/models?unknownFilter=invalid')
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    });
  });

  // 2. GET /api/v1/models/:modelId
  describe('GET /api/v1/models/:modelId', () => {
    it('returns the model resource with provider summary for valid ID', async () => {
      const p = testApp.fixtures.createProvider({
        name: 'Anthropic',
        kind: 'anthropic',
      });
      const m = testApp.fixtures.createModel({
        provider_id: p.id,
        model_identifier: 'claude-3-7-sonnet',
        display_name: 'Claude 3.7 Sonnet',
        source: 'manual',
        context_window: 200000,
        default_temperature: 0.8,
        default_max_tokens: 8192,
        enabled: 1,
      });

      const res = await testApp
        .request()
        .get(`/api/v1/models/${m.id}`)
        .expect(200);

      expect(res.body).toEqual({
        id: m.id,
        providerId: p.id,
        modelIdentifier: 'claude-3-7-sonnet',
        displayName: 'Claude 3.7 Sonnet',
        source: 'manual',
        contextWindow: 200000,
        defaultTemperature: 0.8,
        defaultMaxTokens: 8192,
        enabled: true,
        createdAt: m.created_at,
        updatedAt: m.updated_at,
        provider: {
          id: p.id,
          name: 'Anthropic',
          kind: 'anthropic',
        },
      });
    });

    it('returns 404 when model ID does not exist', async () => {
      const res = await testApp
        .request()
        .get(`/api/v1/models/${unknownModelId}`)
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
      expect(res.body.message).toContain(unknownModelId);
    });
  });

  // 3. PATCH /api/v1/models/:modelId
  describe('PATCH /api/v1/models/:modelId', () => {
    it('updates displayName and advances updated_at without modifying created_at', async () => {
      const p = testApp.fixtures.createProvider();
      const m = testApp.fixtures.createModel({
        provider_id: p.id,
        display_name: 'Old Display Name',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      });

      const res = await testApp
        .request()
        .patch(`/api/v1/models/${m.id}`)
        .send({ displayName: 'New Display Name' })
        .expect(200);

      expect(res.body.displayName).toBe('New Display Name');
      expect(res.body.createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(res.body.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');

      // Assert row in SQLite
      const updatedRow = testApp.db.get<{ display_name: string; created_at: string; updated_at: string }>(
        'SELECT display_name, created_at, updated_at FROM models WHERE id = ?',
        [m.id],
      );
      expect(updatedRow?.display_name).toBe('New Display Name');
      expect(updatedRow?.created_at).toBe('2026-01-01T00:00:00.000Z');
      expect(updatedRow?.updated_at).toBe(res.body.updatedAt);
    });

    it('updates enabled boolean (round-trip)', async () => {
      const p = testApp.fixtures.createProvider();
      const m = testApp.fixtures.createModel({
        provider_id: p.id,
        enabled: 1,
      });

      const res1 = await testApp
        .request()
        .patch(`/api/v1/models/${m.id}`)
        .send({ enabled: false })
        .expect(200);

      expect(res1.body.enabled).toBe(false);

      const dbRow1 = testApp.db.get<{ enabled: number }>(
        'SELECT enabled FROM models WHERE id = ?',
        [m.id],
      );
      expect(dbRow1?.enabled).toBe(0);

      const res2 = await testApp
        .request()
        .patch(`/api/v1/models/${m.id}`)
        .send({ enabled: true })
        .expect(200);

      expect(res2.body.enabled).toBe(true);

      const dbRow2 = testApp.db.get<{ enabled: number }>(
        'SELECT enabled FROM models WHERE id = ?',
        [m.id],
      );
      expect(dbRow2?.enabled).toBe(1);
    });

    it('clears nullable numeric fields when set to null', async () => {
      const p = testApp.fixtures.createProvider();
      const m = testApp.fixtures.createModel({
        provider_id: p.id,
        context_window: 100000,
        default_temperature: 0.7,
        default_max_tokens: 4096,
      });

      const res = await testApp
        .request()
        .patch(`/api/v1/models/${m.id}`)
        .send({
          contextWindow: null,
          defaultTemperature: null,
          defaultMaxTokens: null,
        })
        .expect(200);

      expect(res.body.contextWindow).toBeNull();
      expect(res.body.defaultTemperature).toBeNull();
      expect(res.body.defaultMaxTokens).toBeNull();

      const dbRow = testApp.db.get<{ context_window: number | null; default_temperature: number | null; default_max_tokens: number | null }>(
        'SELECT context_window, default_temperature, default_max_tokens FROM models WHERE id = ?',
        [m.id],
      );
      expect(dbRow?.context_window).toBeNull();
      expect(dbRow?.default_temperature).toBeNull();
      expect(dbRow?.default_max_tokens).toBeNull();
    });

    it('isolates partial updates (leaving untouched fields unchanged)', async () => {
      const p = testApp.fixtures.createProvider();
      const m = testApp.fixtures.createModel({
        provider_id: p.id,
        display_name: 'Original Name',
        context_window: 50000,
        default_temperature: 0.3,
        default_max_tokens: 2000,
        enabled: 1,
      });

      const res = await testApp
        .request()
        .patch(`/api/v1/models/${m.id}`)
        .send({ displayName: 'New Name Only' })
        .expect(200);

      expect(res.body.displayName).toBe('New Name Only');
      expect(res.body.contextWindow).toBe(50000);
      expect(res.body.defaultTemperature).toBe(0.3);
      expect(res.body.defaultMaxTokens).toBe(2000);
      expect(res.body.enabled).toBe(true);
    });

    it('returns 200 for empty body ({}) without modifying row', async () => {
      const p = testApp.fixtures.createProvider();
      const m = testApp.fixtures.createModel({
        provider_id: p.id,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      });

      const res = await testApp
        .request()
        .patch(`/api/v1/models/${m.id}`)
        .send({})
        .expect(200);

      expect(res.body.id).toBe(m.id);
      expect(res.body.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    // Rejection of immutable fields
    it('rejects attempt to change providerId with 400 and modifies nothing', async () => {
      const p1 = testApp.fixtures.createProvider();
      const p2 = testApp.fixtures.createProvider();
      const m = testApp.fixtures.createModel({
        provider_id: p1.id,
        display_name: 'Original',
      });

      const res = await testApp
        .request()
        .patch(`/api/v1/models/${m.id}`)
        .send({ providerId: p2.id })
        .expect(400);

      expect(res.body.statusCode).toBe(400);

      const dbRow = testApp.db.get<{ provider_id: string }>(
        'SELECT provider_id FROM models WHERE id = ?',
        [m.id],
      );
      expect(dbRow?.provider_id).toBe(p1.id);
    });

    it('rejects attempt to change modelIdentifier with 400 and modifies nothing', async () => {
      const p = testApp.fixtures.createProvider();
      const m = testApp.fixtures.createModel({
        provider_id: p.id,
        model_identifier: 'original-id',
      });

      const res = await testApp
        .request()
        .patch(`/api/v1/models/${m.id}`)
        .send({ modelIdentifier: 'new-id' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);

      const dbRow = testApp.db.get<{ model_identifier: string }>(
        'SELECT model_identifier FROM models WHERE id = ?',
        [m.id],
      );
      expect(dbRow?.model_identifier).toBe('original-id');
    });

    it('rejects attempt to change source with 400 and modifies nothing', async () => {
      const p = testApp.fixtures.createProvider();
      const m = testApp.fixtures.createModel({
        provider_id: p.id,
        source: 'discovered',
      });

      const res = await testApp
        .request()
        .patch(`/api/v1/models/${m.id}`)
        .send({ source: 'manual' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);

      const dbRow = testApp.db.get<{ source: string }>(
        'SELECT source FROM models WHERE id = ?',
        [m.id],
      );
      expect(dbRow?.source).toBe('discovered');
    });

    it('rejects validation errors (empty displayName, negative bounds) with 400', async () => {
      const p = testApp.fixtures.createProvider();
      const m = testApp.fixtures.createModel({ provider_id: p.id });

      await testApp
        .request()
        .patch(`/api/v1/models/${m.id}`)
        .send({ displayName: '' })
        .expect(400);

      await testApp
        .request()
        .patch(`/api/v1/models/${m.id}`)
        .send({ contextWindow: -10 })
        .expect(400);

      await testApp
        .request()
        .patch(`/api/v1/models/${m.id}`)
        .send({ defaultTemperature: -0.1 })
        .expect(400);

      await testApp
        .request()
        .patch(`/api/v1/models/${m.id}`)
        .send({ defaultMaxTokens: 0 })
        .expect(400);
    });

    it('returns 404 when patching non-existent model ID', async () => {
      const res = await testApp
        .request()
        .patch(`/api/v1/models/${unknownModelId}`)
        .send({ displayName: 'Ghost Model' })
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });

  // 4. DELETE /api/v1/models/:modelId
  describe('DELETE /api/v1/models/:modelId', () => {
    it('deletes model and returns 204 No Content', async () => {
      const p = testApp.fixtures.createProvider();
      const m = testApp.fixtures.createModel({ provider_id: p.id });

      await testApp
        .request()
        .delete(`/api/v1/models/${m.id}`)
        .expect(204);

      // Model is gone from database
      const row = testApp.db.get<{ id: string }>(
        'SELECT id FROM models WHERE id = ?',
        [m.id],
      );
      expect(row).toBeUndefined();

      // Subsequent GET returns 404
      await testApp
        .request()
        .get(`/api/v1/models/${m.id}`)
        .expect(404);
    });

    it('returns 404 when deleting non-existent model ID', async () => {
      const res = await testApp
        .request()
        .delete(`/api/v1/models/${unknownModelId}`)
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('leaves dependent agents intact with model_id set to null (ON DELETE SET NULL)', async () => {
      const p = testApp.fixtures.createProvider();
      const m = testApp.fixtures.createModel({ provider_id: p.id });
      const agent = testApp.fixtures.createAgent({
        name: 'Dependent Agent',
        model_id: m.id,
      });

      // Verify agent has model_id initially
      const agentBefore = testApp.db.get<{ model_id: string }>(
        'SELECT model_id FROM agents WHERE id = ?',
        [agent.id],
      );
      expect(agentBefore?.model_id).toBe(m.id);

      // Delete the model
      await testApp
        .request()
        .delete(`/api/v1/models/${m.id}`)
        .expect(204);

      // Agent survives with model_id set to null
      const agentAfter = testApp.db.get<{ id: string; name: string; model_id: string | null }>(
        'SELECT id, name, model_id FROM agents WHERE id = ?',
        [agent.id],
      );
      expect(agentAfter).toBeDefined();
      expect(agentAfter?.id).toBe(agent.id);
      expect(agentAfter?.name).toBe('Dependent Agent');
      expect(agentAfter?.model_id).toBeNull();

      // Verify via agents GET endpoint
      const agentRes = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}`)
        .expect(200);

      expect(agentRes.body.modelId).toBeNull();
    });

    it('cascades deletion from provider: deleting provider deletes its models (ON DELETE CASCADE)', async () => {
      const p = testApp.fixtures.createProvider();
      const m = testApp.fixtures.createModel({ provider_id: p.id });

      // Delete the provider
      await testApp
        .request()
        .delete(`/api/v1/providers/${p.id}`)
        .expect(204);

      // Model is CASCADE deleted
      const modelRow = testApp.db.get<{ id: string }>(
        'SELECT id FROM models WHERE id = ?',
        [m.id],
      );
      expect(modelRow).toBeUndefined();

      // GET /models/:modelId returns 404
      await testApp
        .request()
        .get(`/api/v1/models/${m.id}`)
        .expect(404);
    });
  });

  it('makes zero outbound HTTP or HTTPS network calls across all operations', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const p = testApp.fixtures.createProvider();
    const m = testApp.fixtures.createModel({
      provider_id: p.id,
      model_identifier: 'outbound-check-mod',
    });

    try {
      await testApp.request().get('/api/v1/models').expect(200);
      await testApp.request().get(`/api/v1/models/${m.id}`).expect(200);
      await testApp.request().patch(`/api/v1/models/${m.id}`).send({ displayName: 'Updated' }).expect(200);
      await testApp.request().delete(`/api/v1/models/${m.id}`).expect(204);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(httpsRequestSpy).not.toHaveBeenCalled();

      // Any http.request calls must only be the local supertest request to 127.0.0.1
      for (const call of httpRequestSpy.mock.calls) {
        const options = call[0];
        const host =
          typeof options === 'string'
            ? options
            : options?.host || options?.hostname;
        expect(['127.0.0.1', 'localhost']).toContain(host);
      }
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
