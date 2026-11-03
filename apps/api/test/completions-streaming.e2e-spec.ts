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
  RateLimitError,
  RequestAbortedError,
} from '../src/model-adapters/errors/index.js';
import { TestDoubleAdapter } from '../src/model-adapters/test/test-double-adapter.js';
import { parseSseEvents } from '../src/modules/chats/completions/dto/index.js';
import { createTestApp, type TestApp } from './harness/index.js';

describe('Chat completions: streaming (POST /api/v1/chats/:chatId/completions) (e2e)', () => {
  let testApp: TestApp;
  let adapterFactory: AdapterFactoryService;

  beforeAll(async () => {
    testApp = await createTestApp();
    await testApp.app.listen(0);
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
    streamChunkSize?: number;
    streamDelayMs?: number;
    failAfterChunks?: number;
    simulateError?: Error;
  }) {
    const kind = (overrides?.providerKind ?? 'openai') as any;
    const isLocal = overrides?.isLocal ?? 0;
    const apiKey = overrides?.apiKey ?? 'sk-valid-test-key-0123456789';

    const testDouble = new TestDoubleAdapter(
      { providerKind: kind },
      {
        cannedResponse: {
          content:
            overrides?.cannedContent ?? 'Hello from the streaming agent!',
          finishReason: 'stop',
          ...(overrides && 'cannedUsage' in overrides
            ? { usage: overrides.cannedUsage }
            : {
                usage: {
                  inputTokens: 14,
                  outputTokens: 6,
                  totalTokens: 20,
                },
              }),
        },
        streamChunkSize: overrides?.streamChunkSize ?? 6,
        streamDelayMs: overrides?.streamDelayMs,
        failAfterChunks: overrides?.failAfterChunks,
        simulateError: overrides?.simulateError,
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
      instructions: 'You are a helpful assistant.',
    });

    const chat = testApp.fixtures.createChat({
      agent_id: agent.id,
      title: 'Streaming Test Chat',
    });

    return { provider, model, agent, chat, testDouble };
  }

  // =========================================================================
  // 1. Full Streaming Completion Workflow
  // =========================================================================
  describe('Full streaming completion flow', () => {
    it('streams SSE events with stream=true in request body and completes row', async () => {
      const env = await setupValidEnvironment({
        cannedContent: 'Hello world!',
        cannedUsage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      });

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${env.chat.id}/completions`)
        .send({ stream: true })
        .expect(200);

      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.headers['cache-control']).toBe('no-cache, no-transform');

      const events = parseSseEvents(res.text);
      expect(events.length).toBeGreaterThanOrEqual(4);

      // 1. message_start
      expect(events[0].type).toBe('message_start');
      expect(events[0].data).toMatchObject({
        chatId: env.chat.id,
        sequence: 1,
        agentId: env.agent.id,
        role: 'assistant',
      });
      const messageId = events[0].data.messageId;

      // 2. tokens
      const tokenEvents = events.filter((e) => e.type === 'token');
      expect(tokenEvents.length).toBeGreaterThan(0);
      const combinedText = tokenEvents.map((e) => e.data.text).join('');
      expect(combinedText).toBe('Hello world!');

      // 3. usage
      const usageEvent = events.find((e) => e.type === 'usage');
      expect(usageEvent).toBeDefined();
      expect(usageEvent?.data).toEqual({
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
      });

      // 4. message_complete
      const completeEvent = events.find((e) => e.type === 'message_complete');
      expect(completeEvent).toBeDefined();
      expect(completeEvent?.data).toMatchObject({
        messageId,
        status: 'complete',
        tokenCount: 2,
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      });

      // 5. done
      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();
      expect(doneEvent?.data).toBe('[DONE]');

      // Check database row
      const messageRow = testApp.db.get<any>(
        'SELECT * FROM messages WHERE id = ?',
        [messageId],
      );
      expect(messageRow).toBeDefined();
      expect(messageRow.status).toBe('complete');
      expect(messageRow.content).toBe('Hello world!');
      expect(messageRow.token_count).toBe(2);

      // Check usage_events recorded
      const usageRow = testApp.db.get<any>(
        'SELECT * FROM usage_events WHERE chat_id = ?',
        [env.chat.id],
      );
      expect(usageRow).toBeDefined();
      expect(usageRow.input_tokens).toBe(10);
      expect(usageRow.output_tokens).toBe(2);
    });

    it('streams SSE events when requested via Accept: text/event-stream header', async () => {
      const env = await setupValidEnvironment({
        cannedContent: 'Streamed via header',
      });

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${env.chat.id}/completions`)
        .set('Accept', 'text/event-stream')
        .send({})
        .expect(200);

      expect(res.headers['content-type']).toContain('text/event-stream');
      const events = parseSseEvents(res.text);
      expect(events[0].type).toBe('message_start');
      expect(events.some((e) => e.type === 'token')).toBe(true);
      expect(events.some((e) => e.type === 'done')).toBe(true);
    });
  });

  // =========================================================================
  // 2. Observable States & Messages List Integration
  // =========================================================================
  describe('State machine observability and messages list integration', () => {
    it('makes row observable in messages list endpoint during and after generation', async () => {
      let releaseStream!: () => void;
      const pausePromise = new Promise<void>((resolve) => {
        releaseStream = resolve;
      });

      const pausingAdapter: any = {
        capabilities: { supportsStreaming: true, supportsDiscovery: true },
        stream: async function* () {
          yield { type: 'text-delta', delta: 'In-flight text' };
          // Pause generation here so the test can observe the in-flight row
          await pausePromise;
          yield { type: 'text-delta', delta: ' and final text.' };
          yield {
            type: 'complete',
            finishReason: 'stop',
            usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
          };
        },
      };

      adapterFactory.register('openai', () => pausingAdapter);

      const provider = testApp.fixtures.createProvider({
        kind: 'openai',
        enabled: 1,
      });
      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: 'sk-test' })
        .expect(200);
      const model = testApp.fixtures.createModel({
        provider_id: provider.id,
        enabled: 1,
      });
      const agent = testApp.fixtures.createAgent({ model_id: model.id });
      const chat = testApp.fixtures.createChat({ agent_id: agent.id });

      // Start streaming request in background by initiating .end()
      let streamResponse: any;
      let streamError: any;
      const streamDonePromise = new Promise<void>((resolve, reject) => {
        testApp
          .request()
          .post(`/api/v1/chats/${chat.id}/completions`)
          .send({ stream: true })
          .end((err, res) => {
            if (err) {
              streamError = err;
              reject(err);
            } else {
              streamResponse = res;
              resolve();
            }
          });
      });

      // Wait for first chunk to be processed and row to transition to streaming
      let inFlightObserved = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const listRes = await testApp
          .request()
          .get(`/api/v1/chats/${chat.id}/messages`)
          .expect(200);

        if (listRes.body.items.length > 0) {
          const item = listRes.body.items[0];
          if (item.status === 'streaming') {
            expect(item.content).toBe('In-flight text');
            inFlightObserved = true;
            break;
          }
        }
      }

      expect(inFlightObserved).toBe(true);

      // Now release the adapter so it completes generation
      releaseStream();
      await streamDonePromise;
      expect(streamError).toBeUndefined();
      expect(streamResponse.status).toBe(200);

      // Verify list endpoint returns completed message after generation
      const finalListRes = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages`)
        .expect(200);

      expect(finalListRes.body.items).toHaveLength(1);
      expect(finalListRes.body.items[0].status).toBe('complete');
      expect(finalListRes.body.items[0].content).toBe(
        'In-flight text and final text.',
      );
    });
  });

  // =========================================================================
  // 3. Mid-Stream Failure & In-Band Error Reporting
  // =========================================================================
  describe('Mid-stream provider error handling', () => {
    it('delivers in-band error event and preserves partial content in error status', async () => {
      const env = await setupValidEnvironment({
        cannedContent: 'Chunk1-Chunk2-Chunk3-Chunk4',
        streamChunkSize: 7, // 'Chunk1-', 'Chunk2-', ...
        failAfterChunks: 2,
        simulateError: new RateLimitError(
          'Rate limit exceeded mid-stream',
          'openai',
          { retryAfterSeconds: 30 },
        ),
      });

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${env.chat.id}/completions`)
        .send({ stream: true })
        .expect(200);

      const events = parseSseEvents(res.text);
      expect(events[0].type).toBe('message_start');
      const tokenEvents = events.filter((e) => e.type === 'token');
      expect(tokenEvents).toHaveLength(2);

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.data).toMatchObject({
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded mid-stream',
        retryable: true,
        retryAfterSeconds: 30,
      });

      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();

      // Database row verification: status is error, partial content preserved
      const messageId = events[0].data.messageId;
      const row = testApp.db.get<any>('SELECT * FROM messages WHERE id = ?', [
        messageId,
      ]);
      expect(row.status).toBe('error');
      expect(row.content).toBe('Chunk1-Chunk2-');
    });
  });

  // =========================================================================
  // 4. Client Disconnection Mid-Stream
  // =========================================================================
  describe('Client disconnection handling', () => {
    it('aborts upstream provider and leaves row completed with partial content', async () => {
      let upstreamAborted = false;

      const delayedAdapter: any = {
        capabilities: { supportsStreaming: true, supportsDiscovery: true },
        stream: async function* (_req: any, options?: any) {
          options?.signal?.addEventListener('abort', () => {
            upstreamAborted = true;
          });

          yield { type: 'text-delta', delta: 'Partial chunk 1. ' };
          yield { type: 'text-delta', delta: 'Partial chunk 2. ' };

          for (let i = 0; i < 20; i++) {
            if (options?.signal?.aborted) {
              upstreamAborted = true;
              throw new RequestAbortedError('Client aborted', 'openai');
            }
            await new Promise((resolve) => setTimeout(resolve, 30));
            yield { type: 'text-delta', delta: `Late chunk ${i}. ` };
          }
        },
      };

      adapterFactory.register('openai', () => delayedAdapter);

      const provider = testApp.fixtures.createProvider({
        kind: 'openai',
        enabled: 1,
      });
      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: 'sk-test' })
        .expect(200);
      const model = testApp.fixtures.createModel({
        provider_id: provider.id,
        enabled: 1,
      });
      const agent = testApp.fixtures.createAgent({ model_id: model.id });
      const chat = testApp.fixtures.createChat({ agent_id: agent.id });

      const req = testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/completions`)
        .send({ stream: true });

      // Disconnect after receiving initial chunks
      setTimeout(() => {
        req.abort();
      }, 50);

      try {
        await req;
      } catch {
        // Expected client abort error
      }

      await new Promise((resolve) => setTimeout(resolve, 80));

      const rows = testApp.db.all<any>(
        'SELECT * FROM messages WHERE chat_id = ?',
        [chat.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('complete');
      expect(rows[0].content).toContain('Partial chunk 1. ');
      expect(upstreamAborted).toBe(true);
    });
  });

  // =========================================================================
  // 5. Concurrent Streaming in Different Chats
  // =========================================================================
  describe('Concurrent streaming completions', () => {
    it('streams concurrently in two different chats without sequence collisions', async () => {
      const env1 = await setupValidEnvironment({
        cannedContent: 'Reply to Chat One',
      });

      // Create a second chat for the same agent
      const chat2 = testApp.fixtures.createChat({
        agent_id: env1.agent.id,
        title: 'Chat Two',
      });

      const [res1, res2] = await Promise.all([
        testApp
          .request()
          .post(`/api/v1/chats/${env1.chat.id}/completions`)
          .send({ stream: true }),
        testApp
          .request()
          .post(`/api/v1/chats/${chat2.id}/completions`)
          .send({ stream: true }),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const events1 = parseSseEvents(res1.text);
      const events2 = parseSseEvents(res2.text);

      expect(events1[0].data.chatId).toBe(env1.chat.id);
      expect(events2[0].data.chatId).toBe(chat2.id);

      // Both chats should have sequence = 1
      expect(events1[0].data.sequence).toBe(1);
      expect(events2[0].data.sequence).toBe(1);

      const row1 = testApp.db.get<any>(
        'SELECT * FROM messages WHERE chat_id = ?',
        [env1.chat.id],
      );
      const row2 = testApp.db.get<any>(
        'SELECT * FROM messages WHERE chat_id = ?',
        [chat2.id],
      );

      expect(row1.status).toBe('complete');
      expect(row2.status).toBe('complete');
      expect(row1.id).not.toBe(row2.id);
    });
  });

  // =========================================================================
  // 6. Credential Leak Prevention
  // =========================================================================
  describe('Credential leak protection', () => {
    it('does not leak secret API key in stream events, errors, or logs', async () => {
      const secretKey = 'sk-ant-leak-test-key-never-expose';
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
        const env = await setupValidEnvironment({
          apiKey: secretKey,
          failAfterChunks: 1,
          simulateError: new RateLimitError(
            `Key ${secretKey} rate limited by provider`,
            'openai',
          ),
        });

        const res = await testApp
          .request()
          .post(`/api/v1/chats/${env.chat.id}/completions`)
          .send({ stream: true })
          .expect(200);

        expect(res.text).not.toContain(secretKey);

        const allLogs = logChunks.join('');
        expect(allLogs).not.toContain(secretKey);
      } finally {
        stdoutSpy.mockRestore();
        stderrSpy.mockRestore();
      }
    });
  });

  // =========================================================================
  // 7. Team-owned Chat Validation
  // =========================================================================
  describe('Team-owned chat behavior', () => {
    it('rejects team-owned chats with no members with 422 TEAM_HAS_NO_MEMBERS as standard JSON', async () => {
      const team = testApp.fixtures.createTeam({ name: 'Orchestration Team' });
      const chat = testApp.fixtures.createChat({
        title: 'Team Chat',
        team_id: team.id,
        agent_id: null,
      });

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/completions`)
        .send({ stream: true })
        .expect(422);

      expect(res.headers['content-type']).toContain('application/json');
      expect(res.body.code).toBe('TEAM_HAS_NO_MEMBERS');
      expect(res.body.message).toContain('Team has no active members');

      // No message created
      const count = testApp.db.get<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM messages WHERE chat_id = ?',
        [chat.id],
      );
      expect(count?.cnt).toBe(0);
    });

    it('streams multi-agent team completion successfully with sequential message_start events', async () => {
      const provider = testApp.fixtures.createProvider({
        kind: 'openai',
        is_local: 0,
      });
      const model = testApp.fixtures.createModel(provider.id);
      const alice = testApp.fixtures.createAgent({
        name: 'Alice',
        model_id: model.id,
      });
      const bob = testApp.fixtures.createAgent({
        name: 'Bob',
        model_id: model.id,
      });

      const team = testApp.fixtures.createTeam({ name: 'Orchestration Team' });
      testApp.fixtures.createTeamMember(team.id, alice.id, {
        position: 1,
        role: 'Architect',
      });
      testApp.fixtures.createTeamMember(team.id, bob.id, {
        position: 2,
        role: 'Engineer',
      });

      const chat = testApp.fixtures.createChat({
        title: 'Team Chat',
        team_id: team.id,
        agent_id: null,
      });

      testApp.fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        role: 'user',
        content: 'Design pipeline',
      });

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/completions`)
        .send({ stream: true })
        .expect(200);

      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.text).toContain('event: message_start');
      expect(res.text).toContain('Alice (Architect)');
      expect(res.text).toContain('Bob (Engineer)');
      expect(res.text).toContain('event: done');
    });
  });
});
