import {
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../database/database.service.js';
import { TestFixtures } from '../../../test/harness/fixtures.js';
import { AdapterFactoryService } from '../../model-adapters/adapter-factory/adapter-factory.service.js';
import { TestDoubleAdapter } from '../../model-adapters/test/test-double-adapter.js';
import {
  ContextLengthExceededError,
  RateLimitError,
  RequestAbortedError,
} from '../../model-adapters/errors/index.js';
import { CredentialsService } from '../providers/credentials/credentials.service.js';
import { InferenceService } from './inference.service.js';

describe('InferenceService', () => {
  let db: DatabaseService;
  let fixtures: TestFixtures;
  let adapterFactory: AdapterFactoryService;
  let testDouble: TestDoubleAdapter;
  let mockCredentialsService: {
    getDecryptedCredential: ReturnType<typeof vi.fn>;
  };
  let service: InferenceService;

  beforeEach(() => {
    db = new DatabaseService();
    db.connect(':memory:');
    fixtures = new TestFixtures(db);

    testDouble = new TestDoubleAdapter(
      { providerKind: 'openai' },
      {
        cannedResponse: {
          content: 'Hello! I am ready to help.',
          finishReason: 'stop',
          usage: {
            inputTokens: 15,
            outputTokens: 8,
            totalTokens: 23,
          },
        },
      },
    );

    adapterFactory = new AdapterFactoryService();
    adapterFactory.register(
      ['anthropic', 'openai', 'google', 'ollama', 'lmstudio', 'openai_compatible'],
      () => testDouble,
    );

    mockCredentialsService = {
      getDecryptedCredential: vi.fn().mockReturnValue('sk-test-secret-key-12345'),
    };

    service = new InferenceService(
      db,
      adapterFactory,
      mockCredentialsService as unknown as CredentialsService,
    );
  });

  afterEach(() => {
    db.close();
  });

  describe('resolution chain validation', () => {
    it('throws NotFoundException when chat does not exist', async () => {
      await expect(
        service.completeChat('non-existent-chat-id', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws UnprocessableEntityException when chat is owned by a team', async () => {
      const team = fixtures.createTeam({ name: 'Alpha Team' });
      const chat = fixtures.createChat({
        title: 'Team Chat',
        team_id: team.id,
        agent_id: null,
      });

      await expect(service.completeChat(chat.id, {})).rejects.toThrow(
        new UnprocessableEntityException({
          code: 'TEAM_CHAT_NOT_SUPPORTED',
          message: 'Multi-agent team chats are not yet supported for completion',
        }),
      );
    });

    it('throws UnprocessableEntityException when chat has no assigned agent (owning agent was deleted)', async () => {
      const agent = fixtures.createAgent({ name: 'Temporary Agent' });
      const chat = fixtures.createChat({
        agent_id: agent.id,
      });

      // Simulate a chat whose owning agent was deleted leaving agent_id null
      db.run('PRAGMA ignore_check_constraints = ON;');
      db.run('UPDATE chats SET agent_id = NULL WHERE id = ?', [chat.id]);
      db.run('PRAGMA ignore_check_constraints = OFF;');

      await expect(service.completeChat(chat.id, {})).rejects.toThrow(
        new UnprocessableEntityException({
          code: 'CHAT_HAS_NO_AGENT',
          message: 'Chat has no assigned agent to execute completions',
        }),
      );
    });

    it('throws UnprocessableEntityException when agent has no model configured', async () => {
      const agent = fixtures.createAgent({
        name: 'Agent Without Model',
        model_id: null,
      });
      const chat = fixtures.createChat({
        agent_id: agent.id,
      });

      await expect(service.completeChat(chat.id, {})).rejects.toThrow(
        new UnprocessableEntityException({
          code: 'AGENT_HAS_NO_MODEL',
          message: `Agent "${agent.name}" has no model configured`,
        }),
      );
    });

    it('throws UnprocessableEntityException when model is disabled', async () => {
      const provider = fixtures.createProvider({
        kind: 'openai',
        enabled: 1,
      });
      const model = fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'gpt-4o',
        enabled: 0,
      });
      const agent = fixtures.createAgent({
        name: 'Agent With Disabled Model',
        model_id: model.id,
      });
      const chat = fixtures.createChat({
        agent_id: agent.id,
      });

      await expect(service.completeChat(chat.id, {})).rejects.toThrow(
        new UnprocessableEntityException({
          code: 'MODEL_DISABLED',
          message: `Model "${model.display_name}" is disabled`,
        }),
      );
    });

    it('throws UnprocessableEntityException when provider is disabled', async () => {
      const provider = fixtures.createProvider({
        name: 'OpenAI Provider',
        kind: 'openai',
        enabled: 0,
      });
      const model = fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'gpt-4o',
        enabled: 1,
      });
      const agent = fixtures.createAgent({
        name: 'Agent With Disabled Provider',
        model_id: model.id,
      });
      const chat = fixtures.createChat({
        agent_id: agent.id,
      });

      await expect(service.completeChat(chat.id, {})).rejects.toThrow(
        new UnprocessableEntityException({
          code: 'PROVIDER_DISABLED',
          message: `Provider "${provider.name}" is disabled`,
        }),
      );
    });

    it('throws UnprocessableEntityException when hosted provider has no credential', async () => {
      mockCredentialsService.getDecryptedCredential.mockReturnValue(null);

      const provider = fixtures.createProvider({
        name: 'Anthropic Cloud',
        kind: 'anthropic',
        is_local: 0,
        enabled: 1,
      });
      const model = fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'claude-3-5-sonnet',
        enabled: 1,
      });
      const agent = fixtures.createAgent({
        model_id: model.id,
      });
      const chat = fixtures.createChat({
        agent_id: agent.id,
      });

      await expect(service.completeChat(chat.id, {})).rejects.toThrow(
        new UnprocessableEntityException({
          code: 'CREDENTIAL_MISSING',
          message: `Provider "${provider.name}" requires an API credential that is not configured`,
        }),
      );
    });

    it('succeeds for local provider without credentials', async () => {
      mockCredentialsService.getDecryptedCredential.mockReturnValue(null);

      const provider = fixtures.createProvider({
        name: 'Ollama Local',
        kind: 'ollama',
        is_local: 1,
        enabled: 1,
      });
      const model = fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'llama3:8b',
        enabled: 1,
      });
      const agent = fixtures.createAgent({
        model_id: model.id,
      });
      const chat = fixtures.createChat({
        agent_id: agent.id,
      });

      const response = await service.completeChat(chat.id, {});
      expect(response).toBeDefined();
      expect(response.role).toBe('assistant');
      expect(response.content).toBe('Hello! I am ready to help.');
    });
  });

  describe('override precedence', () => {
    it('applies precedence: request body > agent configuration > model defaults', async () => {
      const provider = fixtures.createProvider({ kind: 'openai', enabled: 1 });
      const defaultModel = fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'gpt-4o-mini',
        default_temperature: 0.2,
        default_max_tokens: 1000,
        enabled: 1,
      });
      const overrideModel = fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'gpt-4o',
        default_temperature: 0.5,
        default_max_tokens: 2000,
        enabled: 1,
      });

      const agent = fixtures.createAgent({
        model_id: defaultModel.id,
        temperature: 0.8,
        max_tokens: 1500,
      });
      const chat = fixtures.createChat({
        agent_id: agent.id,
      });

      // 1. None supplied in request -> agent config wins
      await service.completeChat(chat.id, {});
      expect(testDouble.completedRequests[0].temperature).toBe(0.8);
      expect(testDouble.completedRequests[0].maxTokens).toBe(1500);
      expect(testDouble.completedRequests[0].model).toBe('gpt-4o-mini');

      testDouble.resetHistory();

      // 2. Request body supplied -> request body wins
      await service.completeChat(chat.id, {
        modelId: overrideModel.id,
        temperature: 0.0,
        maxTokens: 500,
      });
      expect(testDouble.completedRequests[0].temperature).toBe(0.0);
      expect(testDouble.completedRequests[0].maxTokens).toBe(500);
      expect(testDouble.completedRequests[0].model).toBe('gpt-4o');
    });

    it('falls back to model defaults when agent configuration is null', async () => {
      const provider = fixtures.createProvider({ kind: 'openai', enabled: 1 });
      const model = fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'gpt-4o',
        default_temperature: 0.4,
        default_max_tokens: 1200,
        enabled: 1,
      });

      const agent = fixtures.createAgent({
        model_id: model.id,
        temperature: null,
        max_tokens: null,
      });
      const chat = fixtures.createChat({
        agent_id: agent.id,
      });

      await service.completeChat(chat.id, {});
      expect(testDouble.completedRequests[0].temperature).toBe(0.4);
      expect(testDouble.completedRequests[0].maxTokens).toBe(1200);
    });
  });

  describe('context assembly', () => {
    it('assembles system prompt, instructions, context summary, and message history', async () => {
      const prompt = fixtures.createSystemPrompt({
        name: 'Helpful Assistant',
        content: 'You are a helpful and concise assistant.',
      });
      const provider = fixtures.createProvider({ kind: 'openai', enabled: 1 });
      const model = fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'gpt-4o',
        enabled: 1,
      });
      const agent = fixtures.createAgent({
        model_id: model.id,
        system_prompt_id: prompt.id,
        instructions: 'Never mention internal identifiers.',
      });
      const chat = fixtures.createChat({
        agent_id: agent.id,
        context_summary: 'The user is building a web app in NestJS.',
      });

      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        role: 'user',
        content: 'What framework should I use for testing?',
      });

      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 2,
        role: 'assistant',
        content: 'Vitest is great with NestJS.',
      });

      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 3,
        role: 'user',
        content: 'Tell me more about it.',
      });

      await service.completeChat(chat.id, {});

      expect(testDouble.completedRequests).toHaveLength(1);
      const req = testDouble.completedRequests[0];

      // System prompt + instructions + context summary
      expect(req.systemPrompt).toContain('You are a helpful and concise assistant.');
      expect(req.systemPrompt).toContain('Never mention internal identifiers.');
      expect(req.systemPrompt).toContain('Context summary:\nThe user is building a web app in NestJS.');

      // Messages should contain history in sequence order
      expect(req.messages).toHaveLength(3);
      expect(req.messages[0].content).toBe('What framework should I use for testing?');
      expect(req.messages[1].content).toBe('Vitest is great with NestJS.');
      expect(req.messages[2].content).toBe('Tell me more about it.');
    });

    it('incorporates agent personality into system prompt between prompt template and instructions', async () => {
      const provider = fixtures.createProvider({ kind: 'openai', enabled: 1 });
      const model = fixtures.createModel({ provider_id: provider.id, enabled: 1 });
      const prompt = fixtures.createSystemPrompt({
        content: 'You are an AI assistant.',
      });
      const agent = fixtures.createAgent({
        model_id: model.id,
        system_prompt_id: prompt.id,
        personality: 'Speaks only in haiku.',
        instructions: 'Always answer briefly.',
      });
      const chat = fixtures.createChat({ agent_id: agent.id });

      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        role: 'user',
        content: 'Hello there',
      });

      await service.completeChat(chat.id, {});

      expect(testDouble.completedRequests).toHaveLength(1);
      const req = testDouble.completedRequests[0];
      expect(req.systemPrompt).toBe(
        'You are an AI assistant.\n\nSpeaks only in haiku.\n\nAlways answer briefly.',
      );
    });

    it('refuses execution with ContextLengthExceededError when history exceeds model context window', async () => {
      const provider = fixtures.createProvider({ kind: 'openai', enabled: 1 });
      const model = fixtures.createModel({
        provider_id: provider.id,
        enabled: 1,
        context_window: 25, // Small context window
      });
      const agent = fixtures.createAgent({
        model_id: model.id,
        instructions: 'Answer questions.',
      });
      const chat = fixtures.createChat({ agent_id: agent.id });

      // Add a long turn exceeding 25 tokens
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        role: 'user',
        content: 'This is a long message that easily exceeds twenty-five tokens threshold for fitting.',
      });

      await expect(service.completeChat(chat.id, {})).rejects.toThrow(
        ContextLengthExceededError,
      );
    });

    it('allows inspecting constructed context without executing completion via inspectContext', () => {
      const provider = fixtures.createProvider({ kind: 'openai', enabled: 1 });
      const model = fixtures.createModel({ provider_id: provider.id, enabled: 1, context_window: 10000 });
      const prompt = fixtures.createSystemPrompt({ content: 'Inspectable template.' });
      const agent = fixtures.createAgent({
        model_id: model.id,
        system_prompt_id: prompt.id,
        personality: 'Friendly',
        instructions: 'Format in markdown',
      });
      const chat = fixtures.createChat({ agent_id: agent.id, context_summary: 'Prior summary' });

      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        role: 'user',
        content: 'How does inspection work?',
        status: 'complete',
      });

      const inspected = service.inspectContext(chat.id);

      expect(inspected.systemPrompt).toContain('Inspectable template.');
      expect(inspected.systemPrompt).toContain('Friendly');
      expect(inspected.systemPrompt).toContain('Format in markdown');
      expect(inspected.systemPrompt).toContain('Context summary:\nPrior summary');
      expect(inspected.messages).toHaveLength(1);
      expect(inspected.tokenEstimate.fitsContextWindow).toBe(true);
      expect(testDouble.completedRequests).toHaveLength(0); // Zero provider calls made
    });
  });

  describe('persistence and metrics recording', () => {
    it('persists assistant message with atomic sequence, advances chat updated_at, and logs usage', async () => {
      const provider = fixtures.createProvider({ kind: 'openai', enabled: 1 });
      const model = fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'gpt-4o',
        enabled: 1,
      });
      const agent = fixtures.createAgent({
        model_id: model.id,
      });
      const chat = fixtures.createChat({
        agent_id: agent.id,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      });

      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        role: 'user',
        content: 'Hello agent!',
      });

      const result = await service.completeChat(chat.id, {});

      // Verify returned shape
      expect(result.chatId).toBe(chat.id);
      expect(result.sequence).toBe(2);
      expect(result.role).toBe('assistant');
      expect(result.agentId).toBe(agent.id);
      expect(result.content).toBe('Hello! I am ready to help.');
      expect(result.status).toBe('complete');
      expect(result.tokenCount).toBe(8);
      expect(result.usage).toEqual({
        inputTokens: 15,
        outputTokens: 8,
        totalTokens: 23,
      });

      // Verify database row
      const savedMsg = db.get<any>(
        'SELECT * FROM messages WHERE id = ?',
        [result.id],
      );
      expect(savedMsg).toBeDefined();
      expect(savedMsg.chat_id).toBe(chat.id);
      expect(savedMsg.sequence).toBe(2);
      expect(savedMsg.role).toBe('assistant');
      expect(savedMsg.agent_id).toBe(agent.id);
      expect(savedMsg.token_count).toBe(8);

      // Verify chat updated_at advanced
      const updatedChat = db.get<any>(
        'SELECT * FROM chats WHERE id = ?',
        [chat.id],
      );
      expect(updatedChat.updated_at).not.toBe('2026-01-01T00:00:00.000Z');

      // Verify usage_events record
      const usageRow = db.get<any>(
        'SELECT * FROM usage_events WHERE chat_id = ? AND agent_id = ?',
        [chat.id, agent.id],
      );
      expect(usageRow).toBeDefined();
      expect(usageRow.chat_id).toBe(chat.id);
      expect(usageRow.agent_id).toBe(agent.id);
      expect(usageRow.model_id).toBe(model.id);
      expect(usageRow.input_tokens).toBe(15);
      expect(usageRow.output_tokens).toBe(8);
    });

    it('records null token_count when provider does not report usage', async () => {
      const noUsageAdapter = new TestDoubleAdapter(
        { providerKind: 'openai' },
        {
          cannedResponse: {
            content: 'No tokens reported',
            usage: undefined,
          },
        },
      );
      adapterFactory.register('openai', () => noUsageAdapter);

      const provider = fixtures.createProvider({ kind: 'openai', enabled: 1 });
      const model = fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'gpt-4o',
        enabled: 1,
      });
      const agent = fixtures.createAgent({
        model_id: model.id,
      });
      const chat = fixtures.createChat({
        agent_id: agent.id,
      });

      const result = await service.completeChat(chat.id, {});
      expect(result.tokenCount).toBeNull();
      expect(result.usage).toBeNull();

      const savedMsg = db.get<any>(
        'SELECT * FROM messages WHERE id = ?',
        [result.id],
      );
      expect(savedMsg.token_count).toBeNull();
    });
  });

  describe('error handling and upstream normalization', () => {
    it('propagates normalized provider error', async () => {
      const failingAdapter = new TestDoubleAdapter(
        { providerKind: 'openai' },
        {
          simulateError: new RateLimitError(
            'Rate limit exceeded. Try again in 20 seconds.',
            'openai',
            { retryAfterSeconds: 20 },
          ),
        },
      );
      adapterFactory.register('openai', () => failingAdapter);

      const provider = fixtures.createProvider({ kind: 'openai', enabled: 1 });
      const model = fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'gpt-4o',
        enabled: 1,
      });
      const agent = fixtures.createAgent({ model_id: model.id });
      const chat = fixtures.createChat({ agent_id: agent.id });

      await expect(service.completeChat(chat.id, {})).rejects.toThrow(
        RateLimitError,
      );
    });

    it('propagates cancellation via AbortSignal to adapter', async () => {
      const provider = fixtures.createProvider({ kind: 'openai', enabled: 1 });
      const model = fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'gpt-4o',
        enabled: 1,
      });
      const agent = fixtures.createAgent({ model_id: model.id });
      const chat = fixtures.createChat({ agent_id: agent.id });

      const ac = new AbortController();
      ac.abort();

      await expect(
        service.completeChat(chat.id, {}, { signal: ac.signal }),
      ).rejects.toThrow(RequestAbortedError);
    });

    it('throws 500 PERSISTENCE_FAILED if message write fails after provider success', async () => {
      const provider = fixtures.createProvider({ kind: 'openai', enabled: 1 });
      const model = fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'gpt-4o',
        enabled: 1,
      });
      const agent = fixtures.createAgent({ model_id: model.id });
      const chat = fixtures.createChat({ agent_id: agent.id });

      // Simulate DB write error using a trigger so history reading succeeds but insert fails
      db.exec(`
        CREATE TRIGGER fail_insert BEFORE INSERT ON messages
        BEGIN
          SELECT RAISE(FAIL, 'Simulated disk write failure');
        END;
      `);

      await expect(service.completeChat(chat.id, {})).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('streamChat', () => {
    function setupChatEnvironment() {
      const provider = fixtures.createProvider({ kind: 'openai', enabled: 1 });
      const model = fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'gpt-4o',
        enabled: 1,
      });
      const agent = fixtures.createAgent({ model_id: model.id });
      const chat = fixtures.createChat({ agent_id: agent.id });
      return { provider, model, agent, chat };
    }

    it('drives the message row through pending -> streaming -> complete and records usage', async () => {
      const { chat } = setupChatEnvironment();

      const events: any[] = [];
      let messageId: string | undefined;

      const generator = service.streamChat(chat.id, {});

      for await (const event of generator) {
        events.push(event);

        if (event.type === 'message_start') {
          messageId = event.data.messageId;
          // State Machine Verification: row must be observable in 'pending' state
          const pendingRow = db.get<any>(
            'SELECT * FROM messages WHERE id = ?',
            [messageId],
          );
          expect(pendingRow).toBeDefined();
          expect(pendingRow.status).toBe('pending');
          expect(pendingRow.content).toBe('');
          expect(pendingRow.sequence).toBe(1);
          expect(pendingRow.role).toBe('assistant');
        } else if (event.type === 'token' && events.filter((e) => e.type === 'token').length === 1) {
          // State Machine Verification: on first token, row must transition to 'streaming'
          const streamingRow = db.get<any>(
            'SELECT * FROM messages WHERE id = ?',
            [messageId],
          );
          expect(streamingRow.status).toBe('streaming');
          expect(streamingRow.content).toBe(event.data.text);
        }
      }

      // Assert emitted event sequence
      expect(events.map((e) => e.type)).toEqual([
        'message_start',
        ...events.filter((e) => e.type === 'token').map(() => 'token'),
        'usage',
        'message_complete',
        'done',
      ]);

      const completeEvent = events.find((e) => e.type === 'message_complete');
      expect(completeEvent.data.status).toBe('complete');
      expect(completeEvent.data.tokenCount).toBe(8);
      expect(completeEvent.data.usage).toEqual({
        inputTokens: 15,
        outputTokens: 8,
        totalTokens: 23,
      });

      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent.data).toBe('[DONE]');

      // Final row state in database
      const finalRow = db.get<any>('SELECT * FROM messages WHERE id = ?', [
        messageId,
      ]);
      expect(finalRow.status).toBe('complete');
      expect(finalRow.content).toBe('Hello! I am ready to help.');
      expect(finalRow.token_count).toBe(8);

      // Usage event recorded
      const usageRow = db.get<any>(
        'SELECT * FROM usage_events WHERE chat_id = ?',
        [chat.id],
      );
      expect(usageRow).toBeDefined();
      expect(usageRow.event_type).toBe('chat_completion');
      expect(usageRow.input_tokens).toBe(15);
      expect(usageRow.output_tokens).toBe(8);
    });

    it('rejects unrunnable chat before stream starts and creates no message rows', async () => {
      const team = fixtures.createTeam({ name: 'Alpha Team' });
      const chat = fixtures.createChat({
        title: 'Team Chat',
        team_id: team.id,
        agent_id: null,
      });

      const generator = service.streamChat(chat.id, {});

      await expect(generator.next()).rejects.toThrow(
        UnprocessableEntityException,
      );

      const messageCount = db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM messages WHERE chat_id = ?',
        [chat.id],
      );
      expect(messageCount?.count).toBe(0);
    });

    it('rejects models that do not support streaming before allocating sequence', async () => {
      const nonStreamingAdapter = new TestDoubleAdapter(
        { providerKind: 'openai' },
        { capabilities: { supportsStreaming: false } },
      );
      adapterFactory.register('openai', () => nonStreamingAdapter);

      const { chat } = setupChatEnvironment();
      const generator = service.streamChat(chat.id, {});

      await expect(generator.next()).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: 'STREAMING_NOT_SUPPORTED',
          }),
        }),
      );

      const messageCount = db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM messages WHERE chat_id = ?',
        [chat.id],
      );
      expect(messageCount?.count).toBe(0);
    });

    it('delivers in-band error event and preserves partial content on mid-stream failure', async () => {
      const failingAdapter = new TestDoubleAdapter(
        { providerKind: 'openai' },
        {
          cannedResponse: {
            content: 'Part1-Part2-Part3-Part4',
          },
          streamChunkSize: 6, // Emits 'Part1-', 'Part2-', ...
          failAfterChunks: 2, // Fails after emitting 2 chunks ('Part1-Part2-')
          simulateError: new RateLimitError(
            'Provider rate limit reached mid-stream',
            'openai',
          ),
        },
      );
      adapterFactory.register('openai', () => failingAdapter);

      const { chat } = setupChatEnvironment();
      const events: any[] = [];

      for await (const event of service.streamChat(chat.id, {})) {
        events.push(event);
      }

      expect(events[0].type).toBe('message_start');
      const tokenEvents = events.filter((e) => e.type === 'token');
      expect(tokenEvents).toHaveLength(2);

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.data.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(errorEvent.data.message).toBe('Provider rate limit reached mid-stream');

      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();

      // Check DB row: status must be error, and partial content preserved!
      const messageId = events[0].data.messageId;
      const errorRow = db.get<any>('SELECT * FROM messages WHERE id = ?', [
        messageId,
      ]);
      expect(errorRow.status).toBe('error');
      expect(errorRow.content).toBe('Part1-Part2-');
    });

    it('aborts upstream request on client disconnect and finalizes row with partial content', async () => {
      const ac = new AbortController();
      let chunksReceived = 0;

      const { chat } = setupChatEnvironment();
      const generator = service.streamChat(chat.id, {}, { signal: ac.signal });

      let messageId: string | undefined;
      for await (const event of generator) {
        if (event.type === 'message_start') {
          messageId = event.data.messageId;
        } else if (event.type === 'token') {
          chunksReceived++;
          // Abort after first chunk received
          if (chunksReceived === 1) {
            ac.abort(new Error('Client aborted'));
          }
        }
      }

      expect(chunksReceived).toBe(1);
      expect(messageId).toBeDefined();

      // Row finalized with complete status and partial content retained
      const row = db.get<any>('SELECT * FROM messages WHERE id = ?', [
        messageId,
      ]);
      expect(row.status).toBe('complete');
      expect(row.content.length).toBeGreaterThan(0);
    });

    it('leaves row in error state with interrupted message when client disconnects before content', async () => {
      const ac = new AbortController();
      const { chat } = setupChatEnvironment();

      // Create an adapter that waits before yielding first chunk
      const delayedAdapter = new TestDoubleAdapter(
        { providerKind: 'openai' },
        {
          streamDelayMs: 50,
          cannedResponse: { content: 'Slow generation' },
        },
      );
      adapterFactory.register('openai', () => delayedAdapter);

      const generator = service.streamChat(chat.id, {}, { signal: ac.signal });

      let messageId: string | undefined;
      for await (const event of generator) {
        if (event.type === 'message_start') {
          messageId = event.data.messageId;
          // Abort before any tokens arrive
          ac.abort(new Error('Immediate client disconnect'));
        }
      }

      const row = db.get<any>('SELECT * FROM messages WHERE id = ?', [
        messageId,
      ]);
      expect(row.status).toBe('error');
      expect(row.content).toBe('Generation interrupted');
    });

    it('checkpoints partial content to SQLite periodically when 200 chars threshold is reached', async () => {
      // 5 chunks of 50 chars = 250 chars total
      const longText = 'A'.repeat(50) + 'B'.repeat(50) + 'C'.repeat(50) + 'D'.repeat(50) + 'E'.repeat(50);
      const longAdapter = new TestDoubleAdapter(
        { providerKind: 'openai' },
        {
          cannedResponse: { content: longText },
          streamChunkSize: 50,
        },
      );
      adapterFactory.register('openai', () => longAdapter);

      const { chat } = setupChatEnvironment();
      let messageId: string | undefined;
      const observedFlushes: string[] = [];

      for await (const event of service.streamChat(chat.id, {})) {
        if (event.type === 'message_start') {
          messageId = event.data.messageId;
        } else if (event.type === 'token') {
          const row = db.get<any>('SELECT content FROM messages WHERE id = ?', [
            messageId,
          ]);
          observedFlushes.push(row.content);
        }
      }

      // Chunk 0 (50 chars) was flushed on transition from pending to streaming
      expect(observedFlushes[0]).toBe('A'.repeat(50));
      // Chunks 1, 2, 3 were buffered in memory and NOT written to SQLite
      expect(observedFlushes[1]).toBe('A'.repeat(50));
      expect(observedFlushes[2]).toBe('A'.repeat(50));
      expect(observedFlushes[3]).toBe('A'.repeat(50));
      // At chunk 4, 200 chars had accumulated since last flush (50 + 200 = 250), so it flushed
      expect(observedFlushes[4]).toBe(longText);
    });

    it('ensures provider credential is never leaked in stream events or errors', async () => {
      const secretKey = 'sk-super-secret-key-999';
      mockCredentialsService.getDecryptedCredential.mockReturnValue(secretKey);

      const leakingAdapter = new TestDoubleAdapter(
        { providerKind: 'openai' },
        {
          simulateError: new RateLimitError(
            `Rate limit exceeded with key ${secretKey}`,
            'openai',
          ),
        },
      );
      adapterFactory.register('openai', () => leakingAdapter);

      const { chat } = setupChatEnvironment();
      const events: any[] = [];

      for await (const event of service.streamChat(chat.id, {})) {
        events.push(event);
      }

      const serializedEvents = JSON.stringify(events);
      expect(serializedEvents).not.toContain(secretKey);

      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent.data.message).not.toContain(secretKey);
      expect(errorEvent.data.message).toContain('[REDACTED]');
    });
  });
});

