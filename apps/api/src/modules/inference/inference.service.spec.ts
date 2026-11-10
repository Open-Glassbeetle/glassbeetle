import {
  BadRequestException,
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
      [
        'anthropic',
        'openai',
        'google',
        'ollama',
        'lmstudio',
        'openai_compatible',
      ],
      () => testDouble,
    );

    mockCredentialsService = {
      getDecryptedCredential: vi
        .fn()
        .mockReturnValue('sk-test-secret-key-12345'),
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

    it('throws UnprocessableEntityException when chat is owned by a team with no active members', async () => {
      const team = fixtures.createTeam({ name: 'Alpha Team' });
      const chat = fixtures.createChat({
        title: 'Team Chat',
        team_id: team.id,
        agent_id: null,
      });

      await expect(service.completeChat(chat.id, {})).rejects.toThrow(
        new UnprocessableEntityException({
          code: 'TEAM_HAS_NO_MEMBERS',
          message: 'Team has no active members to execute completions',
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
      expect(req.systemPrompt).toContain(
        'You are a helpful and concise assistant.',
      );
      expect(req.systemPrompt).toContain('Never mention internal identifiers.');
      expect(req.systemPrompt).toContain(
        'Context summary:\nThe user is building a web app in NestJS.',
      );

      // Messages should contain history in sequence order
      expect(req.messages).toHaveLength(3);
      expect(req.messages[0].content).toBe(
        'What framework should I use for testing?',
      );
      expect(req.messages[1].content).toBe('Vitest is great with NestJS.');
      expect(req.messages[2].content).toBe('Tell me more about it.');
    });

    it('incorporates agent personality into system prompt between prompt template and instructions', async () => {
      const provider = fixtures.createProvider({ kind: 'openai', enabled: 1 });
      const model = fixtures.createModel({
        provider_id: provider.id,
        enabled: 1,
      });
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
        content:
          'This is a long message that easily exceeds twenty-five tokens threshold for fitting.',
      });

      await expect(service.completeChat(chat.id, {})).rejects.toThrow(
        ContextLengthExceededError,
      );
    });

    it('allows inspecting constructed context without executing completion via inspectContext', () => {
      const provider = fixtures.createProvider({ kind: 'openai', enabled: 1 });
      const model = fixtures.createModel({
        provider_id: provider.id,
        enabled: 1,
        context_window: 10000,
      });
      const prompt = fixtures.createSystemPrompt({
        content: 'Inspectable template.',
      });
      const agent = fixtures.createAgent({
        model_id: model.id,
        system_prompt_id: prompt.id,
        personality: 'Friendly',
        instructions: 'Format in markdown',
      });
      const chat = fixtures.createChat({
        agent_id: agent.id,
        context_summary: 'Prior summary',
      });

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
      expect(inspected.systemPrompt).toContain(
        'Context summary:\nPrior summary',
      );
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
      const savedMsg = db.get<any>('SELECT * FROM messages WHERE id = ?', [
        result.id,
      ]);
      expect(savedMsg).toBeDefined();
      expect(savedMsg.chat_id).toBe(chat.id);
      expect(savedMsg.sequence).toBe(2);
      expect(savedMsg.role).toBe('assistant');
      expect(savedMsg.agent_id).toBe(agent.id);
      expect(savedMsg.token_count).toBe(8);

      // Verify chat updated_at advanced
      const updatedChat = db.get<any>('SELECT * FROM chats WHERE id = ?', [
        chat.id,
      ]);
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

    it('succeeds with completion even when analytics recording fails', async () => {
      const mockAnalytics = {
        recordChatCompletion: vi.fn().mockImplementation(() => {
          throw new Error('Analytics database write failure');
        }),
        recordChatCompaction: vi.fn(),
        recordAgentCreated: vi.fn(),
        recordArtifactCreated: vi.fn(),
        record: vi.fn(),
        findById: vi.fn(),
      } as any;

      const testService = new InferenceService(
        db,
        adapterFactory,
        mockCredentialsService as unknown as CredentialsService,
        undefined,
        mockAnalytics,
      );

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

      const result = await testService.completeChat(chat.id, {});
      expect(result).toBeDefined();
      expect(result.content).toBe('Hello! I am ready to help.');
      expect(result.status).toBe('complete');

      const savedMsg = db.get<any>('SELECT * FROM messages WHERE id = ?', [
        result.id,
      ]);
      expect(savedMsg).toBeDefined();
      expect(savedMsg.status).toBe('complete');
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

      const savedMsg = db.get<any>('SELECT * FROM messages WHERE id = ?', [
        result.id,
      ]);
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
        } else if (
          event.type === 'token' &&
          events.filter((e) => e.type === 'token').length === 1
        ) {
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
      expect(errorEvent.data.message).toBe(
        'Provider rate limit reached mid-stream',
      );

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

    it('records a usage event with reported tokens when the provider fails mid-stream after reporting usage', async () => {
      // #302: a generation that already produced output must leave a usage
      // event, carrying whatever the provider reported before the failure.
      const failingAdapter = new TestDoubleAdapter(
        { providerKind: 'openai' },
        {
          cannedStreamEvents: [
            { type: 'text-delta', delta: 'Part1-' },
            {
              type: 'usage',
              usage: { inputTokens: 11, outputTokens: 4, totalTokens: 15 },
            },
            {
              type: 'error',
              error: new RateLimitError(
                'Provider rate limit reached mid-stream',
                'openai',
              ),
            },
          ],
        },
      );
      adapterFactory.register('openai', () => failingAdapter);

      const { chat } = setupChatEnvironment();
      const events: any[] = [];
      for await (const event of service.streamChat(chat.id, {})) {
        events.push(event);
      }

      expect(events.find((e) => e.type === 'error')).toBeDefined();

      const usageRow = db.get<any>(
        "SELECT * FROM usage_events WHERE chat_id = ? AND event_type = 'chat_completion'",
        [chat.id],
      );
      expect(usageRow).toBeDefined();
      expect(usageRow.input_tokens).toBe(11);
      expect(usageRow.output_tokens).toBe(4);
      expect(JSON.parse(usageRow.metadata).outcome).toBe('error');
    });

    it('records a usage event with null tokens when the provider fails mid-stream before reporting usage', async () => {
      // #302: no counts were reported, so the row carries nulls (never zero).
      const failingAdapter = new TestDoubleAdapter(
        { providerKind: 'openai' },
        {
          cannedResponse: { content: 'Part1-Part2-Part3-Part4' },
          streamChunkSize: 6,
          failAfterChunks: 2,
          simulateError: new RateLimitError(
            'Provider rate limit reached mid-stream',
            'openai',
          ),
        },
      );
      adapterFactory.register('openai', () => failingAdapter);

      const { chat } = setupChatEnvironment();
      for await (const _event of service.streamChat(chat.id, {})) {
        // consume
      }

      const usageRow = db.get<any>(
        "SELECT * FROM usage_events WHERE chat_id = ? AND event_type = 'chat_completion'",
        [chat.id],
      );
      expect(usageRow).toBeDefined();
      expect(usageRow.input_tokens).toBeNull();
      expect(usageRow.output_tokens).toBeNull();
      expect(JSON.parse(usageRow.metadata).outcome).toBe('error');
    });

    it('records a usage event when the client disconnects after partial content', async () => {
      // #302: the partial reply is persisted as a completed message, so the
      // usage log must account for the generation that produced it.
      const ac = new AbortController();
      let chunksReceived = 0;

      const { chat } = setupChatEnvironment();
      const generator = service.streamChat(chat.id, {}, { signal: ac.signal });

      for await (const event of generator) {
        if (event.type === 'token') {
          chunksReceived++;
          if (chunksReceived === 1) {
            ac.abort(new Error('Client aborted'));
          }
        }
      }

      expect(chunksReceived).toBe(1);

      const usageRow = db.get<any>(
        "SELECT * FROM usage_events WHERE chat_id = ? AND event_type = 'chat_completion'",
        [chat.id],
      );
      expect(usageRow).toBeDefined();
      expect(JSON.parse(usageRow.metadata).outcome).toBe('cancelled');
    });

    it('records a usage event when the client disconnects before any content', async () => {
      // #302: even with no output, the interrupted row exists, so the event does too.
      const ac = new AbortController();
      const { chat } = setupChatEnvironment();

      const delayedAdapter = new TestDoubleAdapter(
        { providerKind: 'openai' },
        {
          streamDelayMs: 50,
          cannedResponse: { content: 'Slow generation' },
        },
      );
      adapterFactory.register('openai', () => delayedAdapter);

      const generator = service.streamChat(chat.id, {}, { signal: ac.signal });

      for await (const event of generator) {
        if (event.type === 'message_start') {
          ac.abort(new Error('Immediate client disconnect'));
        }
      }

      const usageRow = db.get<any>(
        "SELECT * FROM usage_events WHERE chat_id = ? AND event_type = 'chat_completion'",
        [chat.id],
      );
      expect(usageRow).toBeDefined();
      expect(usageRow.input_tokens).toBeNull();
      expect(usageRow.output_tokens).toBeNull();
      expect(JSON.parse(usageRow.metadata).outcome).toBe('cancelled');
    });

    it('checkpoints partial content to SQLite periodically when 200 chars threshold is reached', async () => {
      // 5 chunks of 50 chars = 250 chars total
      const longText =
        'A'.repeat(50) +
        'B'.repeat(50) +
        'C'.repeat(50) +
        'D'.repeat(50) +
        'E'.repeat(50);
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

  describe('compactChat', () => {
    function setupCompactionChat() {
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

    it('produces a summary, stores in context_summary, advances updated_at, and records usage', async () => {
      const { chat } = setupCompactionChat();

      for (let i = 1; i <= 4; i++) {
        fixtures.createMessage({
          chat_id: chat.id,
          sequence: i,
          role: i % 2 === 1 ? 'user' : 'assistant',
          content: `Message ${i}`,
        });
      }

      const cannedSummary = 'Summary of conversation turns 1 and 2.';
      const customAdapter = new TestDoubleAdapter(
        { providerKind: 'openai' },
        {
          cannedResponse: {
            content: cannedSummary,
            finishReason: 'stop',
            usage: { inputTokens: 40, outputTokens: 15, totalTokens: 55 },
          },
        },
      );
      adapterFactory.register('openai', () => customAdapter);

      const response = await service.compactChat(chat.id, {
        preserveRecentCount: 2,
      });

      expect(response.contextSummary).toBe(cannedSummary);
      expect(response.compactedBeforeSequence).toBe(3);
      expect(response.compactedMessagesCount).toBe(2);
      expect(new Date(response.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(chat.created_at).getTime(),
      );

      // Verify database state
      const row = db.get<{
        context_summary: string;
        compacted_before_sequence: number;
        updated_at: string;
      }>(
        'SELECT context_summary, compacted_before_sequence, updated_at FROM chats WHERE id = ?',
        [chat.id],
      );
      expect(row.context_summary).toBe(cannedSummary);
      expect(row.compacted_before_sequence).toBe(3);

      // Verify adapter prompt received expected turns (1 and 2, not 3 and 4)
      const lastReq = customAdapter.completedRequests[0];
      expect(lastReq.messages[0].content).toContain(
        '[Sequence 1 | user]:\nMessage 1',
      );
      expect(lastReq.messages[0].content).toContain(
        '[Sequence 2 | assistant]:\nMessage 2',
      );
      expect(lastReq.messages[0].content).not.toContain('Message 3');
      expect(lastReq.messages[0].content).not.toContain('Message 4');

      // Verify usage_events entry
      const usageRow = db.get<{
        event_type: string;
        input_tokens: number;
        output_tokens: number;
      }>('SELECT * FROM usage_events WHERE chat_id = ? AND event_type = ?', [
        chat.id,
        'chat_compaction',
      ]);
      expect(usageRow).toBeDefined();
      expect(usageRow.input_tokens).toBe(40);
      expect(usageRow.output_tokens).toBe(15);
    });

    it('preserves recent messages per default (2) and overridable count', async () => {
      const { chat } = setupCompactionChat();

      for (let i = 1; i <= 6; i++) {
        fixtures.createMessage({
          chat_id: chat.id,
          sequence: i,
          role: i % 2 === 1 ? 'user' : 'assistant',
          content: `Content ${i}`,
        });
      }

      // Default preserve count (2): compacts turns 1-4, preserves 5-6
      const defaultRes = await service.compactChat(chat.id);
      expect(defaultRes.compactedBeforeSequence).toBe(5);
      expect(defaultRes.compactedMessagesCount).toBe(4);

      // Reset chat compaction boundary and test preserveRecentCount = 0
      db.run(
        'UPDATE chats SET context_summary = NULL, compacted_before_sequence = NULL WHERE id = ?',
        [chat.id],
      );

      const allCompactedRes = await service.compactChat(chat.id, {
        preserveRecentCount: 0,
      });
      expect(allCompactedRes.compactedBeforeSequence).toBe(7);
      expect(allCompactedRes.compactedMessagesCount).toBe(6);
    });

    it('compacting twice folds the existing summary in rather than discarding it', async () => {
      const { chat } = setupCompactionChat();

      for (let i = 1; i <= 4; i++) {
        fixtures.createMessage({
          chat_id: chat.id,
          sequence: i,
          role: i % 2 === 1 ? 'user' : 'assistant',
          content: `Step ${i}`,
        });
      }

      let callCount = 0;
      const customAdapter = new TestDoubleAdapter(
        { providerKind: 'openai' },
        {
          cannedResponse: {
            content: 'Initial Summary',
            finishReason: 'stop',
          },
        },
      );
      // Spy on complete to change responses across calls
      const origComplete = customAdapter.complete.bind(customAdapter);
      customAdapter.complete = async (req, opts) => {
        callCount++;
        const res = await origComplete(req, opts);
        if (callCount === 2) {
          return {
            ...res,
            content: 'Combined Unified Summary',
          };
        }
        return res;
      };
      adapterFactory.register('openai', () => customAdapter);

      // Compaction 1: turns 1-2 compacted, 3-4 preserved
      const firstRes = await service.compactChat(chat.id, {
        preserveRecentCount: 2,
      });
      expect(firstRes.contextSummary).toBe('Initial Summary');
      expect(firstRes.compactedBeforeSequence).toBe(3);
      expect(firstRes.compactedMessagesCount).toBe(2);

      // Add messages 5 and 6
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 5,
        role: 'user',
        content: 'Step 5',
      });
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 6,
        role: 'assistant',
        content: 'Step 6',
      });

      // Compaction 2: uncompacted are 3, 4, 5, 6; preserve 2 (5, 6) -> compacts 3, 4
      const secondRes = await service.compactChat(chat.id, {
        preserveRecentCount: 2,
      });

      expect(secondRes.contextSummary).toBe('Combined Unified Summary');
      expect(secondRes.compactedBeforeSequence).toBe(5);
      expect(secondRes.compactedMessagesCount).toBe(4);

      // Assert the second request included the prior summary and the new turns
      const secondReq = customAdapter.completedRequests[1];
      expect(secondReq.messages[0].content).toContain('<prior_summary>');
      expect(secondReq.messages[0].content).toContain('Initial Summary');
      expect(secondReq.messages[0].content).toContain('<new_turns>');
      expect(secondReq.messages[0].content).toContain(
        '[Sequence 3 | user]:\nStep 3',
      );
      expect(secondReq.messages[0].content).toContain(
        '[Sequence 4 | assistant]:\nStep 4',
      );
    });

    it('records compaction point so context construction covers every message exactly once with no duplication and no gap', async () => {
      const { chat } = setupCompactionChat();

      for (let i = 1; i <= 5; i++) {
        fixtures.createMessage({
          chat_id: chat.id,
          sequence: i,
          role: i % 2 === 1 ? 'user' : 'assistant',
          content: `Turn ${i} details`,
        });
      }

      await service.compactChat(chat.id, { preserveRecentCount: 2 });

      // Inspect assembled context through context construction
      const assembled = service.inspectContext(chat.id);

      // Summary is placed in system context
      expect(assembled.systemPrompt).toContain(
        'Context summary:\nHello! I am ready to help.',
      );

      // Active messages contain exactly turns 4 and 5 (uncompacted)
      expect(assembled.messages).toHaveLength(2);
      expect(assembled.messages[0].content).toBe('Turn 4 details');
      expect(assembled.messages[1].content).toBe('Turn 5 details');

      // Superseded messages (1, 2, 3) are tracked in excludedMessages as compacted_history
      expect(assembled.excludedMessages).toHaveLength(3);
      expect(assembled.excludedMessages.map((m) => m.sequence)).toEqual([
        1, 2, 3,
      ]);
      expect(assembled.excludedMessages[0].reason).toBe('compacted_history');
      expect(assembled.excludedMessages[1].reason).toBe('compacted_history');
      expect(assembled.excludedMessages[2].reason).toBe('compacted_history');

      // Assert complete coverage: every message 1..5 is represented either in summary or active turns
      const allAccountedSequences = [
        ...assembled.excludedMessages.map((m) => m.sequence),
        ...assembled.messageDetails.map((m) => m.sequence),
      ].sort((a, b) => a - b);
      expect(allAccountedSequences).toEqual([1, 2, 3, 4, 5]);
    });

    it('ensures message posted while compaction is in flight is not silently lost', async () => {
      const { chat } = setupCompactionChat();

      for (let i = 1; i <= 4; i++) {
        fixtures.createMessage({
          chat_id: chat.id,
          sequence: i,
          role: i % 2 === 1 ? 'user' : 'assistant',
          content: `Pre-existing turn ${i}`,
        });
      }

      const customAdapter = new TestDoubleAdapter(
        { providerKind: 'openai' },
        {
          cannedResponse: {
            content: 'Summary of turns 1-2',
            finishReason: 'stop',
          },
        },
      );

      // Simulate a concurrent message arriving while provider summarisation is in flight
      customAdapter.complete = async () => {
        fixtures.createMessage({
          chat_id: chat.id,
          sequence: 5,
          role: 'user',
          content: 'Concurrent message arriving mid-flight',
        });
        return {
          content: 'Summary of turns 1-2',
          finishReason: 'stop',
        };
      };
      adapterFactory.register('openai', () => customAdapter);

      const result = await service.compactChat(chat.id, {
        preserveRecentCount: 2,
      });

      // Boundary is sequence 3 (maxSequenceSent was 2, so 2 + 1 = 3)
      expect(result.compactedBeforeSequence).toBe(3);

      // Verify concurrent message 5 is in SQLite
      const message5 = db.get<{ content: string }>(
        'SELECT content FROM messages WHERE chat_id = ? AND sequence = 5',
        [chat.id],
      );
      expect(message5.content).toBe('Concurrent message arriving mid-flight');

      // Verify inspectContext includes message 5 in active messages
      const assembled = service.inspectContext(chat.id);
      const activeContents = assembled.messages.map((m) => m.content);
      expect(activeContents).toContain('Pre-existing turn 3');
      expect(activeContents).toContain('Pre-existing turn 4');
      expect(activeContents).toContain(
        'Concurrent message arriving mid-flight',
      );
      expect(activeContents).not.toContain('Pre-existing turn 1');
      expect(activeContents).not.toContain('Pre-existing turn 2');
    });

    it('retains all summarised messages in SQLite so full history remains readable', async () => {
      const { chat } = setupCompactionChat();

      for (let i = 1; i <= 4; i++) {
        fixtures.createMessage({
          chat_id: chat.id,
          sequence: i,
          role: 'user',
          content: `Permanent message ${i}`,
        });
      }

      await service.compactChat(chat.id, { preserveRecentCount: 2 });

      // Assert all 4 messages still exist in the messages table
      const rows = db.all<{ sequence: number; content: string }>(
        'SELECT sequence, content FROM messages WHERE chat_id = ? ORDER BY sequence ASC',
        [chat.id],
      );
      expect(rows).toHaveLength(4);
      expect(rows.map((r) => r.sequence)).toEqual([1, 2, 3, 4]);
      expect(rows[0].content).toBe('Permanent message 1');
      expect(rows[1].content).toBe('Permanent message 2');
    });

    it('rejects with distinct error for each resolution chain failure', async () => {
      // 1. Unknown chat (404)
      await expect(service.compactChat('non-existent-chat-id')).rejects.toThrow(
        NotFoundException,
      );

      // 2. Team chat with no members (422)
      const team = fixtures.createTeam();
      const teamChat = fixtures.createChat({
        team_id: team.id,
        agent_id: null,
      });
      await expect(service.compactChat(teamChat.id)).rejects.toThrow(
        new UnprocessableEntityException({
          code: 'TEAM_HAS_NO_MEMBERS',
          message: 'Team has no active members to execute completions',
        }),
      );

      // 3. Chat has no agent (422)
      const agent = fixtures.createAgent();
      const noAgentChat = fixtures.createChat({ agent_id: agent.id });
      db.run('PRAGMA ignore_check_constraints = ON;');
      db.run('UPDATE chats SET agent_id = NULL WHERE id = ?', [noAgentChat.id]);
      db.run('PRAGMA ignore_check_constraints = OFF;');
      await expect(service.compactChat(noAgentChat.id)).rejects.toThrow(
        new UnprocessableEntityException({
          code: 'CHAT_HAS_NO_AGENT',
          message: 'Chat has no assigned agent to execute completions',
        }),
      );

      // 4. Agent has no model (422)
      const agentWithoutModel = fixtures.createAgent({ model_id: null });
      const chatWithoutModel = fixtures.createChat({
        agent_id: agentWithoutModel.id,
      });
      await expect(service.compactChat(chatWithoutModel.id)).rejects.toThrow(
        new UnprocessableEntityException({
          code: 'AGENT_HAS_NO_MODEL',
          message: `Agent "${agentWithoutModel.name}" has no model configured`,
        }),
      );

      // 5. Disabled model (422)
      const provider = fixtures.createProvider({ kind: 'openai', enabled: 1 });
      const disabledModel = fixtures.createModel({
        provider_id: provider.id,
        enabled: 0,
      });
      const agentWithDisabledModel = fixtures.createAgent({
        model_id: disabledModel.id,
      });
      const chatWithDisabledModel = fixtures.createChat({
        agent_id: agentWithDisabledModel.id,
      });
      await expect(
        service.compactChat(chatWithDisabledModel.id),
      ).rejects.toThrow(
        new UnprocessableEntityException({
          code: 'MODEL_DISABLED',
          message: `Model "${disabledModel.display_name}" is disabled`,
        }),
      );

      // 6. Disabled provider (422)
      const disabledProvider = fixtures.createProvider({
        kind: 'openai',
        enabled: 0,
      });
      const activeModel = fixtures.createModel({
        provider_id: disabledProvider.id,
        enabled: 1,
      });
      const agentWithDisabledProvider = fixtures.createAgent({
        model_id: activeModel.id,
      });
      const chatWithDisabledProvider = fixtures.createChat({
        agent_id: agentWithDisabledProvider.id,
      });
      await expect(
        service.compactChat(chatWithDisabledProvider.id),
      ).rejects.toThrow(
        new UnprocessableEntityException({
          code: 'PROVIDER_DISABLED',
          message: `Provider "${disabledProvider.name}" is disabled`,
        }),
      );

      // 7. Missing credential for hosted provider (422)
      mockCredentialsService.getDecryptedCredential.mockReturnValue(null);
      const activeProvider = fixtures.createProvider({
        kind: 'openai',
        is_local: 0,
        enabled: 1,
      });
      const validModel = fixtures.createModel({
        provider_id: activeProvider.id,
        enabled: 1,
      });
      const agentMissingCred = fixtures.createAgent({
        model_id: validModel.id,
      });
      const chatMissingCred = fixtures.createChat({
        agent_id: agentMissingCred.id,
      });
      await expect(service.compactChat(chatMissingCred.id)).rejects.toThrow(
        new UnprocessableEntityException({
          code: 'CREDENTIAL_MISSING',
          message: `Provider "${activeProvider.name}" requires an API credential that is not configured`,
        }),
      );
    });

    it('supports modelId override', async () => {
      const { provider, chat } = setupCompactionChat();
      const overrideModel = fixtures.createModel({
        provider_id: provider.id,
        model_identifier: 'gpt-4o-mini',
        enabled: 1,
      });

      for (let i = 1; i <= 4; i++) {
        fixtures.createMessage({
          chat_id: chat.id,
          sequence: i,
          role: 'user',
          content: `Msg ${i}`,
        });
      }

      await service.compactChat(chat.id, {
        modelId: overrideModel.id,
        preserveRecentCount: 2,
      });

      expect(testDouble.completedRequests[0].model).toBe('gpt-4o-mini');
    });

    it('rejects invalid options with 400 BadRequestException', async () => {
      const { chat } = setupCompactionChat();

      // Negative preserveRecentCount
      await expect(
        service.compactChat(chat.id, { preserveRecentCount: -1 }),
      ).rejects.toThrow(BadRequestException);

      // No uncompacted messages
      await expect(
        service.compactChat(chat.id, { preserveRecentCount: 2 }),
      ).rejects.toThrow(BadRequestException);

      // Chat with 2 messages, preserveRecentCount = 2 (not enough to compact)
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        role: 'user',
        content: 'Hi',
      });
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 2,
        role: 'assistant',
        content: 'Hello',
      });

      await expect(
        service.compactChat(chat.id, { preserveRecentCount: 2 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('maps provider errors and redacts credentials', async () => {
      const { chat } = setupCompactionChat();
      const secretKey = 'sk-super-secret-key-4242';
      mockCredentialsService.getDecryptedCredential.mockReturnValue(secretKey);

      for (let i = 1; i <= 4; i++) {
        fixtures.createMessage({
          chat_id: chat.id,
          sequence: i,
          role: 'user',
          content: `Test msg ${i}`,
        });
      }

      const failingAdapter = new TestDoubleAdapter(
        { providerKind: 'openai' },
        {
          simulateError: new RateLimitError(
            `Rate limit exceeded for key ${secretKey}`,
            'openai',
          ),
        },
      );
      adapterFactory.register('openai', () => failingAdapter);

      await expect(service.compactChat(chat.id)).rejects.toSatisfy(
        (err: any) => {
          expect(err.statusCode).toBe(429);
          expect(err.message).not.toContain(secretKey);
          expect(err.message).toContain('[REDACTED]');
          return true;
        },
      );
    });
  });

  // =========================================================================
  // Multi-Agent Team Chat Orchestration (RFC 67)
  // =========================================================================
  describe('multi-agent team chat orchestration (RFC 67)', () => {
    it('executes team members sequentially in position ascending order', async () => {
      const provider = fixtures.createProvider({ kind: 'openai', is_local: 0 });
      const model = fixtures.createModel(provider.id, {
        context_window: 128000,
        default_temperature: 0.7,
      });

      const alice = fixtures.createAgent({ name: 'Alice', model_id: model.id });
      const bob = fixtures.createAgent({ name: 'Bob', model_id: model.id });
      const charlie = fixtures.createAgent({
        name: 'Charlie',
        model_id: model.id,
      });

      const team = fixtures.createTeam({ name: 'Engineering Team' });
      fixtures.createTeamMember(team.id, alice.id, {
        position: 1,
        role: 'Architect',
      });
      fixtures.createTeamMember(team.id, bob.id, {
        position: 2,
        role: 'Implementer',
      });
      fixtures.createTeamMember(team.id, charlie.id, {
        position: 3,
        role: 'Reviewer',
      });

      const chat = fixtures.createChat({ agent_id: null, team_id: team.id });
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        role: 'user',
        content: 'Build the notification system',
        status: 'complete',
      });

      let callCount = 0;
      testDouble.complete = vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          content: `Reply from agent ${callCount}`,
          finishReason: 'stop',
          usage: {
            inputTokens: 10 * callCount,
            outputTokens: 5,
            totalTokens: 10 * callCount + 5,
          },
        };
      });

      const response = await service.completeChat(chat.id, {});

      expect(callCount).toBe(3);
      expect(response.messages).toHaveLength(3);
      expect(response.messages![0].agentId).toBe(alice.id);
      expect(response.messages![0].content).toBe('Reply from agent 1');
      expect(response.messages![0].sequence).toBe(2);

      expect(response.messages![1].agentId).toBe(bob.id);
      expect(response.messages![1].content).toBe('Reply from agent 2');
      expect(response.messages![1].sequence).toBe(3);

      expect(response.messages![2].agentId).toBe(charlie.id);
      expect(response.messages![2].content).toBe('Reply from agent 3');
      expect(response.messages![2].sequence).toBe(4);

      // Top-level response reflects final message
      expect(response.id).toBe(response.messages![2].id);
      expect(response.agentId).toBe(charlie.id);

      // Usage events recorded for each member
      const usageRows = db.all<{ agent_id: string }>(
        'SELECT agent_id FROM usage_events WHERE chat_id = ? ORDER BY occurred_at ASC',
        [chat.id],
      );
      expect(usageRows).toHaveLength(3);
      expect(usageRows[0].agent_id).toBe(alice.id);
      expect(usageRows[1].agent_id).toBe(bob.id);
      expect(usageRows[2].agent_id).toBe(charlie.id);
    });

    it('respects deterministic tie-breaking (position ASC NULLS LAST, created_at ASC, agent_id ASC)', async () => {
      const provider = fixtures.createProvider({ kind: 'openai', is_local: 0 });
      const model = fixtures.createModel(provider.id);

      const agentA = fixtures.createAgent({
        name: 'Agent A',
        model_id: model.id,
      });
      const agentB = fixtures.createAgent({
        name: 'Agent B',
        model_id: model.id,
      });
      const agentC = fixtures.createAgent({
        name: 'Agent C',
        model_id: model.id,
      });

      const team = fixtures.createTeam({ name: 'Tiebreaker Team' });
      fixtures.createTeamMember(team.id, agentA.id, { position: 2 });
      fixtures.createTeamMember(team.id, agentB.id, { position: 1 });
      fixtures.createTeamMember(team.id, agentC.id, { position: null as any });

      const chat = fixtures.createChat({ agent_id: null, team_id: team.id });
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        role: 'user',
        content: 'Go',
      });

      testDouble.complete = vi.fn().mockResolvedValue({
        content: 'Done',
        finishReason: 'stop',
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
      });

      const res = await service.completeChat(chat.id, {});
      expect(res.messages).toHaveLength(3);
      expect(res.messages![0].agentId).toBe(agentB.id); // Pos 1
      expect(res.messages![1].agentId).toBe(agentA.id); // Pos 2
      expect(res.messages![2].agentId).toBe(agentC.id); // Pos NULL
    });

    it('degenerates cleanly for a 1-member team', async () => {
      const provider = fixtures.createProvider({ kind: 'openai', is_local: 0 });
      const model = fixtures.createModel(provider.id);
      const solo = fixtures.createAgent({ name: 'Solo', model_id: model.id });

      const team = fixtures.createTeam({ name: 'Solo Team' });
      fixtures.createTeamMember(team.id, solo.id, { position: 1 });

      const chat = fixtures.createChat({ agent_id: null, team_id: team.id });
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        role: 'user',
        content: 'Solo query',
      });

      testDouble.complete = vi.fn().mockResolvedValue({
        content: 'Solo response',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      });

      const response = await service.completeChat(chat.id, {});
      expect(response.agentId).toBe(solo.id);
      expect(response.content).toBe('Solo response');
      expect(response.messages).toHaveLength(1);
      expect(response.messages![0].agentId).toBe(solo.id);
    });

    it('frames peer messages with participant banners in context for subsequent agents', async () => {
      const provider = fixtures.createProvider({ kind: 'openai', is_local: 0 });
      const model = fixtures.createModel(provider.id);

      const alice = fixtures.createAgent({ name: 'Alice', model_id: model.id });
      const bob = fixtures.createAgent({ name: 'Bob', model_id: model.id });

      const team = fixtures.createTeam({ name: 'Dev Team' });
      fixtures.createTeamMember(team.id, alice.id, {
        position: 1,
        role: 'Lead Architect',
      });
      fixtures.createTeamMember(team.id, bob.id, {
        position: 2,
        role: 'Database Engineer',
      });

      const chat = fixtures.createChat({ agent_id: null, team_id: team.id });
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        role: 'user',
        content: 'What DB should we use?',
      });

      const contextsSeen: any[] = [];
      testDouble.complete = vi.fn().mockImplementation(async (req) => {
        contextsSeen.push(req);
        return {
          content:
            contextsSeen.length === 1
              ? 'Use SQLite with WAL mode'
              : 'I agree with SQLite',
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        };
      });

      await service.completeChat(chat.id, {});

      expect(contextsSeen).toHaveLength(2);

      // Alice saw user prompt
      expect(contextsSeen[0].messages).toHaveLength(1);
      expect(contextsSeen[0].messages[0].role).toBe('user');
      expect(contextsSeen[0].messages[0].content).toBe(
        'What DB should we use?',
      );
      expect(contextsSeen[0].systemPrompt).toContain(
        "In this conversation, you are collaborating as the Lead Architect for team 'Dev Team'.",
      );

      // Bob saw user prompt AND Alice's reply framed with participant banner
      expect(contextsSeen[1].messages).toHaveLength(2);
      expect(contextsSeen[1].messages[0].role).toBe('user');
      expect(contextsSeen[1].messages[1].role).toBe('assistant');
      expect(contextsSeen[1].messages[1].content).toBe(
        '[Team Member: Alice (Lead Architect)]:\nUse SQLite with WAL mode',
      );
      expect(contextsSeen[1].systemPrompt).toContain(
        "In this conversation, you are collaborating as the Database Engineer for team 'Dev Team'.",
      );
    });

    it('terminates early if an agent emits the early exit token <!-- GB_TEAM_FINISH -->', async () => {
      const provider = fixtures.createProvider({ kind: 'openai', is_local: 0 });
      const model = fixtures.createModel(provider.id);

      const alice = fixtures.createAgent({ name: 'Alice', model_id: model.id });
      const bob = fixtures.createAgent({ name: 'Bob', model_id: model.id });

      const team = fixtures.createTeam({ name: 'Fast Team' });
      fixtures.createTeamMember(team.id, alice.id, { position: 1 });
      fixtures.createTeamMember(team.id, bob.id, { position: 2 });

      const chat = fixtures.createChat({ agent_id: null, team_id: team.id });
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        role: 'user',
        content: 'Simple question',
      });

      testDouble.complete = vi.fn().mockResolvedValue({
        content: 'This answers everything directly. <!-- GB_TEAM_FINISH -->',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
      });

      const response = await service.completeChat(chat.id, {});
      expect(testDouble.complete).toHaveBeenCalledTimes(1); // Only Alice called!
      expect(response.messages).toHaveLength(1);
      expect(response.messages![0].agentId).toBe(alice.id);
    });

    it('pauses pipeline gracefully and preserves partial progress on mid-turn failure', async () => {
      const provider = fixtures.createProvider({ kind: 'openai', is_local: 0 });
      const model = fixtures.createModel(provider.id);

      const alice = fixtures.createAgent({ name: 'Alice', model_id: model.id });
      const bob = fixtures.createAgent({ name: 'Bob', model_id: model.id });
      const charlie = fixtures.createAgent({
        name: 'Charlie',
        model_id: model.id,
      });

      const team = fixtures.createTeam({ name: 'Resilient Team' });
      fixtures.createTeamMember(team.id, alice.id, { position: 1 });
      fixtures.createTeamMember(team.id, bob.id, { position: 2 });
      fixtures.createTeamMember(team.id, charlie.id, { position: 3 });

      const chat = fixtures.createChat({ agent_id: null, team_id: team.id });
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        role: 'user',
        content: 'Run test',
      });

      let call = 0;
      testDouble.complete = vi.fn().mockImplementation(async () => {
        call++;
        if (call === 1) {
          return {
            content: 'Alice completed turn',
            finishReason: 'stop',
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          };
        }
        // Bob fails with rate limit
        throw new RateLimitError('Provider rate limit reached', 'openai');
      });

      await expect(service.completeChat(chat.id, {})).rejects.toThrow(
        RateLimitError,
      );

      // Charlie (member 3) was never called
      expect(testDouble.complete).toHaveBeenCalledTimes(2);

      // Check SQLite state:
      // Alice's message is persisted with status 'complete'
      const aliceMsg = db.get<any>(
        'SELECT * FROM messages WHERE chat_id = ? AND agent_id = ?',
        [chat.id, alice.id],
      );
      expect(aliceMsg).toBeDefined();
      expect(aliceMsg.status).toBe('complete');
      expect(aliceMsg.content).toBe('Alice completed turn');

      // Bob's message recorded with status 'error'
      const bobMsg = db.get<any>(
        'SELECT * FROM messages WHERE chat_id = ? AND agent_id = ?',
        [chat.id, bob.id],
      );
      expect(bobMsg).toBeDefined();
      expect(bobMsg.status).toBe('error');

      // Charlie's message was not created
      const charlieMsg = db.get<any>(
        'SELECT * FROM messages WHERE chat_id = ? AND agent_id = ?',
        [chat.id, charlie.id],
      );
      expect(charlieMsg).toBeUndefined();
    });

    it('streams multi-agent team completion multiplexing sequential message_start and complete events', async () => {
      const provider = fixtures.createProvider({ kind: 'openai', is_local: 0 });
      const model = fixtures.createModel(provider.id);

      const alice = fixtures.createAgent({ name: 'Alice', model_id: model.id });
      const bob = fixtures.createAgent({ name: 'Bob', model_id: model.id });

      const team = fixtures.createTeam({ name: 'Streaming Team' });
      fixtures.createTeamMember(team.id, alice.id, {
        position: 1,
        role: 'Drafter',
      });
      fixtures.createTeamMember(team.id, bob.id, {
        position: 2,
        role: 'Editor',
      });

      const chat = fixtures.createChat({ agent_id: null, team_id: team.id });
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        role: 'user',
        content: 'Stream collaborate',
      });

      let streamCall = 0;
      testDouble.stream = vi.fn().mockImplementation(async function* () {
        streamCall++;
        if (streamCall === 1) {
          yield { type: 'text-delta', delta: 'Draft content ' };
          yield { type: 'text-delta', delta: 'from Alice' };
          yield {
            type: 'usage',
            usage: { inputTokens: 10, outputTokens: 6, totalTokens: 16 },
          };
          yield { type: 'complete', finishReason: 'stop' };
        } else {
          yield { type: 'text-delta', delta: 'Edited content ' };
          yield { type: 'text-delta', delta: 'from Bob' };
          yield {
            type: 'usage',
            usage: { inputTokens: 20, outputTokens: 6, totalTokens: 26 },
          };
          yield { type: 'complete', finishReason: 'stop' };
        }
      });

      const generator = service.streamChat(chat.id, { stream: true });
      const events: any[] = [];
      for await (const event of generator) {
        events.push(event);
      }

      // Check event taxonomy sequence
      const messageStarts = events.filter((e) => e.type === 'message_start');
      expect(messageStarts).toHaveLength(2);
      expect(messageStarts[0].data.agentId).toBe(alice.id);
      expect(messageStarts[0].data.agentName).toBe('Alice (Drafter)');
      expect(messageStarts[1].data.agentId).toBe(bob.id);
      expect(messageStarts[1].data.agentName).toBe('Bob (Editor)');

      const messageCompletes = events.filter(
        (e) => e.type === 'message_complete',
      );
      expect(messageCompletes).toHaveLength(2);
      expect(messageCompletes[0].data.messageId).toBe(
        messageStarts[0].data.messageId,
      );
      expect(messageCompletes[1].data.messageId).toBe(
        messageStarts[1].data.messageId,
      );

      // Terminal aggregate usage
      const terminalUsage = events.find((e) => e.type === 'usage');
      expect(terminalUsage).toBeDefined();
      expect(terminalUsage.data.inputTokens).toBe(30); // 10 + 20
      expect(terminalUsage.data.outputTokens).toBe(12); // 6 + 6
      expect(terminalUsage.data.totalTokens).toBe(42); // 16 + 26

      // Terminal done event
      const doneEvent = events[events.length - 1];
      expect(doneEvent.type).toBe('done');
      expect(doneEvent.data).toBe('[DONE]');

      // Check SQLite rows
      const dbMessages = db.all<any>(
        'SELECT * FROM messages WHERE chat_id = ? ORDER BY sequence ASC',
        [chat.id],
      );
      expect(dbMessages).toHaveLength(3); // 1 user + 2 assistant
      expect(dbMessages[1].status).toBe('complete');
      expect(dbMessages[1].content).toBe('Draft content from Alice');
      expect(dbMessages[2].status).toBe('complete');
      expect(dbMessages[2].content).toBe('Edited content from Bob');
    });

    it('delivers in-band error and halts downstream streaming when mid-stream failure occurs', async () => {
      const provider = fixtures.createProvider({ kind: 'openai', is_local: 0 });
      const model = fixtures.createModel(provider.id);

      const alice = fixtures.createAgent({ name: 'Alice', model_id: model.id });
      const bob = fixtures.createAgent({ name: 'Bob', model_id: model.id });

      const team = fixtures.createTeam({ name: 'Error Team' });
      fixtures.createTeamMember(team.id, alice.id, { position: 1 });
      fixtures.createTeamMember(team.id, bob.id, { position: 2 });

      const chat = fixtures.createChat({ agent_id: null, team_id: team.id });
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        role: 'user',
        content: 'Stream error test',
      });

      let streamCall = 0;
      testDouble.stream = vi.fn().mockImplementation(async function* () {
        streamCall++;
        if (streamCall === 1) {
          yield { type: 'text-delta', delta: 'Alice OK' };
          yield {
            type: 'usage',
            usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
          };
          yield { type: 'complete', finishReason: 'stop' };
        } else {
          yield { type: 'text-delta', delta: 'Bob partial ' };
          yield {
            type: 'error',
            error: new RateLimitError('Stream rate limit exceeded', 'openai'),
          };
        }
      });

      const generator = service.streamChat(chat.id, { stream: true });
      const events: any[] = [];
      for await (const event of generator) {
        events.push(event);
      }

      // Alice completed
      const aliceStart = events.find(
        (e) => e.type === 'message_start' && e.data.agentId === alice.id,
      );
      expect(aliceStart).toBeDefined();
      const aliceComplete = events.find(
        (e) =>
          e.type === 'message_complete' &&
          e.data.messageId === aliceStart.data.messageId,
      );
      expect(aliceComplete).toBeDefined();

      // Bob failed in-band
      const inBandError = events.find((e) => e.type === 'error');
      expect(inBandError).toBeDefined();
      expect(inBandError.data.code).toBe('RATE_LIMIT_EXCEEDED');

      // Terminal done emitted
      expect(events[events.length - 1].type).toBe('done');

      // Bob's message in SQLite is marked error, partial content preserved
      const bobMsg = db.get<any>(
        'SELECT * FROM messages WHERE chat_id = ? AND agent_id = ?',
        [chat.id, bob.id],
      );
      expect(bobMsg.status).toBe('error');
      expect(bobMsg.content).toBe('Bob partial ');
    });

    it('records a usage event for a team member whose turn fails mid-stream', async () => {
      // #302: Alice's successful turn and Bob's failed turn each leave one
      // chat_completion row; Bob's carries the usage he reported plus the
      // outcome marker, instead of leaving no row at all.
      const provider = fixtures.createProvider({ kind: 'openai', is_local: 0 });
      const model = fixtures.createModel(provider.id);

      const alice = fixtures.createAgent({ name: 'Alice', model_id: model.id });
      const bob = fixtures.createAgent({ name: 'Bob', model_id: model.id });

      const team = fixtures.createTeam({ name: 'Error Team' });
      fixtures.createTeamMember(team.id, alice.id, { position: 1 });
      fixtures.createTeamMember(team.id, bob.id, { position: 2 });

      const chat = fixtures.createChat({ agent_id: null, team_id: team.id });
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        role: 'user',
        content: 'Stream error test',
      });

      let streamCall = 0;
      testDouble.stream = vi.fn().mockImplementation(async function* () {
        streamCall++;
        if (streamCall === 1) {
          yield { type: 'text-delta', delta: 'Draft content ' };
          yield { type: 'text-delta', delta: 'from Alice' };
          yield {
            type: 'usage',
            usage: { inputTokens: 10, outputTokens: 6, totalTokens: 16 },
          };
          yield { type: 'complete', finishReason: 'stop' };
        } else {
          yield { type: 'text-delta', delta: 'Edited content ' };
          yield {
            type: 'usage',
            usage: { inputTokens: 20, outputTokens: 3, totalTokens: 23 },
          };
          throw new RateLimitError('Provider rate limit reached', 'openai');
        }
      });

      const generator = service.streamChat(chat.id, { stream: true });
      const events: any[] = [];
      for await (const event of generator) {
        events.push(event);
      }

      expect(events.find((e) => e.type === 'error')).toBeDefined();

      const usageRows = db.all<any>(
        "SELECT * FROM usage_events WHERE chat_id = ? AND event_type = 'chat_completion'",
        [chat.id],
      );
      expect(usageRows).toHaveLength(2);

      const aliceRow = usageRows.find((r: any) => r.agent_id === alice.id);
      expect(aliceRow).toBeDefined();
      expect(aliceRow.input_tokens).toBe(10);
      expect(aliceRow.output_tokens).toBe(6);

      const bobRow = usageRows.find((r: any) => r.agent_id === bob.id);
      expect(bobRow).toBeDefined();
      expect(bobRow.input_tokens).toBe(20);
      expect(bobRow.output_tokens).toBe(3);
      expect(JSON.parse(bobRow.metadata).outcome).toBe('error');
    });

    describe('Phase 2: Designated Coordinator (Router Agent)', () => {
      it('answers directly when coordinator does not delegate', async () => {
        const provider = fixtures.createProvider({
          kind: 'openai',
          is_local: 0,
        });
        const model = fixtures.createModel(provider.id);
        const coordinator = fixtures.createAgent({
          name: 'Triage Lead',
          model_id: model.id,
        });
        const specialist = fixtures.createAgent({
          name: 'DB Specialist',
          model_id: model.id,
        });

        const team = fixtures.createTeam({
          name: 'Routed Team',
          strategy: 'coordinator',
        });
        fixtures.createTeamMember(team.id, coordinator.id, {
          is_coordinator: 1,
          role: 'Coordinator',
        });
        fixtures.createTeamMember(team.id, specialist.id, {
          is_coordinator: 0,
          role: 'Specialist',
        });

        const chat = fixtures.createChat({ agent_id: null, team_id: team.id });
        fixtures.createMessage({
          chat_id: chat.id,
          sequence: 1,
          role: 'user',
          content: 'Hello, what is your team for?',
        });

        testDouble.complete = vi.fn().mockResolvedValue({
          content: 'I can answer directly: we build software systems.',
          finishReason: 'stop',
          usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        });

        const response = await service.completeChat(chat.id, {});
        expect(response.messages).toHaveLength(1);
        expect(response.messages![0].agentId).toBe(coordinator.id);
        expect(response.content).toBe(
          'I can answer directly: we build software systems.',
        );
      });

      it('delegates to specialist when coordinator outputs [DELEGATE: <Name>]', async () => {
        const provider = fixtures.createProvider({
          kind: 'openai',
          is_local: 0,
        });
        const model = fixtures.createModel(provider.id);
        const coordinator = fixtures.createAgent({
          name: 'Triage Lead',
          model_id: model.id,
        });
        const specialist = fixtures.createAgent({
          name: 'DB Specialist',
          model_id: model.id,
        });

        const team = fixtures.createTeam({
          name: 'Routed Team',
          strategy: 'coordinator',
        });
        fixtures.createTeamMember(team.id, coordinator.id, {
          is_coordinator: 1,
          role: 'Coordinator',
        });
        fixtures.createTeamMember(team.id, specialist.id, {
          is_coordinator: 0,
          role: 'Specialist',
        });

        const chat = fixtures.createChat({ agent_id: null, team_id: team.id });
        fixtures.createMessage({
          chat_id: chat.id,
          sequence: 1,
          role: 'user',
          content: 'Optimize our PostgreSQL query',
        });

        const completeCalls: any[] = [];
        testDouble.complete = vi.fn().mockImplementation(async (req) => {
          completeCalls.push(req);
          if (completeCalls.length === 1) {
            return {
              content:
                '[DELEGATE: DB Specialist] Please provide index recommendations for PostgreSQL.',
              finishReason: 'stop',
              usage: { inputTokens: 25, outputTokens: 15, totalTokens: 40 },
            };
          }
          return {
            content: 'Add a compound B-tree index on (user_id, created_at).',
            finishReason: 'stop',
            usage: { inputTokens: 40, outputTokens: 12, totalTokens: 52 },
          };
        });

        const response = await service.completeChat(chat.id, {});
        expect(response.messages).toHaveLength(2);
        expect(response.messages![0].agentId).toBe(coordinator.id);
        expect(response.messages![1].agentId).toBe(specialist.id);
        expect(response.content).toBe(
          'Add a compound B-tree index on (user_id, created_at).',
        );

        // Specialist sees coordinator's turn in context
        const specialistRequest = completeCalls[1];
        const peerMessage = specialistRequest.messages.find((m: any) =>
          m.content.includes('[DELEGATE: DB Specialist]'),
        );
        expect(peerMessage).toBeDefined();
      });

      it('streams coordinator delegation to specialist with sequential message events', async () => {
        const provider = fixtures.createProvider({
          kind: 'openai',
          is_local: 0,
        });
        const model = fixtures.createModel(provider.id);
        const coordinator = fixtures.createAgent({
          name: 'Triage Lead',
          model_id: model.id,
        });
        const specialist = fixtures.createAgent({
          name: 'DB Specialist',
          model_id: model.id,
        });

        const team = fixtures.createTeam({
          name: 'Routed Team',
          strategy: 'coordinator',
        });
        fixtures.createTeamMember(team.id, coordinator.id, {
          is_coordinator: 1,
          role: 'Coordinator',
        });
        fixtures.createTeamMember(team.id, specialist.id, {
          is_coordinator: 0,
          role: 'Specialist',
        });

        const chat = fixtures.createChat({ agent_id: null, team_id: team.id });
        fixtures.createMessage({
          chat_id: chat.id,
          sequence: 1,
          role: 'user',
          content: 'Analyze DB',
        });

        let streamCall = 0;
        testDouble.stream = vi.fn().mockImplementation(async function* () {
          streamCall++;
          if (streamCall === 1) {
            yield {
              type: 'text-delta',
              delta: '[DELEGATE: DB Specialist] Routing to DB Specialist.',
            };
            yield {
              type: 'usage',
              usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
            };
            yield { type: 'complete', finishReason: 'stop' };
          } else {
            yield {
              type: 'text-delta',
              delta: 'DB Specialist analysis complete.',
            };
            yield {
              type: 'usage',
              usage: { inputTokens: 20, outputTokens: 6, totalTokens: 26 },
            };
            yield { type: 'complete', finishReason: 'stop' };
          }
        });

        const generator = service.streamChat(chat.id, { stream: true });
        const events: any[] = [];
        for await (const event of generator) {
          events.push(event);
        }

        const starts = events.filter((e) => e.type === 'message_start');
        expect(starts).toHaveLength(2);
        expect(starts[0].data.agentId).toBe(coordinator.id);
        expect(starts[1].data.agentId).toBe(specialist.id);

        const completes = events.filter((e) => e.type === 'message_complete');
        expect(completes).toHaveLength(2);

        const usage = events.find((e) => e.type === 'usage');
        expect(usage).toBeDefined();
        expect(usage.data.totalTokens).toBe(44); // 18 + 26
        expect(events[events.length - 1].type).toBe('done');
      });
    });

    describe('Phase 3: Broadcast (Parallel / Independent Context)', () => {
      it('executes broadcast ensuring context isolation between concurrent replies', async () => {
        const provider = fixtures.createProvider({
          kind: 'openai',
          is_local: 0,
        });
        const model = fixtures.createModel(provider.id);
        const agentA = fixtures.createAgent({
          name: 'Persp A',
          model_id: model.id,
        });
        const agentB = fixtures.createAgent({
          name: 'Persp B',
          model_id: model.id,
        });

        const team = fixtures.createTeam({
          name: 'Broadcast Team',
          strategy: 'broadcast',
        });
        fixtures.createTeamMember(team.id, agentA.id, { position: 1 });
        fixtures.createTeamMember(team.id, agentB.id, { position: 2 });

        const chat = fixtures.createChat({ agent_id: null, team_id: team.id });
        fixtures.createMessage({
          chat_id: chat.id,
          sequence: 1,
          role: 'user',
          content: 'Brainstorm ideas',
        });

        const completeCalls: any[] = [];
        testDouble.complete = vi.fn().mockImplementation(async (req) => {
          completeCalls.push(req);
          return {
            content: `Opinion from ${req.model}`,
            finishReason: 'stop',
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          };
        });

        const response = await service.completeChat(chat.id, {});
        expect(response.messages).toHaveLength(2);
        expect(response.messages![0].agentId).toBe(agentA.id);
        expect(response.messages![1].agentId).toBe(agentB.id);

        // Crucial Broadcast Invariant: Agent B must NOT see Agent A's reply in its messages context
        const agentBRequest = completeCalls[1];
        const agentAMessageSeenByB = agentBRequest.messages.find((m: any) =>
          m.content.includes('Opinion from'),
        );
        expect(agentAMessageSeenByB).toBeUndefined();
      });

      it('streams broadcast responses independently with aggregated token usage', async () => {
        const provider = fixtures.createProvider({
          kind: 'openai',
          is_local: 0,
        });
        const model = fixtures.createModel(provider.id);
        const agentA = fixtures.createAgent({ name: 'A', model_id: model.id });
        const agentB = fixtures.createAgent({ name: 'B', model_id: model.id });

        const team = fixtures.createTeam({
          name: 'Broadcast Team',
          strategy: 'broadcast',
        });
        fixtures.createTeamMember(team.id, agentA.id, { position: 1 });
        fixtures.createTeamMember(team.id, agentB.id, { position: 2 });

        const chat = fixtures.createChat({ agent_id: null, team_id: team.id });
        fixtures.createMessage({
          chat_id: chat.id,
          sequence: 1,
          role: 'user',
          content: 'Compare',
        });

        testDouble.stream = vi.fn().mockImplementation(async function* () {
          yield { type: 'text-delta', delta: 'Broadcast reply' };
          yield {
            type: 'usage',
            usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
          };
          yield { type: 'complete', finishReason: 'stop' };
        });

        const generator = service.streamChat(chat.id, { stream: true });
        const events: any[] = [];
        for await (const event of generator) {
          events.push(event);
        }

        const starts = events.filter((e) => e.type === 'message_start');
        expect(starts).toHaveLength(2);
        expect(starts[0].data.agentId).toBe(agentA.id);
        expect(starts[1].data.agentId).toBe(agentB.id);

        const usage = events.find((e) => e.type === 'usage');
        expect(usage).toBeDefined();
        expect(usage.data.totalTokens).toBe(24); // 12 * 2
        expect(events[events.length - 1].type).toBe('done');
      });
    });

    describe('Phase 4: Autonomous Dynamic Handoff', () => {
      it('executes dynamic multi-agent handoff loop terminating on [DONE]', async () => {
        const provider = fixtures.createProvider({
          kind: 'openai',
          is_local: 0,
        });
        const model = fixtures.createModel(provider.id);
        const alice = fixtures.createAgent({
          name: 'Alice',
          model_id: model.id,
        });
        const bob = fixtures.createAgent({ name: 'Bob', model_id: model.id });

        const team = fixtures.createTeam({
          name: 'Dynamic Team',
          strategy: 'autonomous',
          max_turns_per_interaction: 5,
        });
        fixtures.createTeamMember(team.id, alice.id, {
          is_coordinator: 1,
          position: 1,
        });
        fixtures.createTeamMember(team.id, bob.id, {
          is_coordinator: 0,
          position: 2,
        });

        const chat = fixtures.createChat({ agent_id: null, team_id: team.id });
        fixtures.createMessage({
          chat_id: chat.id,
          sequence: 1,
          role: 'user',
          content: 'Collaborate on design',
        });

        let callCount = 0;
        testDouble.complete = vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            return {
              content: 'Alice drafted initial design. [NEXT: @Bob]',
              finishReason: 'stop',
              usage: { inputTokens: 15, outputTokens: 10, totalTokens: 25 },
            };
          }
          return {
            content: 'Bob approved design. [DONE]',
            finishReason: 'stop',
            usage: { inputTokens: 28, outputTokens: 8, totalTokens: 36 },
          };
        });

        const response = await service.completeChat(chat.id, {});
        expect(response.messages).toHaveLength(2);
        expect(response.messages![0].agentId).toBe(alice.id);
        expect(response.messages![1].agentId).toBe(bob.id);
        expect(response.content).toBe('Bob approved design. [DONE]');
      });

      it('enforces hard turn cap to prevent runaway autonomous loops', async () => {
        const provider = fixtures.createProvider({
          kind: 'openai',
          is_local: 0,
        });
        const model = fixtures.createModel(provider.id);
        const ping = fixtures.createAgent({ name: 'Ping', model_id: model.id });
        const pong = fixtures.createAgent({ name: 'Pong', model_id: model.id });

        const team = fixtures.createTeam({
          name: 'Looping Team',
          strategy: 'autonomous',
          max_turns_per_interaction: 3,
        });
        fixtures.createTeamMember(team.id, ping.id, { position: 1 });
        fixtures.createTeamMember(team.id, pong.id, { position: 2 });

        const chat = fixtures.createChat({ agent_id: null, team_id: team.id });
        fixtures.createMessage({
          chat_id: chat.id,
          sequence: 1,
          role: 'user',
          content: 'Keep playing ping pong',
        });

        let turn = 0;
        testDouble.complete = vi.fn().mockImplementation(async () => {
          turn++;
          return {
            content:
              turn % 2 === 1 ? 'Ping! [NEXT: @Pong]' : 'Pong! [NEXT: @Ping]',
            finishReason: 'stop',
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          };
        });

        const response = await service.completeChat(chat.id, { maxTurns: 3 });
        // Hard capped at 3 turns
        expect(response.messages).toHaveLength(3);
        expect(response.messages![0].agentId).toBe(ping.id);
        expect(response.messages![1].agentId).toBe(pong.id);
        expect(response.messages![2].agentId).toBe(ping.id);
      });

      it('streams autonomous dynamic handoff correctly terminating on [DONE]', async () => {
        const provider = fixtures.createProvider({
          kind: 'openai',
          is_local: 0,
        });
        const model = fixtures.createModel(provider.id);
        const alice = fixtures.createAgent({
          name: 'Alice',
          model_id: model.id,
        });
        const bob = fixtures.createAgent({ name: 'Bob', model_id: model.id });

        const team = fixtures.createTeam({
          name: 'Dynamic Team',
          strategy: 'autonomous',
        });
        fixtures.createTeamMember(team.id, alice.id, { position: 1 });
        fixtures.createTeamMember(team.id, bob.id, { position: 2 });

        const chat = fixtures.createChat({ agent_id: null, team_id: team.id });
        fixtures.createMessage({
          chat_id: chat.id,
          sequence: 1,
          role: 'user',
          content: 'Start dynamic discussion',
        });

        let streamTurn = 0;
        testDouble.stream = vi.fn().mockImplementation(async function* () {
          streamTurn++;
          if (streamTurn === 1) {
            yield { type: 'text-delta', delta: 'Alice starts. [NEXT: @Bob]' };
            yield {
              type: 'usage',
              usage: { inputTokens: 10, outputTokens: 7, totalTokens: 17 },
            };
            yield { type: 'complete', finishReason: 'stop' };
          } else {
            yield { type: 'text-delta', delta: 'Bob concludes. [DONE]' };
            yield {
              type: 'usage',
              usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
            };
            yield { type: 'complete', finishReason: 'stop' };
          }
        });

        const generator = service.streamChat(chat.id, { stream: true });
        const events: any[] = [];
        for await (const event of generator) {
          events.push(event);
        }

        const starts = events.filter((e) => e.type === 'message_start');
        expect(starts).toHaveLength(2);
        expect(starts[0].data.agentId).toBe(alice.id);
        expect(starts[1].data.agentId).toBe(bob.id);

        const usage = events.find((e) => e.type === 'usage');
        expect(usage).toBeDefined();
        expect(usage.data.totalTokens).toBe(42); // 17 + 25
        expect(events[events.length - 1].type).toBe('done');
      });
    });
  });
});
