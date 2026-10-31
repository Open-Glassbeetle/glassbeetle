import http from 'node:http';
import https from 'node:https';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AdapterFactoryService } from '../src/model-adapters/adapter-factory/adapter-factory.service.js';
import { TestDoubleAdapter } from '../src/model-adapters/test/test-double-adapter.js';
import { EncryptionService } from '../src/crypto/encryption/encryption.service.js';
import { createTestApp, type TestApp } from './harness/index.js';

describe('Providers, credentials and models (e2e integration suite)', () => {
  let testApp: TestApp;
  let adapterFactory: AdapterFactoryService;
  let encryptionService: EncryptionService;

  beforeAll(async () => {
    testApp = await createTestApp();
    adapterFactory = testApp.app.get(AdapterFactoryService);
    encryptionService = testApp.app.get(EncryptionService);
  });

  afterAll(async () => {
    adapterFactory.clear();
    await testApp.close();
  });

  beforeEach(() => {
    testApp.reset();
    adapterFactory.clear();
  });

  /**
   * Seed fixture helper: the suite's backbone.
   * provider → models → credential → agent → usage events
   */
  function seedCascadeFixture(overrides?: {
    providerName?: string;
    model1Identifier?: string;
    model2Identifier?: string;
  }) {
    const provider = testApp.fixtures.createProvider({
      name: overrides?.providerName ?? 'Cascade Backbone Provider',
      kind: 'anthropic',
    });

    const model1 = testApp.fixtures.createModel({
      provider_id: provider.id,
      model_identifier: overrides?.model1Identifier ?? 'claude-3-5-sonnet',
      display_name: 'Claude 3.5 Sonnet',
      source: 'manual',
    });

    const model2 = testApp.fixtures.createModel({
      provider_id: provider.id,
      model_identifier: overrides?.model2Identifier ?? 'claude-3-haiku',
      display_name: 'Claude 3 Haiku',
      source: 'discovered',
    });

    const credential = testApp.fixtures.createCredential(provider.id, {
      masked_preview: 'sk-ant-…4f2a',
    });

    const agent = testApp.fixtures.createAgent({
      name: 'Cascade Agent',
      model_id: model1.id,
    });

    const usageEvent = testApp.fixtures.createUsageEvent({
      provider_id: provider.id,
      model_id: model1.id,
      agent_id: agent.id,
      event_type: 'chat_completion',
      input_tokens: 150,
      output_tokens: 75,
      cost_usd: 0.003,
    });

    return { provider, model1, model2, credential, agent, usageEvent };
  }

  // =========================================================================
  // 1. Database Safety & Foreign-Key Enforcement
  // =========================================================================
  describe('Database safety', () => {
    it('has foreign-key enforcement active in the test database', () => {
      const result = testApp.db.get<{ foreign_keys: number }>(
        'PRAGMA foreign_keys',
      );
      expect(result?.foreign_keys).toBe(1);
    });

    it('enforces foreign key constraints by rejecting child rows without parent', () => {
      expect(() => {
        testApp.db.run(
          `INSERT INTO models (id, provider_id, model_identifier, display_name, source, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            'ghost-model-id',
            'ghost-provider-id',
            'ident',
            'Ghost',
            'manual',
            '2026-01-01',
            '2026-01-01',
          ],
        );
      }).toThrow(/FOREIGN KEY/i);
    });
  });

  // =========================================================================
  // 2. Provider Lifecycle (CRUD)
  // =========================================================================
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
      await testApp.request().get('/api/v1/providers?kind=badkind').expect(400);
    });

    it('returns 400 for an invalid sort field', async () => {
      await testApp
        .request()
        .get('/api/v1/providers?sort=notafield')
        .expect(400);
    });
  });

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
        .send({
          name: 'Local Ollama',
          kind: 'ollama',
          baseUrl: 'http://localhost:11434',
        })
        .expect(201);

      expect(res.body.kind).toBe('ollama');
      expect(res.body.isLocal).toBe(true);
      expect(res.body.baseUrl).toBe('http://localhost:11434');
    });

    it('creates an lmstudio provider with a required baseUrl', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/providers')
        .send({
          name: 'LM Studio',
          kind: 'lmstudio',
          baseUrl: 'http://localhost:1234',
        })
        .expect(201);

      expect(res.body.kind).toBe('lmstudio');
      expect(res.body.isLocal).toBe(true);
    });

    it('creates an openai_compatible provider with a required baseUrl', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/providers')
        .send({
          name: 'Custom',
          kind: 'openai_compatible',
          baseUrl: 'https://my-host.example.com/v1',
        })
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
        .send({
          name: 'Bad Scheme',
          kind: 'ollama',
          baseUrl: 'grpc://localhost:9000',
        })
        .expect(400);
    });

    it('always sets isLocal=true for ollama regardless of client value', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/providers')
        .send({
          name: 'Ollama',
          kind: 'ollama',
          baseUrl: 'http://localhost:11434',
          isLocal: false,
        })
        .expect(201);

      expect(res.body.isLocal).toBe(true);
    });

    it('always sets isLocal=true for lmstudio regardless of client value', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/providers')
        .send({
          name: 'LM Studio',
          kind: 'lmstudio',
          baseUrl: 'http://localhost:1234',
          isLocal: false,
        })
        .expect(201);

      expect(res.body.isLocal).toBe(true);
    });

    it('accepts client-supplied isLocal for openai_compatible', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/providers')
        .send({
          name: 'Local Compat',
          kind: 'openai_compatible',
          baseUrl: 'http://192.168.1.10/v1',
          isLocal: true,
        })
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
      const provider = testApp.fixtures.createProvider({
        is_local: 1,
        enabled: 0,
      });

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
      const provider = testApp.fixtures.createProvider({
        kind: 'openai',
        base_url: null,
      });

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
      const provider = testApp.fixtures.createProvider({
        kind: 'anthropic',
        base_url: null,
      });

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

      await new Promise((r) => setTimeout(r, 5));

      const res = await testApp
        .request()
        .patch(`/api/v1/providers/${provider.id}`)
        .send({ name: 'Updated' })
        .expect(200);

      expect(res.body.updatedAt).not.toBe(originalUpdatedAt);
    });

    it('forces isLocal=true when kind is updated to ollama', async () => {
      const provider = testApp.fixtures.createProvider({
        kind: 'anthropic',
        is_local: 0,
      });

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

      await testApp
        .request()
        .delete(`/api/v1/providers/${provider.id}`)
        .expect(204);
      await testApp
        .request()
        .get(`/api/v1/providers/${provider.id}`)
        .expect(404);
    });
  });

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
          .send({
            name: `Test ${kind}`,
            kind,
            baseUrl: 'http://localhost:9999',
          })
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
          .send({
            name: `Test ${kind} with override`,
            kind,
            baseUrl: 'https://proxy.example.com',
          })
          .expect(201);
        expect(res.body.baseUrl).toBe('https://proxy.example.com');
      });
    }
  });

  // =========================================================================
  // 3. The Cascade Chain (Provider Deletion Cascade)
  // =========================================================================
  describe('DELETE cascade chain (integration)', () => {
    it('deleting a provider cascades to its models and credential; agents survive with modelId=null and usage events survive with null references', async () => {
      const fixture = seedCascadeFixture();
      const { provider, model1, agent, usageEvent } = fixture;

      // Verify before deletion: everything exists and references are wired up
      const modelsBefore = testApp.db.all<{ id: string }>(
        'SELECT id FROM models WHERE provider_id = ?',
        [provider.id],
      );
      expect(modelsBefore).toHaveLength(2);

      const credBefore = testApp.db.get<{ provider_id: string }>(
        'SELECT provider_id FROM provider_credentials WHERE provider_id = ?',
        [provider.id],
      );
      expect(credBefore).toBeDefined();

      const agentBefore = testApp.db.get<{
        id: string;
        model_id: string | null;
      }>('SELECT id, model_id FROM agents WHERE id = ?', [agent.id]);
      expect(agentBefore?.model_id).toBe(model1.id);

      const usageBefore = testApp.db.get<{
        id: string;
        provider_id: string | null;
        model_id: string | null;
        agent_id: string | null;
      }>(
        'SELECT id, provider_id, model_id, agent_id FROM usage_events WHERE id = ?',
        [usageEvent.id],
      );
      expect(usageBefore?.provider_id).toBe(provider.id);
      expect(usageBefore?.model_id).toBe(model1.id);
      expect(usageBefore?.agent_id).toBe(agent.id);

      // Execute provider deletion
      await testApp
        .request()
        .delete(`/api/v1/providers/${provider.id}`)
        .expect(204);

      // Assert models are destroyed directly in DB (ON DELETE CASCADE)
      const modelsAfter = testApp.db.all<{ id: string }>(
        'SELECT id FROM models WHERE provider_id = ?',
        [provider.id],
      );
      expect(modelsAfter).toHaveLength(0);

      // Assert credential is destroyed directly in DB (ON DELETE CASCADE)
      const credAfter = testApp.db.get<{ provider_id: string }>(
        'SELECT provider_id FROM provider_credentials WHERE provider_id = ?',
        [provider.id],
      );
      expect(credAfter).toBeUndefined();

      // Assert agent survives with modelId set to null (ON DELETE SET NULL)
      const agentAfter = testApp.db.get<{
        id: string;
        model_id: string | null;
      }>('SELECT id, model_id FROM agents WHERE id = ?', [agent.id]);
      expect(agentAfter).toBeDefined();
      expect(agentAfter?.model_id).toBeNull();

      // Assert usage event survives with providerId=null and modelId=null (ON DELETE SET NULL)
      const usageAfter = testApp.db.get<{
        id: string;
        provider_id: string | null;
        model_id: string | null;
        agent_id: string | null;
      }>(
        'SELECT id, provider_id, model_id, agent_id FROM usage_events WHERE id = ?',
        [usageEvent.id],
      );
      expect(usageAfter).toBeDefined();
      expect(usageAfter?.provider_id).toBeNull();
      expect(usageAfter?.model_id).toBeNull();
      expect(usageAfter?.agent_id).toBe(agent.id);
    });
  });

  // =========================================================================
  // 4. Model Deletion Effects
  // =========================================================================
  describe('Model deletion effects (integration)', () => {
    it('deleting a model leaves dependent agents with modelId=null and usage events with modelId=null', async () => {
      const fixture = seedCascadeFixture();
      const { provider, model1, model2, agent, usageEvent } = fixture;

      // Delete model1 via HTTP endpoint
      await testApp.request().delete(`/api/v1/models/${model1.id}`).expect(204);

      // model1 is gone, model2 still exists
      const m1After = testApp.db.get('SELECT id FROM models WHERE id = ?', [
        model1.id,
      ]);
      expect(m1After).toBeUndefined();
      const m2After = testApp.db.get('SELECT id FROM models WHERE id = ?', [
        model2.id,
      ]);
      expect(m2After).toBeDefined();

      // Provider and credential still exist
      const provAfter = testApp.db.get(
        'SELECT id FROM providers WHERE id = ?',
        [provider.id],
      );
      expect(provAfter).toBeDefined();
      const credAfter = testApp.db.get(
        'SELECT provider_id FROM provider_credentials WHERE provider_id = ?',
        [provider.id],
      );
      expect(credAfter).toBeDefined();

      // Dependent agent survives with model_id = null
      const agentAfter = testApp.db.get<{
        id: string;
        model_id: string | null;
      }>('SELECT id, model_id FROM agents WHERE id = ?', [agent.id]);
      expect(agentAfter).toBeDefined();
      expect(agentAfter?.model_id).toBeNull();

      // Usage event survives with model_id = null, but provider_id and agent_id intact
      const usageAfter = testApp.db.get<{
        id: string;
        provider_id: string | null;
        model_id: string | null;
        agent_id: string | null;
      }>(
        'SELECT id, provider_id, model_id, agent_id FROM usage_events WHERE id = ?',
        [usageEvent.id],
      );
      expect(usageAfter).toBeDefined();
      expect(usageAfter?.provider_id).toBe(provider.id);
      expect(usageAfter?.model_id).toBeNull();
      expect(usageAfter?.agent_id).toBe(agent.id);
    });
  });

  // =========================================================================
  // 5. Credential Leak Boundaries & Security
  // =========================================================================
  describe('Credential leak boundaries and security', () => {
    const sensitiveSecret = 'sk-ant-api03-TOPSECRET-PLAINTEXT-PROBE-4F2A-999';
    const secretSubstring = 'TOPSECRET-PLAINTEXT-PROBE';

    it('asserts GET returns metadata only; no substring of plaintext appears anywhere in response', async () => {
      const provider = testApp.fixtures.createProvider();

      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: sensitiveSecret })
        .expect(200);

      const res = await testApp
        .request()
        .get(`/api/v1/providers/${provider.id}/credential`)
        .expect(200);

      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toContain(sensitiveSecret);
      expect(bodyStr).not.toContain(secretSubstring);
      expect(res.body).toEqual({
        providerId: provider.id,
        configured: true,
        maskedPreview: expect.stringMatching(/^sk-ant-…/),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(res.body).not.toHaveProperty('encryptedValue');
      expect(res.body).not.toHaveProperty('encrypted_value');
      expect(res.body).not.toHaveProperty('nonce');
      expect(res.body).not.toHaveProperty('apiKey');
    });

    it('asserts raw stored encrypted_value in database contains no substring of plaintext', async () => {
      const provider = testApp.fixtures.createProvider();

      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: sensitiveSecret })
        .expect(200);

      const row = testApp.db.get<{ encrypted_value: Buffer }>(
        'SELECT encrypted_value FROM provider_credentials WHERE provider_id = ?',
        [provider.id],
      );

      expect(row).toBeDefined();
      const rawString = row!.encrypted_value.toString('utf-8');
      expect(rawString).not.toContain(sensitiveSecret);
      expect(rawString).not.toContain(secretSubstring);
    });

    it('asserts validation error raised with credential in body does not echo it back', async () => {
      const provider = testApp.fixtures.createProvider();

      const res = await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({
          apiKey: sensitiveSecret,
          forbiddenExtraProperty: 'leakAttempt',
        })
        .expect(400);

      const responseStr = JSON.stringify(res.body);
      expect(responseStr).not.toContain(sensitiveSecret);
      expect(responseStr).not.toContain(secretSubstring);
    });

    it('asserts captured log output across set, get and delete contains no plaintext', async () => {
      const provider = testApp.fixtures.createProvider();
      const logChunks: string[] = [];

      const stdoutSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: any) => {
          logChunks.push(String(chunk));
          return true;
        });
      const stderrSpy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation((chunk: any) => {
          logChunks.push(String(chunk));
          return true;
        });
      const consoleLogSpy = vi
        .spyOn(console, 'log')
        .mockImplementation((...args: any[]) => {
          logChunks.push(args.map(String).join(' '));
        });
      const consoleWarnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation((...args: any[]) => {
          logChunks.push(args.map(String).join(' '));
        });
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation((...args: any[]) => {
          logChunks.push(args.map(String).join(' '));
        });

      try {
        // Set
        await testApp
          .request()
          .put(`/api/v1/providers/${provider.id}/credential`)
          .send({ apiKey: sensitiveSecret })
          .expect(200);

        // Get
        await testApp
          .request()
          .get(`/api/v1/providers/${provider.id}/credential`)
          .expect(200);

        // Delete
        await testApp
          .request()
          .delete(`/api/v1/providers/${provider.id}/credential`)
          .expect(204);

        const logs = logChunks.join('\n');
        expect(logs).not.toContain(sensitiveSecret);
        expect(logs).not.toContain(secretSubstring);
      } finally {
        stdoutSpy.mockRestore();
        stderrSpy.mockRestore();
        consoleLogSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      }
    });

    it('asserts setting the same value twice produces different ciphertext (fresh nonces)', async () => {
      const provider = testApp.fixtures.createProvider();

      // First write
      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: sensitiveSecret })
        .expect(200);

      const firstRow = testApp.db.get<{
        encrypted_value: Buffer;
        nonce: Buffer;
      }>(
        'SELECT encrypted_value, nonce FROM provider_credentials WHERE provider_id = ?',
        [provider.id],
      );

      // Second write with identical secret
      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: sensitiveSecret })
        .expect(200);

      const secondRow = testApp.db.get<{
        encrypted_value: Buffer;
        nonce: Buffer;
      }>(
        'SELECT encrypted_value, nonce FROM provider_credentials WHERE provider_id = ?',
        [provider.id],
      );

      expect(firstRow?.nonce.equals(secondRow!.nonce)).toBe(false);
      expect(firstRow?.encrypted_value.equals(secondRow!.encrypted_value)).toBe(
        false,
      );
    });

    it('asserts PUT upserts rather than creating a second row', async () => {
      const provider = testApp.fixtures.createProvider();

      const firstRes = await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: 'sk-ant-first-key-1111' })
        .expect(200);

      const secondRes = await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: 'sk-ant-second-key-2222' })
        .expect(200);

      const rows = testApp.db.all(
        'SELECT * FROM provider_credentials WHERE provider_id = ?',
        [provider.id],
      );
      expect(rows).toHaveLength(1);
      expect(secondRes.body.createdAt).toBe(firstRes.body.createdAt);
      expect(secondRes.body.maskedPreview).toBe('sk-ant-…2222');
    });

    it('verifies BLOB round-tripping for encrypted_value and nonce intact without string coercion', async () => {
      const provider = testApp.fixtures.createProvider();
      const secret = 'sk-test-blob-round-trip-secret-xyz';

      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: secret })
        .expect(200);

      const row = testApp.db.get<{
        provider_id: string;
        encrypted_value: Buffer;
        nonce: Buffer;
      }>(
        'SELECT provider_id, encrypted_value, nonce FROM provider_credentials WHERE provider_id = ?',
        [provider.id],
      );

      expect(row).toBeDefined();
      expect(Buffer.isBuffer(row?.encrypted_value)).toBe(true);
      expect(Buffer.isBuffer(row?.nonce)).toBe(true);
      expect(row?.nonce.length).toBe(12);

      // Decrypt using driver-read BLOBs: must round-trip successfully
      const decrypted = encryptionService.decrypt(
        row!.encrypted_value,
        row!.nonce,
        provider.id,
      );
      expect(decrypted).toBe(secret);

      // Direct BLOB integrity test with null bytes \0 and high bytes
      const testBufferVal = Buffer.from([
        0x01, 0x00, 0xff, 0xfe, 0x00, 0x42, 0x80,
      ]);
      const testNonceVal = Buffer.from([
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x00,
      ]);
      testApp.db.run(
        `UPDATE provider_credentials SET encrypted_value = ?, nonce = ? WHERE provider_id = ?`,
        [testBufferVal, testNonceVal, provider.id],
      );

      const rawRow = testApp.db.get<{ encrypted_value: Buffer; nonce: Buffer }>(
        'SELECT encrypted_value, nonce FROM provider_credentials WHERE provider_id = ?',
        [provider.id],
      );
      expect(Buffer.isBuffer(rawRow?.encrypted_value)).toBe(true);
      expect(Buffer.isBuffer(rawRow?.nonce)).toBe(true);
      expect(rawRow!.encrypted_value.equals(testBufferVal)).toBe(true);
      expect(rawRow!.nonce.equals(testNonceVal)).toBe(true);
    });
  });

  // =========================================================================
  // 6. Model Scoping & Scoped Uniqueness
  // =========================================================================
  describe('Model scoping and scoped uniqueness', () => {
    it('the same modelIdentifier under two different providers both succeed and are independently addressable', async () => {
      const p1 = testApp.fixtures.createProvider({ name: 'Provider One' });
      const p2 = testApp.fixtures.createProvider({ name: 'Provider Two' });

      const res1 = await testApp
        .request()
        .post(`/api/v1/providers/${p1.id}/models`)
        .send({
          modelIdentifier: 'llama3:8b',
          displayName: 'Llama 3 8B (P1)',
        })
        .expect(201);

      const res2 = await testApp
        .request()
        .post(`/api/v1/providers/${p2.id}/models`)
        .send({
          modelIdentifier: 'llama3:8b',
          displayName: 'Llama 3 8B (P2)',
        })
        .expect(201);

      expect(res1.body.id).not.toBe(res2.body.id);
      expect(res1.body.providerId).toBe(p1.id);
      expect(res2.body.providerId).toBe(p2.id);
      expect(res1.body.modelIdentifier).toBe('llama3:8b');
      expect(res2.body.modelIdentifier).toBe('llama3:8b');

      // Independently addressable
      const get1 = await testApp
        .request()
        .get(`/api/v1/models/${res1.body.id}`)
        .expect(200);
      const get2 = await testApp
        .request()
        .get(`/api/v1/models/${res2.body.id}`)
        .expect(200);
      expect(get1.body.displayName).toBe('Llama 3 8B (P1)');
      expect(get2.body.displayName).toBe('Llama 3 8B (P2)');
    });

    it('a duplicate modelIdentifier under the same provider returns 409 Conflict', async () => {
      const provider = testApp.fixtures.createProvider();

      await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({
          modelIdentifier: 'unique-model',
          displayName: 'Initial Model',
        })
        .expect(201);

      const dupRes = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({
          modelIdentifier: 'unique-model',
          displayName: 'Duplicate Model',
        })
        .expect(409);

      expect(dupRes.body.statusCode).toBe(409);
      expect(dupRes.body.code).toBe('CONFLICT');

      // Only 1 row in DB
      const count = testApp.db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM models WHERE provider_id = ? AND model_identifier = ?',
        [provider.id, 'unique-model'],
      );
      expect(count?.count).toBe(1);
    });
  });

  // =========================================================================
  // 7. Immutable Model Fields
  // =========================================================================
  describe('Immutable model fields', () => {
    it('rejects attempt to change providerId, modelIdentifier, or source and changes nothing', async () => {
      const p1 = testApp.fixtures.createProvider();
      const p2 = testApp.fixtures.createProvider();
      const model = testApp.fixtures.createModel({
        provider_id: p1.id,
        model_identifier: 'immutable-target',
        source: 'manual',
        display_name: 'Original Model',
      });

      // Attempt to change providerId
      await testApp
        .request()
        .patch(`/api/v1/models/${model.id}`)
        .send({ providerId: p2.id })
        .expect(400);

      // Attempt to change modelIdentifier
      await testApp
        .request()
        .patch(`/api/v1/models/${model.id}`)
        .send({ modelIdentifier: 'changed-identifier' })
        .expect(400);

      // Attempt to change source
      await testApp
        .request()
        .patch(`/api/v1/models/${model.id}`)
        .send({ source: 'discovered' })
        .expect(400);

      // Verify row is completely unchanged in DB
      const row = testApp.db.get<{
        provider_id: string;
        model_identifier: string;
        source: string;
        display_name: string;
      }>(
        'SELECT provider_id, model_identifier, source, display_name FROM models WHERE id = ?',
        [model.id],
      );
      expect(row?.provider_id).toBe(p1.id);
      expect(row?.model_identifier).toBe('immutable-target');
      expect(row?.source).toBe('manual');
      expect(row?.display_name).toBe('Original Model');
    });

    it('rejects client attempt to supply source or providerId on model creation', async () => {
      const provider = testApp.fixtures.createProvider();

      await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({
          modelIdentifier: 'm-client-source',
          displayName: 'Model',
          source: 'discovered',
        })
        .expect(400);

      await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({
          modelIdentifier: 'm-client-prov',
          displayName: 'Model',
          providerId: provider.id,
        })
        .expect(400);
    });
  });

  // =========================================================================
  // 8. Discovery Reconciliation (using TestDoubleAdapter)
  // =========================================================================
  describe('Discovery reconciliation (using TestDoubleAdapter)', () => {
    it('discovery adds new models with source = "discovered"', async () => {
      const provider = testApp.fixtures.createProvider({
        kind: 'ollama',
        base_url: 'http://localhost:11434',
      });

      adapterFactory.register(
        'ollama',
        (config) =>
          new TestDoubleAdapter(config, {
            discoveredModels: [
              {
                modelIdentifier: 'qwen2.5:7b',
                displayName: 'Qwen 2.5 7B',
                contextWindow: 32768,
              },
            ],
          }),
      );

      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(200);

      expect(res.body.added).toBe(1);
      expect(res.body.models[0].source).toBe('discovered');
      expect(res.body.models[0].modelIdentifier).toBe('qwen2.5:7b');

      const row = testApp.db.get<{ source: string; model_identifier: string }>(
        'SELECT source, model_identifier FROM models WHERE id = ?',
        [res.body.models[0].id],
      );
      expect(row?.source).toBe('discovered');
      expect(row?.model_identifier).toBe('qwen2.5:7b');
    });

    it('re-running discovery is idempotent', async () => {
      const provider = testApp.fixtures.createProvider({
        kind: 'ollama',
        base_url: 'http://localhost:11434',
      });

      adapterFactory.register(
        'ollama',
        (config) =>
          new TestDoubleAdapter(config, {
            discoveredModels: [
              { modelIdentifier: 'm1', displayName: 'Model 1' },
              { modelIdentifier: 'm2', displayName: 'Model 2' },
            ],
          }),
      );

      // Run 1: adds 2 models
      await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(200);

      const rowsBefore = testApp.db.all<{ id: string; updated_at: string }>(
        'SELECT id, updated_at FROM models WHERE provider_id = ? ORDER BY id',
        [provider.id],
      );

      // Run 2: idempotent
      const res2 = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(200);

      expect(res2.body.added).toBe(0);
      expect(res2.body.updated).toBe(0);
      expect(res2.body.unchanged).toBe(2);
      expect(res2.body.disabled).toBe(0);

      const rowsAfter = testApp.db.all<{ id: string; updated_at: string }>(
        'SELECT id, updated_at FROM models WHERE provider_id = ? ORDER BY id',
        [provider.id],
      );
      expect(rowsAfter).toEqual(rowsBefore);
    });

    it('a manually-registered model is never modified or deleted by discovery', async () => {
      const provider = testApp.fixtures.createProvider({
        kind: 'ollama',
        base_url: 'http://localhost:11434',
      });

      const manualModel = testApp.fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'shared-ident',
        display_name: 'Custom Manual Tuning',
        source: 'manual',
        context_window: 65536,
      });

      adapterFactory.register(
        'ollama',
        (config) =>
          new TestDoubleAdapter(config, {
            discoveredModels: [
              {
                modelIdentifier: 'shared-ident',
                displayName: 'Upstream Attempted Override',
                contextWindow: 16384,
              },
            ],
          }),
      );

      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(200);

      expect(res.body.added).toBe(0);
      expect(res.body.updated).toBe(0);
      expect(res.body.unchanged).toBe(1);

      const row = testApp.db.get<{
        id: string;
        source: string;
        display_name: string;
        context_window: number;
        updated_at: string;
      }>(
        'SELECT id, source, display_name, context_window, updated_at FROM models WHERE id = ?',
        [manualModel.id],
      );
      expect(row?.source).toBe('manual');
      expect(row?.display_name).toBe('Custom Manual Tuning');
      expect(row?.context_window).toBe(65536);
      expect(row?.updated_at).toBe(manualModel.updated_at);
    });

    it('an agent modelId survives a discovery run without detaching (catching delete-and-recreate bug)', async () => {
      const provider = testApp.fixtures.createProvider({
        kind: 'ollama',
        base_url: 'http://localhost:11434',
      });

      // Initial discovery
      adapterFactory.register(
        'ollama',
        (config) =>
          new TestDoubleAdapter(config, {
            discoveredModels: [
              {
                modelIdentifier: 'surviving-model',
                displayName: 'Surviving Model',
              },
            ],
          }),
      );

      const disc1 = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(200);

      const modelId = disc1.body.models[0].id;
      const agent = testApp.fixtures.createAgent({
        name: 'Persistent Agent',
        model_id: modelId,
      });

      // Re-run discovery with updated metadata
      adapterFactory.clear();
      adapterFactory.register(
        'ollama',
        (config) =>
          new TestDoubleAdapter(config, {
            discoveredModels: [
              {
                modelIdentifier: 'surviving-model',
                displayName: 'Surviving Model (Updated)',
                contextWindow: 16384,
              },
            ],
          }),
      );

      await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(200);

      // Assert agent model_id was not nullified
      const agentRow = testApp.db.get<{ id: string; model_id: string | null }>(
        'SELECT id, model_id FROM agents WHERE id = ?',
        [agent.id],
      );
      expect(agentRow?.model_id).toBe(modelId);
    });

    it('a model disappearing upstream is disabled rather than deleted, keeping dependent agents intact', async () => {
      const provider = testApp.fixtures.createProvider({
        kind: 'ollama',
        base_url: 'http://localhost:11434',
      });

      const mPresent = testApp.fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'still-there',
        source: 'discovered',
        enabled: 1,
      });
      const mDisappeared = testApp.fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'disappeared',
        source: 'discovered',
        enabled: 1,
      });

      const agent = testApp.fixtures.createAgent({
        name: 'Agent Using Disappeared',
        model_id: mDisappeared.id,
      });

      // Upstream only has still-there
      adapterFactory.register(
        'ollama',
        (config) =>
          new TestDoubleAdapter(config, {
            discoveredModels: [
              { modelIdentifier: 'still-there', displayName: 'Still There' },
            ],
          }),
      );

      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(200);

      expect(res.body.disabled).toBe(1);

      // DB verification: still-there is enabled (1), disappeared is disabled (0), not deleted
      const mPresentDb = testApp.db.get<{ id: string; enabled: number }>(
        'SELECT id, enabled FROM models WHERE id = ?',
        [mPresent.id],
      );
      expect(mPresentDb?.enabled).toBe(1);

      const mDisappearedDb = testApp.db.get<{ id: string; enabled: number }>(
        'SELECT id, enabled FROM models WHERE id = ?',
        [mDisappeared.id],
      );
      expect(mDisappearedDb).toBeDefined();
      expect(mDisappearedDb?.enabled).toBe(0);

      // Agent is STILL attached
      const agentDb = testApp.db.get<{ id: string; model_id: string | null }>(
        'SELECT id, model_id FROM agents WHERE id = ?',
        [agent.id],
      );
      expect(agentDb?.model_id).toBe(mDisappeared.id);
    });
  });

  // =========================================================================
  // 9. No Outbound Calls from Persistence Endpoints
  // =========================================================================
  describe('No outbound network calls from persistence endpoints', () => {
    it('creating provider, setting credential, and registering model makes zero outbound network calls', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const httpsSpy = vi.spyOn(https, 'request');
      const httpSpy = vi.spyOn(http, 'request');

      try {
        // 1. Create provider
        const provRes = await testApp
          .request()
          .post('/api/v1/providers')
          .send({ name: 'Outbound Probe Provider', kind: 'anthropic' })
          .expect(201);

        const providerId = provRes.body.id;

        // 2. Set credential
        await testApp
          .request()
          .put(`/api/v1/providers/${providerId}/credential`)
          .send({ apiKey: 'sk-ant-outbound-check-1234' })
          .expect(200);

        // 3. Register model
        await testApp
          .request()
          .post(`/api/v1/providers/${providerId}/models`)
          .send({
            modelIdentifier: 'outbound-check-model',
            displayName: 'Outbound Check',
          })
          .expect(201);

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(httpsSpy).not.toHaveBeenCalled();

        for (const call of httpSpy.mock.calls) {
          const options = call[0];
          const host =
            typeof options === 'string'
              ? options
              : options?.host || options?.hostname;
          expect(['127.0.0.1', 'localhost']).toContain(host);
        }
      } finally {
        fetchSpy.mockRestore();
        httpsSpy.mockRestore();
        httpSpy.mockRestore();
      }
    });
  });

  // =========================================================================
  // 10. Not-found and Validation Paths across All Endpoints
  // =========================================================================
  describe('Not-found and validation paths across all endpoints', () => {
    const unknownId = '018f3a9e-0000-7000-8000-000000000000';

    it('returns 404 for unknown provider across provider, credential, and model endpoints', async () => {
      await testApp.request().get(`/api/v1/providers/${unknownId}`).expect(404);
      await testApp
        .request()
        .patch(`/api/v1/providers/${unknownId}`)
        .send({ name: 'X' })
        .expect(404);
      await testApp
        .request()
        .delete(`/api/v1/providers/${unknownId}`)
        .expect(404);

      await testApp
        .request()
        .get(`/api/v1/providers/${unknownId}/credential`)
        .expect(404);
      await testApp
        .request()
        .put(`/api/v1/providers/${unknownId}/credential`)
        .send({ apiKey: 'sk-key' })
        .expect(404);
      await testApp
        .request()
        .delete(`/api/v1/providers/${unknownId}/credential`)
        .expect(404);

      await testApp
        .request()
        .get(`/api/v1/providers/${unknownId}/models`)
        .expect(404);
      await testApp
        .request()
        .post(`/api/v1/providers/${unknownId}/models`)
        .send({ modelIdentifier: 'm', displayName: 'M' })
        .expect(404);
      await testApp
        .request()
        .post(`/api/v1/providers/${unknownId}/models/discover`)
        .expect(404);

      await testApp.request().get(`/api/v1/models/${unknownId}`).expect(404);
      await testApp
        .request()
        .patch(`/api/v1/models/${unknownId}`)
        .send({ displayName: 'X' })
        .expect(404);
      await testApp.request().delete(`/api/v1/models/${unknownId}`).expect(404);
    });

    it('returns 400 for validation errors across endpoints', async () => {
      const provider = testApp.fixtures.createProvider({ kind: 'anthropic' });

      // Invalid provider creation
      await testApp
        .request()
        .post('/api/v1/providers')
        .send({ name: 'No Kind' })
        .expect(400);

      // Invalid credential
      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: '' })
        .expect(400);
      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: '   ' })
        .expect(400);

      // Invalid model creation
      await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({ displayName: 'No Ident' })
        .expect(400);
      await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({ modelIdentifier: 'm', displayName: '' })
        .expect(400);
      await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models`)
        .send({ modelIdentifier: 'm', displayName: 'M', contextWindow: -5 })
        .expect(400);
    });
  });
});
