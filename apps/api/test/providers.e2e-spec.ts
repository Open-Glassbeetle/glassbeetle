import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from './harness/index.js';

describe('Providers endpoints (e2e)', () => {
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

  // -------------------------------------------------------------------------
  // Database safety
  // -------------------------------------------------------------------------

  describe('Database safety', () => {
    it('has foreign-key enforcement active', () => {
      const result = testApp.db.get<{ foreign_keys: number }>('PRAGMA foreign_keys');
      expect(result?.foreign_keys).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/providers — list
  // -------------------------------------------------------------------------

  describe('GET /api/v1/providers', () => {
    it('returns 200 with an empty collection when there are no providers', async () => {
      const res = await testApp.request().get('/api/v1/providers').expect(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('returns all providers in a paginated envelope', async () => {
      testApp.fixtures.createProvider({ name: 'Provider A' });
      testApp.fixtures.createProvider({ name: 'Provider B' });

      const res = await testApp.request().get('/api/v1/providers').expect(200);
      expect(res.body.total).toBe(2);
      expect(res.body.items).toHaveLength(2);
    });

    it('filters by kind', async () => {
      testApp.fixtures.createProvider({ kind: 'anthropic' });
      testApp.fixtures.createProvider({ kind: 'openai' });

      const res = await testApp
        .request()
        .get('/api/v1/providers?kind=anthropic')
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.items[0].kind).toBe('anthropic');
    });

    it('filters by enabled=true', async () => {
      testApp.fixtures.createProvider({ enabled: 1 });
      testApp.fixtures.createProvider({ enabled: 0 });

      const res = await testApp
        .request()
        .get('/api/v1/providers?enabled=true')
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.items[0].enabled).toBe(true);
    });

    it('filters by enabled=false', async () => {
      testApp.fixtures.createProvider({ enabled: 1 });
      testApp.fixtures.createProvider({ enabled: 0 });

      const res = await testApp
        .request()
        .get('/api/v1/providers?enabled=false')
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.items[0].enabled).toBe(false);
    });

    it('filters by isLocal=true', async () => {
      testApp.fixtures.createProvider({ kind: 'openai', is_local: 0 });
      testApp.fixtures.createProvider({
        kind: 'ollama',
        is_local: 1,
        base_url: 'http://localhost:11434',
      });

      const res = await testApp
        .request()
        .get('/api/v1/providers?isLocal=true')
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.items[0].isLocal).toBe(true);
    });

    it('combines kind and enabled filters', async () => {
      testApp.fixtures.createProvider({ kind: 'anthropic', enabled: 1 });
      testApp.fixtures.createProvider({ kind: 'anthropic', enabled: 0 });
      testApp.fixtures.createProvider({ kind: 'openai', enabled: 1 });

      const res = await testApp
        .request()
        .get('/api/v1/providers?kind=anthropic&enabled=true')
        .expect(200);

      expect(res.body.total).toBe(1);
    });

    it('paginates with limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        testApp.fixtures.createProvider({ name: `Provider ${i}` });
      }

      const res = await testApp
        .request()
        .get('/api/v1/providers?limit=2&offset=1')
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.limit).toBe(2);
      expect(res.body.offset).toBe(1);
    });

    it('rejects invalid kind filter with 400', async () => {
      await testApp
        .request()
        .get('/api/v1/providers?kind=badkind')
        .expect(400);
    });

    it('returns 400 for an invalid sort field', async () => {
      await testApp
        .request()
        .get('/api/v1/providers?sort=notafield')
        .expect(400);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/providers — create
  // -------------------------------------------------------------------------

  describe('POST /api/v1/providers', () => {
    it('creates an anthropic provider and returns 201', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/providers')
        .send({ name: 'My Anthropic', kind: 'anthropic' })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('My Anthropic');
      expect(res.body.kind).toBe('anthropic');
      expect(res.body.isLocal).toBe(false);
      expect(res.body.enabled).toBe(true);
      expect(res.body.baseUrl).toBeNull();
      expect(typeof res.body.createdAt).toBe('string');
      expect(typeof res.body.updatedAt).toBe('string');
    });

    it('creates an openai provider', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/providers')
        .send({ name: 'My OpenAI', kind: 'openai' })
        .expect(201);

      expect(res.body.kind).toBe('openai');
    });

    it('creates a google provider', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/providers')
        .send({ name: 'My Google', kind: 'google' })
        .expect(201);

      expect(res.body.kind).toBe('google');
    });

    it('creates an ollama provider with a required baseUrl', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/providers')
        .send({ name: 'Local Ollama', kind: 'ollama', baseUrl: 'http://localhost:11434' })
        .expect(201);

      expect(res.body.kind).toBe('ollama');
      expect(res.body.isLocal).toBe(true);
      expect(res.body.baseUrl).toBe('http://localhost:11434');
    });

    it('creates an lmstudio provider with a required baseUrl', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/providers')
        .send({ name: 'LM Studio', kind: 'lmstudio', baseUrl: 'http://localhost:1234' })
        .expect(201);

      expect(res.body.kind).toBe('lmstudio');
      expect(res.body.isLocal).toBe(true);
    });

    it('creates an openai_compatible provider with a required baseUrl', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/providers')
        .send({ name: 'Custom', kind: 'openai_compatible', baseUrl: 'https://my-host.example.com/v1' })
        .expect(201);

      expect(res.body.kind).toBe('openai_compatible');
    });

    it('returns 400 when kind=ollama and baseUrl is omitted', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/providers')
        .send({ name: 'Bad Ollama', kind: 'ollama' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('returns 400 when kind=lmstudio and baseUrl is omitted', async () => {
      await testApp
        .request()
        .post('/api/v1/providers')
        .send({ name: 'Bad LM Studio', kind: 'lmstudio' })
        .expect(400);
    });

    it('returns 400 when kind=openai_compatible and baseUrl is omitted', async () => {
      await testApp
        .request()
        .post('/api/v1/providers')
        .send({ name: 'Bad Compatible', kind: 'openai_compatible' })
        .expect(400);
    });

    it('returns 400 for an invalid kind', async () => {
      await testApp
        .request()
        .post('/api/v1/providers')
        .send({ name: 'Bad Kind', kind: 'notakind' })
        .expect(400);
    });

    it('returns 400 when baseUrl is not a valid URL', async () => {
      await testApp
        .request()
        .post('/api/v1/providers')
        .send({ name: 'Bad URL', kind: 'ollama', baseUrl: 'not-a-url' })
        .expect(400);
    });

    it('returns 400 when baseUrl has a non-http(s) scheme', async () => {
      await testApp
        .request()
        .post('/api/v1/providers')
        .send({ name: 'Bad Scheme', kind: 'ollama', baseUrl: 'grpc://localhost:9000' })
        .expect(400);
    });

    it('always sets isLocal=true for ollama regardless of client value', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/providers')
        .send({ name: 'Ollama', kind: 'ollama', baseUrl: 'http://localhost:11434', isLocal: false })
        .expect(201);

      expect(res.body.isLocal).toBe(true);
    });

    it('always sets isLocal=true for lmstudio regardless of client value', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/providers')
        .send({ name: 'LM Studio', kind: 'lmstudio', baseUrl: 'http://localhost:1234', isLocal: false })
        .expect(201);

      expect(res.body.isLocal).toBe(true);
    });

    it('accepts client-supplied isLocal for openai_compatible', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/providers')
        .send({ name: 'Local Compat', kind: 'openai_compatible', baseUrl: 'http://192.168.1.10/v1', isLocal: true })
        .expect(201);

      expect(res.body.isLocal).toBe(true);
    });

    it('defaults enabled to true', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/providers')
        .send({ name: 'Default Enabled', kind: 'anthropic' })
        .expect(201);

      expect(res.body.enabled).toBe(true);
    });

    it('can create with enabled=false', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/providers')
        .send({ name: 'Disabled', kind: 'anthropic', enabled: false })
        .expect(201);

      expect(res.body.enabled).toBe(false);
    });

    it('returns 400 for an unknown extra property (whitelist enforcement)', async () => {
      await testApp
        .request()
        .post('/api/v1/providers')
        .send({ name: 'Test', kind: 'anthropic', secret: 'shouldBeRejected' })
        .expect(400);
    });

    it('does not make any outbound network call during creation', async () => {
      // We can verify this by spying on global fetch: the endpoint must never
      // contact the provider's API when only storing configuration.
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      await testApp
        .request()
        .post('/api/v1/providers')
        .send({ name: 'No Outbound', kind: 'anthropic' })
        .expect(201);

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/providers/:providerId — retrieve
  // -------------------------------------------------------------------------

  describe('GET /api/v1/providers/:providerId', () => {
    it('returns 200 with the provider', async () => {
      const provider = testApp.fixtures.createProvider({ name: 'Existing' });

      const res = await testApp
        .request()
        .get(`/api/v1/providers/${provider.id}`)
        .expect(200);

      expect(res.body.id).toBe(provider.id);
      expect(res.body.name).toBe('Existing');
    });

    it('returns 404 for an unknown id', async () => {
      await testApp.request().get('/api/v1/providers/ghost-id').expect(404);
    });

    it('returns booleans, not integers', async () => {
      const provider = testApp.fixtures.createProvider({ is_local: 1, enabled: 0 });

      const res = await testApp
        .request()
        .get(`/api/v1/providers/${provider.id}`)
        .expect(200);

      expect(res.body.isLocal).toBe(true);
      expect(res.body.enabled).toBe(false);
    });

    it('does not expose any credential fields', async () => {
      const provider = testApp.fixtures.createProvider();
      const res = await testApp
        .request()
        .get(`/api/v1/providers/${provider.id}`)
        .expect(200);

      expect(res.body).not.toHaveProperty('encryptedValue');
      expect(res.body).not.toHaveProperty('encrypted_value');
      expect(res.body).not.toHaveProperty('nonce');
      expect(res.body).not.toHaveProperty('apiKey');
      expect(res.body).not.toHaveProperty('credential');
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/v1/providers/:providerId — update
  // -------------------------------------------------------------------------

  describe('PATCH /api/v1/providers/:providerId', () => {
    it('updates only the name, leaving other fields unchanged', async () => {
      const provider = testApp.fixtures.createProvider({
        name: 'Original',
        kind: 'openai',
        enabled: 1,
      });

      const res = await testApp
        .request()
        .patch(`/api/v1/providers/${provider.id}`)
        .send({ name: 'Renamed' })
        .expect(200);

      expect(res.body.name).toBe('Renamed');
      expect(res.body.kind).toBe('openai');
      expect(res.body.enabled).toBe(true);
    });

    it('updates enabled from true to false', async () => {
      const provider = testApp.fixtures.createProvider({ enabled: 1 });

      const res = await testApp
        .request()
        .patch(`/api/v1/providers/${provider.id}`)
        .send({ enabled: false })
        .expect(200);

      expect(res.body.enabled).toBe(false);
    });

    it('updates baseUrl', async () => {
      const provider = testApp.fixtures.createProvider({ kind: 'openai', base_url: null });

      const res = await testApp
        .request()
        .patch(`/api/v1/providers/${provider.id}`)
        .send({ baseUrl: 'https://proxy.example.com/v1' })
        .expect(200);

      expect(res.body.baseUrl).toBe('https://proxy.example.com/v1');
    });

    it('returns 404 for an unknown id', async () => {
      await testApp
        .request()
        .patch('/api/v1/providers/ghost-id')
        .send({ name: 'X' })
        .expect(404);
    });

    it('returns 400 when switching to ollama without a baseUrl', async () => {
      const provider = testApp.fixtures.createProvider({ kind: 'anthropic', base_url: null });

      await testApp
        .request()
        .patch(`/api/v1/providers/${provider.id}`)
        .send({ kind: 'ollama' })
        .expect(400);
    });

    it('returns 400 for an invalid kind', async () => {
      const provider = testApp.fixtures.createProvider();

      await testApp
        .request()
        .patch(`/api/v1/providers/${provider.id}`)
        .send({ kind: 'notakind' })
        .expect(400);
    });

    it('refreshes updatedAt on update', async () => {
      const provider = testApp.fixtures.createProvider({ name: 'Original' });
      const originalUpdatedAt = provider.updated_at;

      // Ensure at least 1 ms elapses
      await new Promise((r) => setTimeout(r, 5));

      const res = await testApp
        .request()
        .patch(`/api/v1/providers/${provider.id}`)
        .send({ name: 'Updated' })
        .expect(200);

      expect(res.body.updatedAt).not.toBe(originalUpdatedAt);
    });

    it('forces isLocal=true when kind is updated to ollama', async () => {
      const provider = testApp.fixtures.createProvider({ kind: 'anthropic', is_local: 0 });

      const res = await testApp
        .request()
        .patch(`/api/v1/providers/${provider.id}`)
        .send({ kind: 'ollama', baseUrl: 'http://localhost:11434' })
        .expect(200);

      expect(res.body.isLocal).toBe(true);
    });

    it('does not make any outbound network call during update', async () => {
      const provider = testApp.fixtures.createProvider();
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      await testApp
        .request()
        .patch(`/api/v1/providers/${provider.id}`)
        .send({ name: 'No Outbound Update' })
        .expect(200);

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /api/v1/providers/:providerId — delete
  // -------------------------------------------------------------------------

  describe('DELETE /api/v1/providers/:providerId', () => {
    it('deletes an existing provider and returns 204', async () => {
      const provider = testApp.fixtures.createProvider();

      await testApp
        .request()
        .delete(`/api/v1/providers/${provider.id}`)
        .expect(204);
    });

    it('returns 404 for an unknown id', async () => {
      await testApp.request().delete('/api/v1/providers/ghost-id').expect(404);
    });

    it('provider is no longer retrievable after deletion', async () => {
      const provider = testApp.fixtures.createProvider();

      await testApp.request().delete(`/api/v1/providers/${provider.id}`).expect(204);
      await testApp.request().get(`/api/v1/providers/${provider.id}`).expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // Integration: cascade chain
  // -------------------------------------------------------------------------

  describe('DELETE cascade chain (integration)', () => {
    it('deleting a provider cascades to its models and credential; agents survive with modelId=null', async () => {
      // 1. Create provider, model, and credential
      const provider = testApp.fixtures.createProvider({ name: 'Cascade Provider' });
      const model = testApp.fixtures.createModel({ provider_id: provider.id });

      // Insert a credential directly via DB (credentials endpoint is out of scope)
      const now = new Date().toISOString();
      testApp.db.run(
        `INSERT INTO provider_credentials (provider_id, encrypted_value, nonce, masked_preview, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [provider.id, Buffer.from('encrypted'), Buffer.from('nonce'), 'sk-***', now, now],
      );

      // 2. Create an agent that references the model
      const agent = testApp.fixtures.createAgent({ model_id: model.id });

      // Confirm everything exists before the delete
      const modelBefore = testApp.db.get<{ id: string }>(
        'SELECT id FROM models WHERE id = ?',
        [model.id],
      );
      const credBefore = testApp.db.get<{ provider_id: string }>(
        'SELECT provider_id FROM provider_credentials WHERE provider_id = ?',
        [provider.id],
      );
      const agentBefore = testApp.db.get<{ id: string; model_id: string | null }>(
        'SELECT id, model_id FROM agents WHERE id = ?',
        [agent.id],
      );

      expect(modelBefore).toBeDefined();
      expect(credBefore).toBeDefined();
      expect(agentBefore?.model_id).toBe(model.id);

      // 3. Delete the provider
      await testApp
        .request()
        .delete(`/api/v1/providers/${provider.id}`)
        .expect(204);

      // 4. Assert models are gone (ON DELETE CASCADE)
      const modelAfter = testApp.db.get<{ id: string }>(
        'SELECT id FROM models WHERE id = ?',
        [model.id],
      );
      expect(modelAfter).toBeUndefined();

      // 5. Assert credential is gone (ON DELETE CASCADE)
      const credAfter = testApp.db.get<{ provider_id: string }>(
        'SELECT provider_id FROM provider_credentials WHERE provider_id = ?',
        [provider.id],
      );
      expect(credAfter).toBeUndefined();

      // 6. Assert agent still exists but modelId is now null (ON DELETE SET NULL)
      const agentAfter = testApp.db.get<{ id: string; model_id: string | null }>(
        'SELECT id, model_id FROM agents WHERE id = ?',
        [agent.id],
      );
      expect(agentAfter).toBeDefined();
      expect(agentAfter?.model_id).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // All six kinds — base_url enforcement
  // -------------------------------------------------------------------------

  describe('All six provider kinds and baseUrl rule', () => {
    const localKinds = ['ollama', 'lmstudio', 'openai_compatible'] as const;
    const remoteKinds = ['anthropic', 'openai', 'google'] as const;

    for (const kind of localKinds) {
      it(`${kind}: returns 400 when baseUrl is absent`, async () => {
        await testApp
          .request()
          .post('/api/v1/providers')
          .send({ name: `Test ${kind}`, kind })
          .expect(400);
      });

      it(`${kind}: succeeds with a valid http baseUrl`, async () => {
        const res = await testApp
          .request()
          .post('/api/v1/providers')
          .send({ name: `Test ${kind}`, kind, baseUrl: 'http://localhost:9999' })
          .expect(201);
        expect(res.body.kind).toBe(kind);
      });
    }

    for (const kind of remoteKinds) {
      it(`${kind}: succeeds without baseUrl`, async () => {
        const res = await testApp
          .request()
          .post('/api/v1/providers')
          .send({ name: `Test ${kind}`, kind })
          .expect(201);
        expect(res.body.kind).toBe(kind);
      });

      it(`${kind}: succeeds with an optional baseUrl override`, async () => {
        const res = await testApp
          .request()
          .post('/api/v1/providers')
          .send({ name: `Test ${kind} with override`, kind, baseUrl: 'https://proxy.example.com' })
          .expect(201);
        expect(res.body.baseUrl).toBe('https://proxy.example.com');
      });
    }
  });
});
