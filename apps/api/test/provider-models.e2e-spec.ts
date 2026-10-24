import http from 'node:http';
import https from 'node:https';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from './harness/index.js';

describe('Provider models endpoints (e2e)', () => {
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

  const unknownProviderId = '018f3a9e-0000-7000-8000-000000000000';

  // 1. Unknown provider handling (404 on both endpoints)
  describe('Unknown provider handling', () => {
    it('GET /api/v1/providers/:providerId/models returns 404 for unknown provider', async () => {
      const res = await testApp
        .request()
        .get(`/api/v1/providers/${unknownProviderId}/models`)
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
      expect(res.body.message).toContain(unknownProviderId);
    });

    it('POST /api/v1/providers/:providerId/models returns 404 for unknown provider', async () => {
      const res = await testApp
        .request()
        .post(`/api/v1/providers/${unknownProviderId}/models`)
        .send({
          modelIdentifier: 'claude-sonnet-5',
          displayName: 'Claude Sonnet 3.5',
        })
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
      expect(res.body.message).toContain(unknownProviderId);
    });
  });

  // 2. Manual Model Registration (POST /api/v1/providers/:providerId/models)
  describe('POST /api/v1/providers/:providerId/models', () => {
    it('creates a model with minimal required fields and returns 201', async () => {
      const provider = testApp.fixtures.createProvider({ name: 'Anthropic' });

      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({
          modelIdentifier: 'claude-sonnet-5',
          displayName: 'Claude Sonnet 3.5',
        })
        .expect(201);

      expect(res.body).toEqual({
        id: expect.any(String),
        providerId: provider.id,
        modelIdentifier: 'claude-sonnet-5',
        displayName: 'Claude Sonnet 3.5',
        source: 'manual',
        contextWindow: null,
        defaultTemperature: null,
        defaultMaxTokens: null,
        enabled: true, // defaults to true
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      // Verify row in SQLite
      const row = testApp.db.get<{
        id: string;
        provider_id: string;
        model_identifier: string;
        source: string;
        enabled: number;
      }>('SELECT * FROM models WHERE id = ?', [res.body.id]);

      expect(row).toBeDefined();
      expect(row?.provider_id).toBe(provider.id);
      expect(row?.model_identifier).toBe('claude-sonnet-5');
      expect(row?.source).toBe('manual');
      expect(row?.enabled).toBe(1);
    });

    it('creates a model with full optional fields including enabled: false', async () => {
      const provider = testApp.fixtures.createProvider({ name: 'Ollama Local' });

      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({
          modelIdentifier: 'qwen2.5:14b',
          displayName: 'Qwen 2.5 14B',
          contextWindow: 32768,
          defaultTemperature: 0.7,
          defaultMaxTokens: 4096,
          enabled: false,
        })
        .expect(201);

      expect(res.body).toMatchObject({
        providerId: provider.id,
        modelIdentifier: 'qwen2.5:14b',
        displayName: 'Qwen 2.5 14B',
        source: 'manual',
        contextWindow: 32768,
        defaultTemperature: 0.7,
        defaultMaxTokens: 4096,
        enabled: false,
      });

      // Verify enabled is stored as integer 0
      const row = testApp.db.get<{ enabled: number }>(
        'SELECT enabled FROM models WHERE id = ?',
        [res.body.id],
      );
      expect(row?.enabled).toBe(0);
    });

    it('trims surrounding whitespace while preserving exact casing', async () => {
      const provider = testApp.fixtures.createProvider();

      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({
          modelIdentifier: '  Claude-Sonnet-5  ',
          displayName: '  Claude 3.5 Sonnet  ',
        })
        .expect(201);

      expect(res.body.modelIdentifier).toBe('Claude-Sonnet-5');
      expect(res.body.displayName).toBe('Claude 3.5 Sonnet');
    });

    it('rejects client attempt to supply source in body with 400', async () => {
      const provider = testApp.fixtures.createProvider();

      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({
          modelIdentifier: 'claude-sonnet-5',
          displayName: 'Claude Sonnet 3.5',
          source: 'discovered',
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
      expect(res.body.details?.some((d: string) => d.includes('source'))).toBe(true);
    });

    it('rejects client attempt to supply providerId in body with 400', async () => {
      const provider = testApp.fixtures.createProvider();

      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({
          modelIdentifier: 'claude-sonnet-5',
          displayName: 'Claude Sonnet 3.5',
          providerId: provider.id,
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
      expect(res.body.details?.some((d: string) => d.includes('providerId'))).toBe(true);
    });

    it('rejects client attempt to supply id or timestamps in body with 400', async () => {
      const provider = testApp.fixtures.createProvider();

      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({
          modelIdentifier: 'claude-sonnet-5',
          displayName: 'Claude Sonnet 3.5',
          id: '018f3a9e-0000-7000-8000-000000000099',
          createdAt: '2026-10-24T00:00:00.000Z',
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    });

    it('rejects missing or empty modelIdentifier with 400', async () => {
      const provider = testApp.fixtures.createProvider();

      await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({ displayName: 'Model' })
        .expect(400);

      await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({ modelIdentifier: '   ', displayName: 'Model' })
        .expect(400);
    });

    it('rejects missing or empty displayName with 400', async () => {
      const provider = testApp.fixtures.createProvider();

      await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({ modelIdentifier: 'claude-sonnet-5' })
        .expect(400);

      await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({ modelIdentifier: 'claude-sonnet-5', displayName: '   ' })
        .expect(400);
    });

    it('rejects invalid boundaries for numeric fields with 400', async () => {
      const provider = testApp.fixtures.createProvider();

      // Zero contextWindow
      await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({
          modelIdentifier: 'm1',
          displayName: 'M1',
          contextWindow: 0,
        })
        .expect(400);

      // Negative temperature
      await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({
          modelIdentifier: 'm2',
          displayName: 'M2',
          defaultTemperature: -0.5,
        })
        .expect(400);

      // Zero defaultMaxTokens
      await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({
          modelIdentifier: 'm3',
          displayName: 'M3',
          defaultMaxTokens: 0,
        })
        .expect(400);
    });
  });

  // 3. Conflict Handling (409) and Scoped Uniqueness
  describe('Conflict handling and scoped uniqueness', () => {
    it('returns 409 Conflict when modelIdentifier already exists for the same provider', async () => {
      const provider = testApp.fixtures.createProvider();

      // First registration succeeds
      await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({
          modelIdentifier: 'claude-sonnet-5',
          displayName: 'Claude Sonnet 3.5',
        })
        .expect(201);

      // Duplicate registration returns 409
      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({
          modelIdentifier: 'claude-sonnet-5',
          displayName: 'Claude Sonnet 3.5 Duplicate',
        })
        .expect(409);

      expect(res.body.statusCode).toBe(409);
      expect(res.body.code).toBe('CONFLICT');
      expect(res.body.message).toContain('claude-sonnet-5');

      // Assert only 1 row exists
      const count = testApp.db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM models WHERE provider_id = ? AND model_identifier = ?',
        [provider.id, 'claude-sonnet-5'],
      );
      expect(count?.count).toBe(1);
    });

    it('succeeds when the same modelIdentifier is registered under a DIFFERENT provider', async () => {
      const provider1 = testApp.fixtures.createProvider({ name: 'Provider 1' });
      const provider2 = testApp.fixtures.createProvider({ name: 'Provider 2' });

      // Register under Provider 1
      const res1 = await testApp
        .request()
        .post(`/api/v1/providers/${provider1.id}/models`)
        .send({
          modelIdentifier: 'qwen2.5:14b',
          displayName: 'Qwen Local P1',
        })
        .expect(201);

      // Register same identifier under Provider 2
      const res2 = await testApp
        .request()
        .post(`/api/v1/providers/${provider2.id}/models`)
        .send({
          modelIdentifier: 'qwen2.5:14b',
          displayName: 'Qwen Local P2',
        })
        .expect(201);

      expect(res1.body.providerId).toBe(provider1.id);
      expect(res2.body.providerId).toBe(provider2.id);
      expect(res1.body.modelIdentifier).toBe('qwen2.5:14b');
      expect(res2.body.modelIdentifier).toBe('qwen2.5:14b');
      expect(res1.body.id).not.toBe(res2.body.id);
    });
  });

  // 4. Model Listing (GET /api/v1/providers/:providerId/models)
  describe('GET /api/v1/providers/:providerId/models', () => {
    it('returns 200 with an empty collection when provider has no models', async () => {
      const provider = testApp.fixtures.createProvider();

      const res = await testApp
        .request()
        .get(`/api/v1/providers/${provider.id}/models`)
        .expect(200);

      expect(res.body).toEqual({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      });
    });

    it('returns only models belonging to the specified provider', async () => {
      const provider1 = testApp.fixtures.createProvider({ name: 'Provider 1' });
      const provider2 = testApp.fixtures.createProvider({ name: 'Provider 2' });

      // Create model for provider 1
      const m1 = testApp.fixtures.createModel({
        provider_id: provider1.id,
        model_identifier: 'p1-model',
        display_name: 'P1 Model',
      });

      // Create model for provider 2
      testApp.fixtures.createModel({
        provider_id: provider2.id,
        model_identifier: 'p2-model',
        display_name: 'P2 Model',
      });

      const res = await testApp
        .request()
        .get(`/api/v1/providers/${provider1.id}/models`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].id).toBe(m1.id);
      expect(res.body.items[0].modelIdentifier).toBe('p1-model');
    });

    it('converts SQLite integer enabled to JSON boolean in responses', async () => {
      const provider = testApp.fixtures.createProvider();

      testApp.fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'enabled-model',
        enabled: 1,
      });
      testApp.fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'disabled-model',
        enabled: 0,
      });

      const res = await testApp
        .request()
        .get(`/api/v1/providers/${provider.id}/models?sort=modelIdentifier&order=asc`)
        .expect(200);

      expect(res.body.total).toBe(2);
      const disabled = res.body.items.find(
        (m: any) => m.modelIdentifier === 'disabled-model',
      );
      const enabled = res.body.items.find(
        (m: any) => m.modelIdentifier === 'enabled-model',
      );

      expect(disabled?.enabled).toBe(false);
      expect(enabled?.enabled).toBe(true);
    });

    it('filters by enabled status', async () => {
      const provider = testApp.fixtures.createProvider();

      testApp.fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'm-enabled',
        enabled: 1,
      });
      testApp.fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'm-disabled',
        enabled: 0,
      });

      const resEnabled = await testApp
        .request()
        .get(`/api/v1/providers/${provider.id}/models?enabled=true`)
        .expect(200);

      expect(resEnabled.body.total).toBe(1);
      expect(resEnabled.body.items[0].modelIdentifier).toBe('m-enabled');

      const resDisabled = await testApp
        .request()
        .get(`/api/v1/providers/${provider.id}/models?enabled=false`)
        .expect(200);

      expect(resDisabled.body.total).toBe(1);
      expect(resDisabled.body.items[0].modelIdentifier).toBe('m-disabled');
    });

    it('filters by source (discovered vs manual)', async () => {
      const provider = testApp.fixtures.createProvider();

      testApp.fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'm-manual',
        source: 'manual',
      });
      testApp.fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'm-discovered',
        source: 'discovered',
      });

      const resManual = await testApp
        .request()
        .get(`/api/v1/providers/${provider.id}/models?source=manual`)
        .expect(200);

      expect(resManual.body.total).toBe(1);
      expect(resManual.body.items[0].modelIdentifier).toBe('m-manual');

      const resDiscovered = await testApp
        .request()
        .get(`/api/v1/providers/${provider.id}/models?source=discovered`)
        .expect(200);

      expect(resDiscovered.body.total).toBe(1);
      expect(resDiscovered.body.items[0].modelIdentifier).toBe('m-discovered');
    });

    it('paginates and sorts correctly', async () => {
      const provider = testApp.fixtures.createProvider();

      for (let i = 1; i <= 5; i++) {
        testApp.fixtures.createModel({
          provider_id: provider.id,
          model_identifier: `model-${i.toString().padStart(2, '0')}`,
          display_name: `Model ${i}`,
        });
      }

      // Page 1: limit 2, offset 0, sorted by modelIdentifier asc
      const page1 = await testApp
        .request()
        .get(
          `/api/v1/providers/${provider.id}/models?limit=2&offset=0&sort=modelIdentifier&order=asc`,
        )
        .expect(200);

      expect(page1.body.total).toBe(5);
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.items[0].modelIdentifier).toBe('model-01');
      expect(page1.body.items[1].modelIdentifier).toBe('model-02');

      // Page 2: limit 2, offset 2
      const page2 = await testApp
        .request()
        .get(
          `/api/v1/providers/${provider.id}/models?limit=2&offset=2&sort=modelIdentifier&order=asc`,
        )
        .expect(200);

      expect(page2.body.total).toBe(5);
      expect(page2.body.items).toHaveLength(2);
      expect(page2.body.items[0].modelIdentifier).toBe('model-03');
      expect(page2.body.items[1].modelIdentifier).toBe('model-04');
    });

    it('rejects invalid sort column with 400 Bad Request', async () => {
      const provider = testApp.fixtures.createProvider();

      const res = await testApp
        .request()
        .get(`/api/v1/providers/${provider.id}/models?sort=nonExistentColumn`)
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
      expect(res.body.message).toContain('nonExistentColumn');
    });
  });

  // 5. ON DELETE CASCADE Integration
  describe('Provider deletion cascade (integration)', () => {
    it('deleting a provider automatically removes its models via ON DELETE CASCADE', async () => {
      const provider = testApp.fixtures.createProvider();

      // Register a model
      const createRes = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({
          modelIdentifier: 'cascade-model',
          displayName: 'Cascade Test Model',
        })
        .expect(201);

      const modelId = createRes.body.id;

      // Verify model exists before provider deletion
      const beforeRow = testApp.db.get<{ id: string }>(
        'SELECT id FROM models WHERE id = ?',
        [modelId],
      );
      expect(beforeRow).toBeDefined();

      // Delete the provider
      await testApp
        .request()
        .delete(`/api/v1/providers/${provider.id}`)
        .expect(204);

      // Verify model row is gone
      const afterRow = testApp.db.get<{ id: string }>(
        'SELECT id FROM models WHERE id = ?',
        [modelId],
      );
      expect(afterRow).toBeUndefined();
    });
  });

  // 6. No Outbound Calls
  describe('No outbound calls assertion', () => {
    it('registering and listing models makes no outbound HTTP/HTTPS calls', async () => {
      const provider = testApp.fixtures.createProvider();

      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const httpsRequestSpy = vi.spyOn(https, 'request');
      const httpRequestSpy = vi.spyOn(http, 'request');

      try {
        // Register model
        await testApp
          .request()
          .post(`/api/v1/providers/${provider.id}/models`)
          .send({
            modelIdentifier: 'claude-sonnet-5',
            displayName: 'Claude Sonnet 3.5',
          })
          .expect(201);

        // List models
        await testApp
          .request()
          .get(`/api/v1/providers/${provider.id}/models`)
          .expect(200);

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
        httpsRequestSpy.mockRestore();
        httpRequestSpy.mockRestore();
      }
    });
  });
});
