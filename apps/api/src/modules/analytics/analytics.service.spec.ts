import http from 'node:http';
import https from 'node:https';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../database/database.service.js';
import { TestFixtures } from '../../../test/harness/fixtures.js';
import { AnalyticsModule } from './analytics.module.js';
import { AnalyticsService } from './analytics.service.js';
import { USAGE_EVENT_TYPES } from './usage-event.types.js';

describe('AnalyticsService', () => {
  let db: DatabaseService;
  let fixtures: TestFixtures;
  let service: AnalyticsService;

  beforeEach(() => {
    db = new DatabaseService();
    db.connect(':memory:');
    fixtures = new TestFixtures(db);
    service = new AnalyticsService(db);
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  describe('module exports and wiring', () => {
    it('is exported from AnalyticsModule', () => {
      const exports = Reflect.getMetadata('exports', AnalyticsModule);
      expect(exports).toBeDefined();
      expect(exports).toContain(AnalyticsService);
    });

    it('exports the canonical usage event type vocabulary as constants', () => {
      expect(USAGE_EVENT_TYPES).toEqual({
        CHAT_COMPLETION: 'chat_completion',
        CHAT_COMPACTION: 'chat_compaction',
        AGENT_CREATED: 'agent_created',
        ARTIFACT_CREATED: 'artifact_created',
      });
      expect(Object.isFrozen(USAGE_EVENT_TYPES)).toBe(true);
    });
  });

  describe('event persistence across event types', () => {
    it('records a chat_completion event with full relational linkage and tokens', () => {
      const provider = fixtures.createProvider({ kind: 'openai' });
      const model = fixtures.createModel({ provider_id: provider.id });
      const agent = fixtures.createAgent({ model_id: model.id });
      const chat = fixtures.createChat({ agent_id: agent.id });

      const occurredAt = '2026-09-21T14:30:00.000Z';
      const row = service.recordChatCompletion({
        occurredAt,
        agentId: agent.id,
        providerId: provider.id,
        modelId: model.id,
        chatId: chat.id,
        inputTokens: 150,
        outputTokens: 75,
        costUsd: 0.0025,
        metadata: { finishReason: 'stop' },
      });

      expect(row).toBeDefined();
      expect(row?.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(row?.event_type).toBe(USAGE_EVENT_TYPES.CHAT_COMPLETION);
      expect(row?.occurred_at).toBe(occurredAt);
      expect(row?.agent_id).toBe(agent.id);
      expect(row?.provider_id).toBe(provider.id);
      expect(row?.model_id).toBe(model.id);
      expect(row?.chat_id).toBe(chat.id);
      expect(row?.input_tokens).toBe(150);
      expect(row?.output_tokens).toBe(75);
      expect(row?.cost_usd).toBe(0.0025);
      expect(row?.metadata).toBe(JSON.stringify({ finishReason: 'stop' }));

      // Assert persisted row directly from SQLite
      const inDb = db.get<any>('SELECT * FROM usage_events WHERE id = ?', [
        row!.id,
      ]);
      expect(inDb).toEqual(row);
    });

    it('records a chat_compaction event', () => {
      const provider = fixtures.createProvider();
      const model = fixtures.createModel({ provider_id: provider.id });
      const agent = fixtures.createAgent({ model_id: model.id });
      const chat = fixtures.createChat({ agent_id: agent.id });

      const occurredAt = new Date('2026-10-01T08:00:00.000Z');
      const row = service.recordChatCompaction({
        occurredAt,
        agentId: agent.id,
        providerId: provider.id,
        modelId: model.id,
        chatId: chat.id,
        inputTokens: 800,
        outputTokens: 120,
        metadata: { preservedMessages: 2 },
      });

      expect(row?.event_type).toBe(USAGE_EVENT_TYPES.CHAT_COMPACTION);
      expect(row?.occurred_at).toBe('2026-10-01T08:00:00.000Z');
      expect(row?.input_tokens).toBe(800);
      expect(row?.output_tokens).toBe(120);

      const inDb = service.findById(row!.id);
      expect(inDb?.event_type).toBe('chat_compaction');
    });

    it('records an agent_created event', () => {
      const provider = fixtures.createProvider();
      const model = fixtures.createModel({ provider_id: provider.id });
      const agent = fixtures.createAgent({ model_id: model.id });

      const occurredAt = '2026-10-15T12:00:00.000Z';
      const row = service.recordAgentCreated({
        occurredAt,
        agentId: agent.id,
        modelId: model.id,
        metadata: { name: agent.name },
      });

      expect(row?.event_type).toBe(USAGE_EVENT_TYPES.AGENT_CREATED);
      expect(row?.agent_id).toBe(agent.id);
      expect(row?.model_id).toBe(model.id);
      expect(row?.chat_id).toBeNull();
      expect(row?.input_tokens).toBeNull();
      expect(row?.output_tokens).toBeNull();
      expect(row?.cost_usd).toBeNull();

      const inDb = service.findById(row!.id);
      expect(inDb?.agent_id).toBe(agent.id);
    });

    it('records an artifact_created event', () => {
      const agent = fixtures.createAgent();
      const chat = fixtures.createChat({ agent_id: agent.id });

      const occurredAt = '2026-10-20T16:45:00.000Z';
      const row = service.recordArtifactCreated({
        occurredAt,
        agentId: agent.id,
        chatId: chat.id,
        metadata: { type: 'code', title: 'test.py' },
      });

      expect(row?.event_type).toBe(USAGE_EVENT_TYPES.ARTIFACT_CREATED);
      expect(row?.agent_id).toBe(agent.id);
      expect(row?.chat_id).toBe(chat.id);
      expect(row?.provider_id).toBeNull();

      const inDb = service.findById(row!.id);
      expect(inDb?.metadata).toBe(
        JSON.stringify({ type: 'code', title: 'test.py' }),
      );
    });

    it('supports the unified record() method with discriminated union', () => {
      const row = service.record({
        eventType: USAGE_EVENT_TYPES.CHAT_COMPLETION,
        occurredAt: '2026-11-01T09:00:00.000Z',
        inputTokens: 50,
        outputTokens: 25,
      });

      expect(row?.event_type).toBe('chat_completion');
      expect(row?.input_tokens).toBe(50);
      expect(row?.output_tokens).toBe(25);
    });
  });

  describe('caller-supplied timestamp (occurred_at)', () => {
    it('uses the supplied timestamp instead of defaulting to now', () => {
      const pastTime = '2024-01-15T00:00:00.000Z';
      const row = service.recordChatCompletion({
        occurredAt: pastTime,
      });

      expect(row?.occurred_at).toBe(pastTime);
      const inDb = service.findById(row!.id);
      expect(inDb?.occurred_at).toBe(pastTime);
    });

    it('accepts Date objects and converts them to ISO 8601 strings', () => {
      const date = new Date('2025-05-10T15:30:45.123Z');
      const row = service.recordChatCompletion({
        occurredAt: date,
      });

      expect(row?.occurred_at).toBe('2025-05-10T15:30:45.123Z');
    });
  });

  describe('token counts and nullability rules', () => {
    it('writes null when token counts are unknown or unmeasured, not zero', () => {
      const row = service.recordChatCompletion({
        occurredAt: '2026-11-09T10:00:00.000Z',
        inputTokens: undefined,
        outputTokens: null,
      });

      expect(row?.input_tokens).toBeNull();
      expect(row?.output_tokens).toBeNull();

      const inDb = service.findById(row!.id);
      expect(inDb?.input_tokens).toBeNull();
      expect(inDb?.output_tokens).toBeNull();
    });

    it('writes zero when token counts are measured as zero', () => {
      const row = service.recordChatCompletion({
        occurredAt: '2026-11-09T10:00:00.000Z',
        inputTokens: 0,
        outputTokens: 0,
      });

      expect(row?.input_tokens).toBe(0);
      expect(row?.output_tokens).toBe(0);

      const inDb = service.findById(row!.id);
      expect(inDb?.input_tokens).toBe(0);
      expect(inDb?.output_tokens).toBe(0);
    });

    it('rounds fractional token counts to integers', () => {
      const row = service.recordChatCompletion({
        occurredAt: '2026-11-09T10:00:00.000Z',
        inputTokens: 12.6,
        outputTokens: 4.2,
      });

      expect(row?.input_tokens).toBe(13);
      expect(row?.output_tokens).toBe(4);
    });
  });

  describe('cost_usd decision and persistence', () => {
    it('defaults cost_usd to null when not specified', () => {
      const row = service.recordChatCompletion({
        occurredAt: '2026-11-09T10:00:00.000Z',
      });

      expect(row?.cost_usd).toBeNull();
      const inDb = service.findById(row!.id);
      expect(inDb?.cost_usd).toBeNull();
    });

    it('persists cost_usd when explicitly provided', () => {
      const row = service.recordChatCompletion({
        occurredAt: '2026-11-09T10:00:00.000Z',
        costUsd: 0.0125,
      });

      expect(row?.cost_usd).toBe(0.0125);
      const inDb = service.findById(row!.id);
      expect(inDb?.cost_usd).toBe(0.0125);
    });
  });

  describe('metadata handling, round-tripping, and user content privacy', () => {
    it('serialises and round-trips structured JSON metadata', () => {
      const metadata = {
        modelFamily: 'claude-3-5',
        reasoningTokens: 64,
        nested: { key: 'value', numbers: [1, 2, 3] },
      };

      const row = service.recordChatCompletion({
        occurredAt: '2026-11-09T10:00:00.000Z',
        metadata,
      });

      expect(row?.metadata).toBeDefined();
      const parsed = JSON.parse(row!.metadata!);
      expect(parsed).toEqual(metadata);

      const inDb = service.findById(row!.id);
      expect(JSON.parse(inDb!.metadata!)).toEqual(metadata);
    });

    it('keeps metadata genuinely optional (null when omitted or empty)', () => {
      const row1 = service.recordChatCompletion({
        occurredAt: '2026-11-09T10:00:00.000Z',
        metadata: undefined,
      });
      expect(row1?.metadata).toBeNull();

      const row2 = service.recordChatCompletion({
        occurredAt: '2026-11-09T10:00:00.000Z',
        metadata: {},
      });
      expect(row2?.metadata).toBeNull();
    });

    it('omits user prompt and completion content from metadata', () => {
      const row = service.recordChatCompletion({
        occurredAt: '2026-11-09T10:00:00.000Z',
        metadata: {
          prompt: 'Sensitive user question: how to...',
          completion: 'Sensitive model answer...',
          content: 'Additional content...',
          messages: [{ role: 'user', content: 'hello' }],
          systemPrompt: 'System instructions...',
          system_prompt: 'Alternative casing...',
          safeTelemetryKey: 'safeValue',
          nested: {
            prompt: 'Nested prompt to strip',
            keepMe: 42,
          },
        },
      });

      expect(row?.metadata).toBeDefined();
      const parsed = JSON.parse(row!.metadata!);

      // Assert forbidden keys were excluded
      expect(parsed.prompt).toBeUndefined();
      expect(parsed.completion).toBeUndefined();
      expect(parsed.content).toBeUndefined();
      expect(parsed.messages).toBeUndefined();
      expect(parsed.systemPrompt).toBeUndefined();
      expect(parsed.system_prompt).toBeUndefined();

      // Assert safe keys are preserved
      expect(parsed.safeTelemetryKey).toBe('safeValue');
      expect(parsed.nested).toEqual({ keepMe: 42 });
    });
  });

  describe('non-blocking and non-fatal failure handling', () => {
    it('catches and logs SQLite failures without throwing', () => {
      const errorSpy = vi
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => {});

      // Simulate a database failure (e.g. SQLite disk I/O failure or database lock)
      vi.spyOn(db, 'run').mockImplementation(() => {
        throw new Error('disk I/O error (SQLITE_IOERR)');
      });

      let returnedRow: any;
      expect(() => {
        returnedRow = service.recordChatCompletion({
          occurredAt: '2026-11-09T10:00:00.000Z',
          inputTokens: 100,
        });
      }).not.toThrow();

      expect(returnedRow).toBeNull();
      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0]).toContain('disk I/O error');
    });
  });

  describe('foreign key resilience (ON DELETE SET NULL)', () => {
    it('survives deletion of referenced agent with agent_id set to null', () => {
      const agent = fixtures.createAgent();
      const row = service.recordAgentCreated({
        occurredAt: '2026-11-09T10:00:00.000Z',
        agentId: agent.id,
      });

      expect(row?.agent_id).toBe(agent.id);

      // Delete the agent from SQLite
      db.run('DELETE FROM agents WHERE id = ?', [agent.id]);

      // Query usage_events to verify survival
      const surviving = service.findById(row!.id);
      expect(surviving).toBeDefined();
      expect(surviving?.id).toBe(row!.id);
      expect(surviving?.agent_id).toBeNull();
    });

    it('survives deletion of referenced chat with chat_id set to null', () => {
      const agent = fixtures.createAgent();
      const chat = fixtures.createChat({ agent_id: agent.id });
      const row = service.recordChatCompletion({
        occurredAt: '2026-11-09T10:00:00.000Z',
        chatId: chat.id,
        agentId: agent.id,
      });

      expect(row?.chat_id).toBe(chat.id);

      // Delete the chat
      db.run('DELETE FROM chats WHERE id = ?', [chat.id]);

      const surviving = service.findById(row!.id);
      expect(surviving).toBeDefined();
      expect(surviving?.chat_id).toBeNull();
      expect(surviving?.agent_id).toBe(agent.id);
    });

    it('survives deletion of referenced provider and model', () => {
      const provider = fixtures.createProvider();
      const model = fixtures.createModel({ provider_id: provider.id });
      const row = service.recordChatCompletion({
        occurredAt: '2026-11-09T10:00:00.000Z',
        providerId: provider.id,
        modelId: model.id,
      });

      // Delete provider (cascades to model in schema, SET NULL on usage_events)
      db.run('DELETE FROM providers WHERE id = ?', [provider.id]);

      const surviving = service.findById(row!.id);
      expect(surviving).toBeDefined();
      expect(surviving?.provider_id).toBeNull();
      expect(surviving?.model_id).toBeNull();
    });
  });

  describe('local-first guarantee (zero outbound telemetry)', () => {
    it('makes no outbound network calls during event recording', () => {
      const httpSpy = vi.spyOn(http, 'request');
      const httpsSpy = vi.spyOn(https, 'request');
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const agent = fixtures.createAgent();

      service.recordChatCompletion({
        occurredAt: '2026-11-09T10:00:00.000Z',
        agentId: agent.id,
        inputTokens: 100,
        outputTokens: 50,
      });
      service.recordChatCompaction({
        occurredAt: '2026-11-09T10:00:00.000Z',
        agentId: agent.id,
      });
      service.recordAgentCreated({
        occurredAt: '2026-11-09T10:00:00.000Z',
        agentId: agent.id,
      });
      service.recordArtifactCreated({
        occurredAt: '2026-11-09T10:00:00.000Z',
        agentId: agent.id,
      });

      expect(httpSpy).not.toHaveBeenCalled();
      expect(httpsSpy).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('parameter binding and SQL injection safety', () => {
    it('uses bound parameters and safely handles quotes and SQL fragments', () => {
      const agent = fixtures.createAgent({
        name: "Robert'); DROP TABLE usage_events; --",
      });
      const maliciousFragment = "'; DROP TABLE usage_events; --";

      const row = service.recordChatCompletion({
        occurredAt: '2026-11-09T10:00:00.000Z',
        agentId: agent.id,
        metadata: { injection: maliciousFragment },
      });

      expect(row).toBeDefined();
      expect(row?.agent_id).toBe(agent.id);
      expect(JSON.parse(row!.metadata!).injection).toBe(maliciousFragment);

      // Verify usage_events table is intact and has 1 row
      const count = db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM usage_events',
      );
      expect(count?.count).toBe(1);
    });
  });
});
