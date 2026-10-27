import { Logger } from '@nestjs/common';
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
import {
  ProviderUnavailableError,
  RequestAbortedError,
  UnsupportedCapabilityError,
} from '../src/model-adapters/errors/index.js';
import { AnthropicAdapter } from '../src/model-adapters/anthropic/anthropic.adapter.js';
import { TestDoubleAdapter } from '../src/model-adapters/test/test-double-adapter.js';
import { createTestApp, type TestApp } from './harness/index.js';

describe('Model discovery endpoint (POST /api/v1/providers/:providerId/models/discover) (e2e)', () => {
  let testApp: TestApp;
  let adapterFactory: AdapterFactoryService;

  beforeAll(async () => {
    testApp = await createTestApp();
    adapterFactory = testApp.app.get(AdapterFactoryService);
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(() => {
    testApp.reset();
    adapterFactory.clear();
  });

  const unknownProviderId = '018f3a9e-0000-7000-8000-000000000000';

  // 1. Unknown provider handling (404)
  describe('Provider existence check', () => {
    it('returns 404 if provider does not exist', async () => {
      const res = await testApp
        .request()
        .post(`/api/v1/providers/${unknownProviderId}/models/discover`)
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
      expect(res.body.message).toContain(unknownProviderId);
    });
  });

  // 2. Provider configuration validation (400)
  describe('Provider configuration validation (400)', () => {
    it('returns 400 when local provider (ollama) is missing base_url', async () => {
      // Create provider directly in DB without base_url
      const provider = testApp.fixtures.createProvider({
        kind: 'ollama',
        base_url: null,
      });

      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
      expect(res.body.message).toContain('base_url is required');
    });

    it('returns 400 when hosted provider (openai) has no credentials configured', async () => {
      const provider = testApp.fixtures.createProvider({
        kind: 'openai',
        base_url: null,
      });

      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
      expect(res.body.message).toContain('credentials are required');
    });

    it('succeeds for local provider (ollama) with base_url and no credentials', async () => {
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
                modelIdentifier: 'qwen2.5:14b',
                displayName: 'Qwen 2.5 14B',
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
      expect(res.body.models[0].modelIdentifier).toBe('qwen2.5:14b');
    });
  });

  // 3. Adapter capability checks (501)
  describe('Discovery capability checks (501)', () => {
    it('returns 501 DISCOVERY_NOT_SUPPORTED when provider kind has no registered adapter', async () => {
      const provider = testApp.fixtures.createProvider({
        kind: 'ollama',
        base_url: 'http://localhost:11434',
      });
      // adapterFactory is empty

      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(501);

      expect(res.body.statusCode).toBe(501);
      expect(res.body.code).toBe('DISCOVERY_NOT_SUPPORTED');
      expect(res.body.message).toContain('does not support model discovery');
    });

    it('returns 501 when adapter explicitly reports supportsDiscovery = false', async () => {
      const provider = testApp.fixtures.createProvider({
        kind: 'openai_compatible',
        base_url: 'http://localhost:8080',
      });

      adapterFactory.register(
        'openai_compatible',
        (config) =>
          new TestDoubleAdapter(config, {
            capabilities: { supportsDiscovery: false },
          }),
      );

      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(501);

      expect(res.body.statusCode).toBe(501);
      expect(res.body.code).toBe('DISCOVERY_NOT_SUPPORTED');
    });

    it('returns 501 when adapter throws UnsupportedCapabilityError', async () => {
      const provider = testApp.fixtures.createProvider({
        kind: 'openai_compatible',
        base_url: 'http://localhost:8080',
      });

      adapterFactory.register('openai_compatible', (config) => {
        const adapter = new TestDoubleAdapter(config);
        adapter.discoverModels = async () => {
          throw new UnsupportedCapabilityError(
            'discovery',
            'openai_compatible',
          );
        };
        return adapter;
      });

      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(501);

      expect(res.body.statusCode).toBe(501);
      expect(res.body.code).toBe('DISCOVERY_NOT_SUPPORTED');
    });
  });

  // 4. Discovery against an empty models table adds all reported models
  describe('Successful initial discovery', () => {
    it('adds all reported models with source = "discovered" into empty table', async () => {
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
                modelIdentifier: 'qwen2.5:14b',
                displayName: 'Qwen 2.5 14B',
                contextWindow: 32768,
                defaultTemperature: 0.7,
                defaultMaxTokens: 4096,
              },
              {
                modelIdentifier: 'llama3.2:3b',
                displayName: 'Llama 3.2 3B',
                contextWindow: 128000,
                defaultTemperature: 0.6,
                defaultMaxTokens: 2048,
              },
            ],
          }),
      );

      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(200);

      expect(res.body).toEqual({
        added: 2,
        updated: 0,
        unchanged: 0,
        disabled: 0,
        models: expect.arrayContaining([
          expect.objectContaining({
            providerId: provider.id,
            modelIdentifier: 'qwen2.5:14b',
            displayName: 'Qwen 2.5 14B',
            source: 'discovered',
            contextWindow: 32768,
            defaultTemperature: 0.7,
            defaultMaxTokens: 4096,
            enabled: true,
          }),
          expect.objectContaining({
            providerId: provider.id,
            modelIdentifier: 'llama3.2:3b',
            displayName: 'Llama 3.2 3B',
            source: 'discovered',
            contextWindow: 128000,
            defaultTemperature: 0.6,
            defaultMaxTokens: 2048,
            enabled: true,
          }),
        ]),
      });

      // Verify in SQLite database
      const rows = testApp.db.all<{
        id: string;
        model_identifier: string;
        source: string;
        enabled: number;
      }>('SELECT * FROM models WHERE provider_id = ?', [provider.id]);

      expect(rows).toHaveLength(2);
      expect(
        rows.every((r) => r.source === 'discovered' && r.enabled === 1),
      ).toBe(true);
    });
  });

  // 5. Idempotency: re-running discovery with same upstream response
  describe('Idempotency & unchanged detection', () => {
    it('running twice with identical upstream response changes nothing and reports all unchanged', async () => {
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
                modelIdentifier: 'qwen2.5:14b',
                displayName: 'Qwen 2.5 14B',
                contextWindow: 32768,
              },
              {
                modelIdentifier: 'llama3.2:3b',
                displayName: 'Llama 3.2 3B',
                contextWindow: 128000,
              },
            ],
          }),
      );

      // First run: adds 2
      const firstRes = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(200);
      expect(firstRes.body.added).toBe(2);

      const rowsBefore = testApp.db.all<{
        id: string;
        updated_at: string;
      }>(
        'SELECT id, updated_at FROM models WHERE provider_id = ? ORDER BY id',
        [provider.id],
      );

      // Second run: reports 0 added, 0 updated, 2 unchanged, 0 disabled
      const secondRes = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(200);

      expect(secondRes.body).toEqual({
        added: 0,
        updated: 0,
        unchanged: 2,
        disabled: 0,
        models: expect.any(Array),
      });

      const rowsAfter = testApp.db.all<{
        id: string;
        updated_at: string;
      }>(
        'SELECT id, updated_at FROM models WHERE provider_id = ? ORDER BY id',
        [provider.id],
      );

      // Zero writes performed: updated_at timestamps remain identical
      expect(rowsAfter).toEqual(rowsBefore);
    });
  });

  // 6. Manual model preservation (CRITICAL TEST)
  describe('Manual model preservation', () => {
    it('never modifies or deletes a manually registered model, even with matching modelIdentifier', async () => {
      const provider = testApp.fixtures.createProvider({
        kind: 'ollama',
        base_url: 'http://localhost:11434',
      });

      // User manually registered model
      const manualModel = testApp.fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'qwen2.5:14b',
        display_name: 'Custom User Fine-Tuned Qwen',
        source: 'manual',
        context_window: 65536,
        default_temperature: 0.2,
        enabled: 1,
      });

      // Provider discovery returns the same model identifier
      adapterFactory.register(
        'ollama',
        (config) =>
          new TestDoubleAdapter(config, {
            discoveredModels: [
              {
                modelIdentifier: 'qwen2.5:14b',
                displayName: 'Upstream Stock Qwen 2.5',
                contextWindow: 32768,
                defaultTemperature: 0.7,
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
      expect(res.body.disabled).toBe(0);

      // Verify row in SQLite was left completely untouched
      const rowInDb = testApp.db.get<{
        id: string;
        display_name: string;
        source: string;
        context_window: number;
        default_temperature: number;
        created_at: string;
        updated_at: string;
      }>('SELECT * FROM models WHERE id = ?', [manualModel.id]);

      expect(rowInDb).toBeDefined();
      expect(rowInDb?.id).toBe(manualModel.id);
      expect(rowInDb?.source).toBe('manual');
      expect(rowInDb?.display_name).toBe('Custom User Fine-Tuned Qwen');
      expect(rowInDb?.context_window).toBe(65536);
      expect(rowInDb?.default_temperature).toBe(0.2);
      expect(rowInDb?.updated_at).toBe(manualModel.updated_at);
    });
  });

  // 7. Agent model reference survival
  describe('Agent model reference survival', () => {
    it('agent pointing at a discovered model survives discovery run without detaching', async () => {
      const provider = testApp.fixtures.createProvider({
        kind: 'ollama',
        base_url: 'http://localhost:11434',
      });

      // 1. Initial discovery adds discovered model
      adapterFactory.register(
        'ollama',
        (config) =>
          new TestDoubleAdapter(config, {
            discoveredModels: [
              {
                modelIdentifier: 'qwen2.5:14b',
                displayName: 'Qwen 2.5 14B',
              },
            ],
          }),
      );

      const discRes = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(200);

      const discoveredModelId = discRes.body.models[0].id;

      // 2. Seed an agent pointing at this discovered model
      const agent = testApp.fixtures.createAgent({
        name: 'Research Assistant',
        model_id: discoveredModelId,
      });

      // 3. Re-run discovery with updated metadata upstream
      adapterFactory.clear();
      adapterFactory.register(
        'ollama',
        (config) =>
          new TestDoubleAdapter(config, {
            discoveredModels: [
              {
                modelIdentifier: 'qwen2.5:14b',
                displayName: 'Qwen 2.5 14B (Updated)',
                contextWindow: 32768,
              },
            ],
          }),
      );

      const secondDiscRes = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(200);

      expect(secondDiscRes.body.updated).toBe(1);

      // 4. Assert agent STILL points to the model (was not set to NULL)
      const agentInDb = testApp.db.get<{ id: string; model_id: string | null }>(
        'SELECT id, model_id FROM agents WHERE id = ?',
        [agent.id],
      );

      expect(agentInDb?.model_id).toBe(discoveredModelId);
    });
  });

  // 8. Model that disappears upstream
  describe('Disappeared upstream models handling', () => {
    it('disables disappeared models (enabled = 0) and does not detach agents', async () => {
      const provider = testApp.fixtures.createProvider({
        kind: 'ollama',
        base_url: 'http://localhost:11434',
      });

      // 1. Seed two discovered models
      const m1 = testApp.fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'still-present-model',
        source: 'discovered',
        enabled: 1,
      });
      const m2 = testApp.fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'disappeared-model',
        source: 'discovered',
        enabled: 1,
      });

      // 2. Seed agent pointing at disappeared model
      const agent = testApp.fixtures.createAgent({
        name: 'Agent Using Disappeared Model',
        model_id: m2.id,
      });

      // 3. Upstream only returns m1 now
      adapterFactory.register(
        'ollama',
        (config) =>
          new TestDoubleAdapter(config, {
            discoveredModels: [
              {
                modelIdentifier: 'still-present-model',
                displayName: 'Still Present Model',
              },
            ],
          }),
      );

      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(200);

      expect(res.body.disabled).toBe(1);
      expect(res.body.updated).toBe(1);

      // 4. Verify in DB: m1 remains active (1), m2 is disabled (0), NOT deleted!
      const m1InDb = testApp.db.get<{ id: string; enabled: number }>(
        'SELECT id, enabled FROM models WHERE id = ?',
        [m1.id],
      );
      expect(m1InDb?.enabled).toBe(1);

      const m2InDb = testApp.db.get<{ id: string; enabled: number }>(
        'SELECT id, enabled FROM models WHERE id = ?',
        [m2.id],
      );
      expect(m2InDb).toBeDefined();
      expect(m2InDb?.enabled).toBe(0);

      // 5. Verify agent still references m2.id (not set to NULL!)
      const agentInDb = testApp.db.get<{ id: string; model_id: string | null }>(
        'SELECT id, model_id FROM agents WHERE id = ?',
        [agent.id],
      );
      expect(agentInDb?.model_id).toBe(m2.id);

      // 6. Running discovery again with the same missing model reports it unchanged
      const rerunRes = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(200);

      expect(rerunRes.body.disabled).toBe(0);
      expect(rerunRes.body.unchanged).toBe(2); // m1 unchanged, m2 already disabled -> unchanged
    });
  });

  // 9. Timeout handling (504)
  describe('Timeout handling (504)', () => {
    it('returns 504 GATEWAY_TIMEOUT when discovery aborts or times out', async () => {
      const provider = testApp.fixtures.createProvider({
        kind: 'ollama',
        base_url: 'http://localhost:11434',
      });

      adapterFactory.register('ollama', (config) => {
        const adapter = new TestDoubleAdapter(config);
        adapter.discoverModels = async (opts) => {
          if (opts?.signal) {
            await new Promise((_, reject) => {
              opts.signal?.addEventListener('abort', () => {
                reject(
                  new RequestAbortedError('Discovery timed out', 'ollama'),
                );
              });
            });
          }
          return [];
        };
        return adapter;
      });

      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .send({ timeoutMs: 50 })
        .expect(504);

      expect(res.body.statusCode).toBe(504);
      expect(res.body.code).toBe('GATEWAY_TIMEOUT');
      expect(res.body.message).toContain('timed out');
    });
  });

  // 10. Upstream error & malformed data handling (502)
  describe('Upstream error & malformed data handling (502)', () => {
    it('returns 502 BAD_GATEWAY and writes nothing when adapter returns malformed data', async () => {
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
                modelIdentifier: '', // invalid empty identifier
                displayName: 'Invalid',
              },
            ],
          }),
      );

      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(502);

      expect(res.body.statusCode).toBe(502);
      expect(res.body.code).toBe('BAD_GATEWAY');

      // Table is empty
      const rows = testApp.db.all(
        'SELECT * FROM models WHERE provider_id = ?',
        [provider.id],
      );
      expect(rows).toHaveLength(0);
    });

    it('returns 502 BAD_GATEWAY when provider is unreachable', async () => {
      const provider = testApp.fixtures.createProvider({
        kind: 'ollama',
        base_url: 'http://localhost:11434',
      });

      adapterFactory.register(
        'ollama',
        (config) =>
          new TestDoubleAdapter(config, {
            simulateError: new ProviderUnavailableError(
              'Connection refused: http://localhost:11434',
              'ollama',
            ),
          }),
      );

      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(502);

      expect(res.body.statusCode).toBe(502);
      expect(res.body.code).toBe('BAD_GATEWAY');
    });
  });

  // 11. Credential & raw body leak prevention
  describe('Credential and sensitive data protection', () => {
    it('never leaks credential or raw upstream error bodies into response or logs', async () => {
      const secretApiKey = 'sk-live-secret-super-confidential-token-98765';

      const provider = testApp.fixtures.createProvider({
        kind: 'openai',
        base_url: 'https://api.openai.com',
      });

      // Set credential
      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: secretApiKey })
        .expect(200);

      // Adapter fails with an error that might contain the secret API key in its message
      adapterFactory.register(
        'openai',
        (config) =>
          new TestDoubleAdapter(config, {
            simulateError: new Error(
              `Upstream 401 Unauthorized for token: ${config.apiKey}. Raw body: {"account":{"id":"12345"}}`,
            ),
          }),
      );

      const warnSpy = vi.spyOn(Logger.prototype, 'warn');
      const errorSpy = vi.spyOn(Logger.prototype, 'error');

      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(502);

      // Assert response body does NOT leak API key or raw body
      const responseText = JSON.stringify(res.body);
      expect(responseText).not.toContain(secretApiKey);
      expect(responseText).not.toContain('{"account"');

      // Assert logs do NOT leak API key
      for (const call of [...warnSpy.mock.calls, ...errorSpy.mock.calls]) {
        const logContent = call.map((c) => String(c)).join(' ');
        expect(logContent).not.toContain(secretApiKey);
      }

      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  // 12. Transactionality
  describe('Transactional rollback on failure', () => {
    it('mid-way reconciliation failure rolls back transaction leaving models table unchanged', async () => {
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
                modelIdentifier: 'model-1',
                displayName: 'Model 1',
              },
              {
                modelIdentifier: 'model-2',
                displayName: 'Model 2',
              },
            ],
          }),
      );

      // Force a mid-way failure during the transaction by intercepting db.run
      const originalRun = testApp.db.run.bind(testApp.db);
      let runCallCount = 0;
      const runSpy = vi
        .spyOn(testApp.db, 'run')
        .mockImplementation((sql, params) => {
          runCallCount++;
          if (runCallCount === 2) {
            throw new Error('Simulated mid-reconciliation disk error');
          }
          return originalRun(sql, params);
        });

      await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(500);

      runSpy.mockRestore();

      // Assert that model-1 was rolled back and 0 models exist in table
      const rows = testApp.db.all(
        'SELECT * FROM models WHERE provider_id = ?',
        [provider.id],
      );
      expect(rows).toHaveLength(0);
    });

    it('discovers Anthropic models and reconciles them into database using AnthropicAdapter', async () => {
      const provider = testApp.fixtures.createProvider({
        kind: 'anthropic',
      });
      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: 'sk-ant-test-key-mock' })
        .expect(200);

      adapterFactory.register('anthropic', (config) => new AnthropicAdapter(config));

      const mockAnthropicResponse = {
        data: [
          {
            type: 'model',
            id: 'claude-3-5-sonnet-20241022',
            display_name: 'Claude 3.5 Sonnet',
            created_at: '2024-10-22T00:00:00Z',
            context_window: 200000,
            max_tokens: 8192,
            default_temperature: 1.0,
          },
          {
            type: 'model',
            id: 'claude-3-5-haiku-20241022',
            display_name: 'Claude 3.5 Haiku',
            created_at: '2024-10-22T00:00:00Z',
            context_window: 200000,
            max_tokens: 8192,
          },
        ],
        has_more: false,
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockAnthropicResponse), { status: 200 }),
      );

      const res = await testApp
        .request()
        .post(`/api/v1/providers/${provider.id}/models/discover`)
        .expect(200);

      expect(res.body.added).toBe(2);
      expect(res.body.models.map((m: any) => m.modelIdentifier)).toEqual(
        expect.arrayContaining([
          'claude-3-5-sonnet-20241022',
          'claude-3-5-haiku-20241022',
        ]),
      );
      const sonnet = res.body.models.find(
        (m: any) => m.modelIdentifier === 'claude-3-5-sonnet-20241022',
      );
      expect(sonnet.contextWindow).toBe(200000);
      expect(sonnet.defaultMaxTokens).toBe(8192);

      fetchSpy.mockRestore();
    });
  });
});
