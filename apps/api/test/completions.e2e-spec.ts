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
  AuthenticationError,
  ConnectionFailedError,
  ContentFilteredError,
  ContextLengthExceededError,
  RateLimitError,
  RequestAbortedError,
  RequestTimeoutError,
} from '../src/model-adapters/errors/index.js';
import { TestDoubleAdapter } from '../src/model-adapters/test/test-double-adapter.js';
import { createTestApp, type TestApp } from './harness/index.js';

describe('Chat Completions: Non-streaming execution (POST /api/v1/chats/:chatId/completions) (e2e)', () => {
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

  /**
   * Helper setting up a standard valid chat execution environment with an OpenAI provider,
   * credential, model, agent, and chat.
   */
  async function setupValidEnvironment(overrides?: {
    cannedContent?: string;
    cannedUsage?: any;
    providerKind?: string;
    isLocal?: number;
    apiKey?: string;
  }) {
    const kind = (overrides?.providerKind ?? 'openai') as any;
    const isLocal = overrides?.isLocal ?? 0;
    const apiKey = overrides?.apiKey ?? 'sk-valid-test-key-0123456789';

    const testDouble = new TestDoubleAdapter(
      { providerKind: kind },
      {
        cannedResponse: {
          content: overrides?.cannedContent ?? 'Hello, I am your AI assistant.',
          finishReason: 'stop',
          ...(overrides && 'cannedUsage' in overrides
            ? { usage: overrides.cannedUsage }
            : {
                usage: {
                  inputTokens: 12,
                  outputTokens: 7,
                  totalTokens: 19,
                },
              }),
        },
      },
    );

    adapterFactory.register(kind, () => testDouble);

    const provider = testApp.fixtures.createProvider({
      kind,
      is_local: isLocal,
      enabled: 1,
    });

    if (isLocal === 0) {
      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey })
        .expect(200);
    }

    const model = testApp.fixtures.createModel({
      provider_id: provider.id,
      model_identifier: 'gpt-4o',
      default_temperature: 0.7,
      default_max_tokens: 2048,
      enabled: 1,
    });

    const agent = testApp.fixtures.createAgent({
      model_id: model.id,
      temperature: 0.8,
      max_tokens: 1024,
    });

    const chat = testApp.fixtures.createChat({
      agent_id: agent.id,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    return { provider, model, agent, chat, testDouble };
  }

  // =========================================================================
  // 1. Happy Path & Persistence
  // =========================================================================
  describe('Successful completion generation and persistence', () => {
    it('generates completion, persists assistant message, advances updated_at, and records usage', async () => {
      const env = await setupValidEnvironment();

      testApp.fixtures.createMessage({
        chat_id: env.chat.id,
        sequence: 1,
        role: 'user',
        content: 'Hi there!',
      });

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${env.chat.id}/completions`)
        .send({})
        .expect(200);

      expect(res.body).toEqual({
        id: expect.any(String),
        chatId: env.chat.id,
        sequence: 2,
        role: 'assistant',
        content: 'Hello, I am your AI assistant.',
        agentId: env.agent.id,
        status: 'complete',
        tokenCount: 7,
        createdAt: expect.any(String),
        usage: {
          inputTokens: 12,
          outputTokens: 7,
          totalTokens: 19,
        },
      });

      // Verify retrievable through the messages endpoint
      const listRes = await testApp
        .request()
        .get(`/api/v1/chats/${env.chat.id}/messages`)
        .expect(200);

      expect(listRes.body.items).toHaveLength(2);
      expect(listRes.body.items[1].id).toBe(res.body.id);
      expect(listRes.body.items[1].role).toBe('assistant');
      expect(listRes.body.items[1].agentId).toBe(env.agent.id);
      expect(listRes.body.items[1].tokenCount).toBe(7);

      // Verify chat updated_at advanced
      const updatedChat = testApp.db.get<{ updated_at: string }>(
        'SELECT updated_at FROM chats WHERE id = ?',
        [env.chat.id],
      );
      expect(updatedChat?.updated_at).not.toBe('2026-01-01T00:00:00.000Z');

      // Verify usage event logged
      const usageRow = testApp.db.get<any>(
        'SELECT * FROM usage_events WHERE chat_id = ? AND agent_id = ?',
        [env.chat.id, env.agent.id],
      );
      expect(usageRow).toBeDefined();
      expect(usageRow.provider_id).toBe(env.provider.id);
      expect(usageRow.model_id).toBe(env.model.id);
      expect(usageRow.input_tokens).toBe(12);
      expect(usageRow.output_tokens).toBe(7);
    });

    it('records null token_count when provider does not report usage', async () => {
      const env = await setupValidEnvironment({
        cannedUsage: undefined,
      });

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${env.chat.id}/completions`)
        .send({})
        .expect(200);

      expect(res.body.tokenCount).toBeNull();
      expect(res.body.usage).toBeNull();

      const savedMsg = testApp.db.get<{ token_count: number | null }>(
        'SELECT token_count FROM messages WHERE id = ?',
        [res.body.id],
      );
      expect(savedMsg?.token_count).toBeNull();
    });

    it('succeeds for local provider without credentials (ollama)', async () => {
      const env = await setupValidEnvironment({
        providerKind: 'ollama',
        isLocal: 1,
      });

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${env.chat.id}/completions`)
        .send({})
        .expect(200);

      expect(res.body.role).toBe('assistant');
      expect(res.body.content).toBe('Hello, I am your AI assistant.');
    });
  });

  // =========================================================================
  // 2. Request Validation (400)
  // =========================================================================
  describe('Request validation (400)', () => {
    it('rejects temperature above 2.0', async () => {
      const env = await setupValidEnvironment();

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${env.chat.id}/completions`)
        .send({ temperature: 2.1 })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
      expect(JSON.stringify(res.body)).toContain('temperature');
    });

    it('rejects negative temperature', async () => {
      const env = await setupValidEnvironment();

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${env.chat.id}/completions`)
        .send({ temperature: -0.1 })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    });

    it('rejects negative maxTokens', async () => {
      const env = await setupValidEnvironment();

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${env.chat.id}/completions`)
        .send({ maxTokens: -10 })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    });

    it('rejects unknown properties in request body', async () => {
      const env = await setupValidEnvironment();

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${env.chat.id}/completions`)
        .send({ unknownExtraProperty: 'forbidden' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    });
  });

  // =========================================================================
  // 3. Execution Chain Resolution & Unrunnable Configurations
  // =========================================================================
  describe('Execution chain resolution & unrunnable configurations', () => {
    it('returns 404 when chat does not exist', async () => {
      const unknownChatId = '018f3a9e-0000-7000-8000-000000000099';

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${unknownChatId}/completions`)
        .send({})
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('CHAT_NOT_FOUND');
      expect(res.body.message).toContain(unknownChatId);
    });

    it('returns 422 when chat is owned by a team (multi-agent not yet supported)', async () => {
      const team = testApp.fixtures.createTeam({ name: 'Engineering Team' });
      const chat = testApp.fixtures.createChat({
        title: 'Team Collaboration',
        team_id: team.id,
        agent_id: null,
      });

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/completions`)
        .send({})
        .expect(422);

      expect(res.body.statusCode).toBe(422);
      expect(res.body.code).toBe('TEAM_CHAT_NOT_SUPPORTED');
      expect(res.body.message).toContain('Multi-agent team chats');
    });

    it('returns 422 when chat has no agent (owning agent was deleted)', async () => {
      const agent = testApp.fixtures.createAgent({ name: 'Deleted Agent' });
      const chat = testApp.fixtures.createChat({ agent_id: agent.id });

      testApp.db.run('PRAGMA ignore_check_constraints = ON;');
      testApp.db.run('UPDATE chats SET agent_id = NULL WHERE id = ?', [chat.id]);
      testApp.db.run('PRAGMA ignore_check_constraints = OFF;');

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/completions`)
        .send({})
        .expect(422);

      expect(res.body.statusCode).toBe(422);
      expect(res.body.code).toBe('CHAT_HAS_NO_AGENT');
      expect(res.body.message).toContain('no assigned agent');
    });

    it('returns 422 when agent has no model configured', async () => {
      const agent = testApp.fixtures.createAgent({
        name: 'Model-less Agent',
        model_id: null,
      });
      const chat = testApp.fixtures.createChat({ agent_id: agent.id });

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/completions`)
        .send({})
        .expect(422);

      expect(res.body.statusCode).toBe(422);
      expect(res.body.code).toBe('AGENT_HAS_NO_MODEL');
      expect(res.body.message).toContain('Model-less Agent');
    });

    it('returns 422 when configured model is disabled', async () => {
      const env = await setupValidEnvironment();
      testApp.db.run('UPDATE models SET enabled = 0 WHERE id = ?', [
        env.model.id,
      ]);

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${env.chat.id}/completions`)
        .send({})
        .expect(422);

      expect(res.body.statusCode).toBe(422);
      expect(res.body.code).toBe('MODEL_DISABLED');
      expect(res.body.message).toContain('disabled');
    });

    it('returns 422 when configured provider is disabled', async () => {
      const env = await setupValidEnvironment();
      testApp.db.run('UPDATE providers SET enabled = 0 WHERE id = ?', [
        env.provider.id,
      ]);

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${env.chat.id}/completions`)
        .send({})
        .expect(422);

      expect(res.body.statusCode).toBe(422);
      expect(res.body.code).toBe('PROVIDER_DISABLED');
      expect(res.body.message).toContain('disabled');
    });

    it('returns 422 when hosted provider credential is missing', async () => {
      const env = await setupValidEnvironment();
      testApp.db.run('DELETE FROM provider_credentials WHERE provider_id = ?', [
        env.provider.id,
      ]);

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${env.chat.id}/completions`)
        .send({})
        .expect(422);

      expect(res.body.statusCode).toBe(422);
      expect(res.body.code).toBe('CREDENTIAL_MISSING');
      expect(res.body.message).toContain('requires an API credential');
    });
  });

  // =========================================================================
  // 4. Override Precedence
  // =========================================================================
  describe('Override precedence (Request Body > Agent Config > Model Defaults)', () => {
    it('applies request body overrides over agent config and model defaults', async () => {
      const env = await setupValidEnvironment();

      const overrideModel = testApp.fixtures.createModel({
        provider_id: env.provider.id,
        model_identifier: 'gpt-4o-mini',
        default_temperature: 0.2,
        default_max_tokens: 500,
        enabled: 1,
      });

      await testApp
        .request()
        .post(`/api/v1/chats/${env.chat.id}/completions`)
        .send({
          modelId: overrideModel.id,
          temperature: 0.0,
          maxTokens: 300,
        })
        .expect(200);

      const capturedReq = env.testDouble.completedRequests[0];
      expect(capturedReq.model).toBe('gpt-4o-mini');
      expect(capturedReq.temperature).toBe(0.0);
      expect(capturedReq.maxTokens).toBe(300);
    });

    it('uses agent configuration when request body provides no overrides', async () => {
      const env = await setupValidEnvironment();

      await testApp
        .request()
        .post(`/api/v1/chats/${env.chat.id}/completions`)
        .send({})
        .expect(200);

      const capturedReq = env.testDouble.completedRequests[0];
      expect(capturedReq.model).toBe('gpt-4o');
      expect(capturedReq.temperature).toBe(0.8);
      expect(capturedReq.maxTokens).toBe(1024);
    });

    it('falls back to model defaults when agent configuration is null', async () => {
      const env = await setupValidEnvironment();
      testApp.db.run(
        'UPDATE agents SET temperature = NULL, max_tokens = NULL WHERE id = ?',
        [env.agent.id],
      );

      await testApp
        .request()
        .post(`/api/v1/chats/${env.chat.id}/completions`)
        .send({})
        .expect(200);

      const capturedReq = env.testDouble.completedRequests[0];
      expect(capturedReq.temperature).toBe(0.7);
      expect(capturedReq.maxTokens).toBe(2048);
    });
  });

  // =========================================================================
  // 5. Context Assembly
  // =========================================================================
  describe('Context assembly', () => {
    it('passes system prompt, instructions, context summary, and history in correct order', async () => {
      const env = await setupValidEnvironment();

      const systemPrompt = testApp.fixtures.createSystemPrompt({
        name: 'Technical Assistant',
        content: 'You are an expert software engineer.',
      });

      testApp.db.run(
        'UPDATE agents SET system_prompt_id = ?, instructions = ? WHERE id = ?',
        [systemPrompt.id, 'Always write TypeScript.', env.agent.id],
      );

      testApp.db.run(
        'UPDATE chats SET context_summary = ? WHERE id = ?',
        ['User is working on issue #63.', env.chat.id],
      );

      testApp.fixtures.createMessage({
        chat_id: env.chat.id,
        sequence: 1,
        role: 'user',
        content: 'How do I test non-streaming execution?',
      });

      testApp.fixtures.createMessage({
        chat_id: env.chat.id,
        sequence: 2,
        role: 'assistant',
        content: 'Use the in-repo test double adapter.',
      });

      testApp.fixtures.createMessage({
        chat_id: env.chat.id,
        sequence: 3,
        role: 'user',
        content: 'Can you show me?',
      });

      await testApp
        .request()
        .post(`/api/v1/chats/${env.chat.id}/completions`)
        .send({})
        .expect(200);

      const req = env.testDouble.completedRequests[0];
      expect(req.systemPrompt).toContain('You are an expert software engineer.');
      expect(req.systemPrompt).toContain('Always write TypeScript.');
      expect(req.systemPrompt).toContain('Context summary:\nUser is working on issue #63.');

      expect(req.messages).toHaveLength(3);
      expect(req.messages[0]).toEqual({
        role: 'user',
        content: 'How do I test non-streaming execution?',
      });
      expect(req.messages[1]).toEqual({
        role: 'assistant',
        content: 'Use the in-repo test double adapter.',
      });
      expect(req.messages[2]).toEqual({
        role: 'user',
        content: 'Can you show me?',
      });
    });

    it('returns assembled context for inspection via GET /api/v1/chats/:chatId/context without invoking provider', async () => {
      const env = await setupValidEnvironment();
      const prompt = testApp.fixtures.createSystemPrompt({
        content: 'You are a debugging assistant.',
      });

      testApp.db.run(
        'UPDATE agents SET system_prompt_id = ?, personality = ?, instructions = ? WHERE id = ?',
        [prompt.id, 'Helpful and patient.', 'Always provide examples.', env.agent.id],
      );

      testApp.db.run(
        'UPDATE chats SET context_summary = ? WHERE id = ?',
        ['Earlier discussed testing setup.', env.chat.id],
      );

      testApp.fixtures.createMessage({
        chat_id: env.chat.id,
        sequence: 1,
        role: 'user',
        content: 'Show me an inspection example.',
      });

      const res = await testApp
        .request()
        .get(`/api/v1/chats/${env.chat.id}/context`)
        .expect(200);

      expect(res.body.systemPrompt).toContain('You are a debugging assistant.');
      expect(res.body.systemPrompt).toContain('Helpful and patient.');
      expect(res.body.systemPrompt).toContain('Always provide examples.');
      expect(res.body.systemPrompt).toContain('Context summary:\nEarlier discussed testing setup.');

      expect(res.body.systemDetails).toBeDefined();
      expect(res.body.systemDetails.promptTemplate).toBe('You are a debugging assistant.');
      expect(res.body.systemDetails.personality).toBe('Helpful and patient.');
      expect(res.body.systemDetails.instructions).toBe('Always provide examples.');
      expect(res.body.systemDetails.contextSummary).toBe('Earlier discussed testing setup.');

      expect(res.body.messages).toHaveLength(1);
      expect(res.body.messages[0]).toEqual({
        role: 'user',
        content: 'Show me an inspection example.',
      });

      expect(res.body.tokenEstimate).toBeDefined();
      expect(res.body.tokenEstimate.fitsContextWindow).toBe(true);

      // Verify zero calls made to model provider
      expect(env.testDouble.completedRequests).toHaveLength(0);

      // Alias route GET /api/v1/chats/:chatId/completions/context also responds identically
      const aliasRes = await testApp
        .request()
        .get(`/api/v1/chats/${env.chat.id}/completions/context`)
        .expect(200);

      expect(aliasRes.body.systemPrompt).toBe(res.body.systemPrompt);
    });
  });

  // =========================================================================
  // 6. Upstream Provider Failure Taxonomy Mapping
  // =========================================================================
  describe('Upstream provider error normalization', () => {
    it('maps RateLimitError to 429 Too Many Requests with Retry-After header', async () => {
      const testDouble = new TestDoubleAdapter(
        { providerKind: 'openai' },
        {
          simulateError: new RateLimitError(
            'Rate limit reached. Please retry in 30 seconds.',
            'openai',
            { retryAfterSeconds: 30 },
          ),
        },
      );
      adapterFactory.register('openai', () => testDouble);

      const provider = testApp.fixtures.createProvider({ kind: 'openai', enabled: 1 });
      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: 'sk-test-key' })
        .expect(200);
      const model = testApp.fixtures.createModel({ provider_id: provider.id, enabled: 1 });
      const agent = testApp.fixtures.createAgent({ model_id: model.id });
      const chat = testApp.fixtures.createChat({ agent_id: agent.id });

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/completions`)
        .send({})
        .expect(429);

      expect(res.body.statusCode).toBe(429);
      expect(res.body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(res.headers['retry-after']).toBe('30');
    });

    it('maps AuthenticationError to 502 Bad Gateway', async () => {
      const testDouble = new TestDoubleAdapter(
        { providerKind: 'openai' },
        {
          simulateError: new AuthenticationError(
            'Invalid API key provided.',
            'openai',
          ),
        },
      );
      adapterFactory.register('openai', () => testDouble);

      const provider = testApp.fixtures.createProvider({ kind: 'openai', enabled: 1 });
      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: 'sk-test-key' })
        .expect(200);
      const model = testApp.fixtures.createModel({ provider_id: provider.id, enabled: 1 });
      const agent = testApp.fixtures.createAgent({ model_id: model.id });
      const chat = testApp.fixtures.createChat({ agent_id: agent.id });

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/completions`)
        .send({})
        .expect(502);

      expect(res.body.statusCode).toBe(502);
      expect(res.body.code).toBe('AUTHENTICATION_FAILED');
    });

    it('maps ConnectionFailedError to 502 Bad Gateway', async () => {
      const testDouble = new TestDoubleAdapter(
        { providerKind: 'ollama' },
        {
          simulateError: new ConnectionFailedError(
            'Ollama daemon is not running at localhost:11434',
            'ollama',
          ),
        },
      );
      adapterFactory.register('ollama', () => testDouble);

      const provider = testApp.fixtures.createProvider({
        kind: 'ollama',
        is_local: 1,
        enabled: 1,
      });
      const model = testApp.fixtures.createModel({ provider_id: provider.id, enabled: 1 });
      const agent = testApp.fixtures.createAgent({ model_id: model.id });
      const chat = testApp.fixtures.createChat({ agent_id: agent.id });

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/completions`)
        .send({})
        .expect(502);

      expect(res.body.statusCode).toBe(502);
      expect(res.body.code).toBe('CONNECTION_FAILED');
    });

    it('maps RequestTimeoutError to 504 Gateway Timeout', async () => {
      const testDouble = new TestDoubleAdapter(
        { providerKind: 'openai' },
        {
          simulateError: new RequestTimeoutError(
            'Model response timed out.',
            'openai',
          ),
        },
      );
      adapterFactory.register('openai', () => testDouble);

      const provider = testApp.fixtures.createProvider({ kind: 'openai', enabled: 1 });
      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: 'sk-test-key' })
        .expect(200);
      const model = testApp.fixtures.createModel({ provider_id: provider.id, enabled: 1 });
      const agent = testApp.fixtures.createAgent({ model_id: model.id });
      const chat = testApp.fixtures.createChat({ agent_id: agent.id });

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/completions`)
        .send({})
        .expect(504);

      expect(res.body.statusCode).toBe(504);
      expect(res.body.code).toBe('REQUEST_TIMEOUT');
    });

    it('maps ContextLengthExceededError to 413 Payload Too Large', async () => {
      const testDouble = new TestDoubleAdapter(
        { providerKind: 'openai' },
        {
          simulateError: new ContextLengthExceededError(
            'Prompt exceeded context window of 128000 tokens.',
            'openai',
          ),
        },
      );
      adapterFactory.register('openai', () => testDouble);

      const provider = testApp.fixtures.createProvider({ kind: 'openai', enabled: 1 });
      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: 'sk-test-key' })
        .expect(200);
      const model = testApp.fixtures.createModel({ provider_id: provider.id, enabled: 1 });
      const agent = testApp.fixtures.createAgent({ model_id: model.id });
      const chat = testApp.fixtures.createChat({ agent_id: agent.id });

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/completions`)
        .send({})
        .expect(413);

      expect(res.body.statusCode).toBe(413);
      expect(res.body.code).toBe('CONTEXT_LENGTH_EXCEEDED');
    });

    it('maps ContentFilteredError to 422 Unprocessable Entity', async () => {
      const testDouble = new TestDoubleAdapter(
        { providerKind: 'openai' },
        {
          simulateError: new ContentFilteredError(
            'Request blocked by safety filters.',
            'openai',
          ),
        },
      );
      adapterFactory.register('openai', () => testDouble);

      const provider = testApp.fixtures.createProvider({ kind: 'openai', enabled: 1 });
      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: 'sk-test-key' })
        .expect(200);
      const model = testApp.fixtures.createModel({ provider_id: provider.id, enabled: 1 });
      const agent = testApp.fixtures.createAgent({ model_id: model.id });
      const chat = testApp.fixtures.createChat({ agent_id: agent.id });

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/completions`)
        .send({})
        .expect(422);

      expect(res.body.statusCode).toBe(422);
      expect(res.body.code).toBe('CONTENT_FILTERED');
    });
  });

  // =========================================================================
  // 7. Zero Credential Leakage Boundary
  // =========================================================================
  describe('Zero credential leak boundaries across responses, errors, and logs', () => {
    const sensitiveKey = 'sk-ant-TOPSECRET-PLAINTEXT-PROBE-4F2A-999';
    const keySubstring = 'TOPSECRET-PLAINTEXT-PROBE';

    it('ensures secret never appears in successful completion response or logs', async () => {
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

      try {
        const env = await setupValidEnvironment({ apiKey: sensitiveKey });

        const res = await testApp
          .request()
          .post(`/api/v1/chats/${env.chat.id}/completions`)
          .send({})
          .expect(200);

        const bodyStr = JSON.stringify(res.body);
        expect(bodyStr).not.toContain(sensitiveKey);
        expect(bodyStr).not.toContain(keySubstring);

        const allLogs = logChunks.join('');
        expect(allLogs).not.toContain(sensitiveKey);
        expect(allLogs).not.toContain(keySubstring);
      } finally {
        stdoutSpy.mockRestore();
        stderrSpy.mockRestore();
      }
    });

    it('ensures secret never appears in provider error response or logs', async () => {
      const testDouble = new TestDoubleAdapter(
        { providerKind: 'openai' },
        {
          simulateError: new AuthenticationError(
            `Authentication failed for token ${sensitiveKey}`,
            'openai',
          ),
        },
      );
      adapterFactory.register('openai', () => testDouble);

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

      try {
        const provider = testApp.fixtures.createProvider({ kind: 'openai', enabled: 1 });
        await testApp
          .request()
          .put(`/api/v1/providers/${provider.id}/credential`)
          .send({ apiKey: sensitiveKey })
          .expect(200);
        const model = testApp.fixtures.createModel({ provider_id: provider.id, enabled: 1 });
        const agent = testApp.fixtures.createAgent({ model_id: model.id });
        const chat = testApp.fixtures.createChat({ agent_id: agent.id });

        const res = await testApp
          .request()
          .post(`/api/v1/chats/${chat.id}/completions`)
          .send({})
          .expect(502);

        const bodyStr = JSON.stringify(res.body);
        expect(bodyStr).not.toContain(sensitiveKey);
        expect(bodyStr).not.toContain(keySubstring);

        const allLogs = logChunks.join('');
        expect(allLogs).not.toContain(sensitiveKey);
        expect(allLogs).not.toContain(keySubstring);
      } finally {
        stdoutSpy.mockRestore();
        stderrSpy.mockRestore();
      }
    });
  });

  // =========================================================================
  // 8. Persistence Failure Handling (500)
  // =========================================================================
  describe('Provider success but persistence failure handling', () => {
    it('returns 500 PERSISTENCE_FAILED when database insert fails after provider completion', async () => {
      const env = await setupValidEnvironment();

      // Trigger fails message insert deliberately
      testApp.db.run(`
        CREATE TRIGGER fail_insert BEFORE INSERT ON messages
        BEGIN
          SELECT RAISE(FAIL, 'Disk full: unable to append message');
        END;
      `);

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${env.chat.id}/completions`)
        .send({})
        .expect(500);

      expect(res.body.statusCode).toBe(500);
      expect(res.body.code).toBe('PERSISTENCE_FAILED');
      expect(res.body.message).toContain('failed to persist');
    });
  });

  // =========================================================================
  // 9. Client Cancellation & Abort Propagation
  // =========================================================================
  describe('Client cancellation propagation', () => {
    it('aborts upstream adapter when client disconnects prematurely', async () => {
      let adapterSignalAborted = false;
      const delayedAdapter: any = {
        capabilities: { supportsStreaming: true, supportsDiscovery: true },
        complete: async (_req: any, options?: any) => {
          return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              resolve({
                content: 'Delayed response',
                finishReason: 'stop',
                model: 'test-model',
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              });
            }, 500);

            options?.signal?.addEventListener('abort', () => {
              adapterSignalAborted = true;
              clearTimeout(timeout);
              reject(new RequestAbortedError('Aborted by client', 'openai'));
            });
          });
        },
      };

      adapterFactory.register('openai', () => delayedAdapter);

      const provider = testApp.fixtures.createProvider({ kind: 'openai', enabled: 1 });
      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: 'sk-test-key' })
        .expect(200);
      const model = testApp.fixtures.createModel({ provider_id: provider.id, enabled: 1 });
      const agent = testApp.fixtures.createAgent({ model_id: model.id });
      const chat = testApp.fixtures.createChat({ agent_id: agent.id });

      const req = testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/completions`)
        .send({});

      // Abort after 50ms before completion resolves
      setTimeout(() => {
        req.abort();
      }, 50);

      try {
        await req;
      } catch {
        // Expected client abort / socket reset error
      }

      // Wait a moment for the abort listener to trigger
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(adapterSignalAborted).toBe(true);
    });
  });
});
