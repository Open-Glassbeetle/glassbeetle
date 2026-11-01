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
});
