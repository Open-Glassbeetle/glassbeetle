import http from 'node:http';
import https from 'node:https';
import { BadRequestException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../database/database.service.js';
import { TestFixtures } from '../../../test/harness/fixtures.js';
import { AnalyticsModule } from './analytics.module.js';
import {
  AnalyticsService,
  MAX_ACTIVITY_BUCKETS,
  MAX_TIME_BUCKETS,
} from './analytics.service.js';
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

    it('exports MAX_TIME_BUCKETS limit constant', () => {
      expect(MAX_TIME_BUCKETS).toBe(366);
    });

    it('exports MAX_ACTIVITY_BUCKETS limit constant', () => {
      expect(MAX_ACTIVITY_BUCKETS).toBe(1000);
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

  describe('getUsage aggregations and queries', () => {
    describe('empty table', () => {
      it('returns 200 with empty result when there is no data and no groupBy', async () => {
        const result = await service.getUsage({});

        expect(result.totals).toEqual({
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          eventCount: 0,
          unknownTokensEventCount: 0,
          unknownCostEventCount: 0,
        });
        expect(result.groups).toEqual([]);
        expect(result.timeZone).toBe('UTC');
        expect(result.timeRange.from).toBeDefined();
        expect(result.timeRange.to).toBeDefined();
      });

      it('returns 200 with empty groups when grouping by entity on an empty table', async () => {
        const result = await service.getUsage({ groupBy: 'agent' });

        expect(result.totals.eventCount).toBe(0);
        expect(result.groups).toEqual([]);
      });

      it('returns zero-activity buckets across queried range when grouping by day on empty table', async () => {
        const from = '2026-11-01T00:00:00.000Z';
        const to = '2026-11-03T23:59:59.999Z';
        const result = await service.getUsage({ from, to, groupBy: 'day' });

        expect(result.totals.eventCount).toBe(0);
        expect(result.groups).toHaveLength(3);
        expect(result.groups.map((g) => g.bucket)).toEqual([
          '2026-11-01',
          '2026-11-02',
          '2026-11-03',
        ]);
        for (const g of result.groups) {
          expect(g.inputTokens).toBe(0);
          expect(g.outputTokens).toBe(0);
          expect(g.totalTokens).toBe(0);
          expect(g.costUsd).toBe(0);
          expect(g.eventCount).toBe(0);
        }
      });
    });

    describe('arithmetic and exact aggregation with hand-verifiable fixture', () => {
      let agent1Id: string;
      let agent2Id: string;
      let prov1Id: string;
      let prov2Id: string;
      let model1Id: string;
      let model2Id: string;

      beforeEach(() => {
        const prov1 = fixtures.createProvider({
          name: 'OpenAI',
          kind: 'openai',
        });
        const prov2 = fixtures.createProvider({
          name: 'Anthropic',
          kind: 'anthropic',
        });
        prov1Id = prov1.id;
        prov2Id = prov2.id;

        const model1 = fixtures.createModel({
          provider_id: prov1Id,
          model_identifier: 'gpt-4o',
          display_name: 'GPT-4o',
        });
        const model2 = fixtures.createModel({
          provider_id: prov2Id,
          model_identifier: 'claude-3-5-sonnet',
          display_name: 'Claude 3.5 Sonnet',
        });
        model1Id = model1.id;
        model2Id = model2.id;

        const agent1 = fixtures.createAgent({
          name: 'Coder Agent',
          model_id: model1Id,
        });
        const agent2 = fixtures.createAgent({
          name: 'Reviewer Agent',
          model_id: model2Id,
        });
        agent1Id = agent1.id;
        agent2Id = agent2.id;

        // Seed 6 hand-verifiable events:
        // Event 1: Agent1, Prov1, Model1, chat_completion, 100 in, 50 out, 0.005 USD
        fixtures.createUsageEvent({
          occurred_at: '2026-10-10T10:00:00.000Z',
          agent_id: agent1Id,
          provider_id: prov1Id,
          model_id: model1Id,
          event_type: 'chat_completion',
          input_tokens: 100,
          output_tokens: 50,
          cost_usd: 0.005,
        });

        // Event 2: Agent1, Prov1, Model1, chat_completion, 200 in, 100 out, 0.010 USD
        fixtures.createUsageEvent({
          occurred_at: '2026-10-10T12:00:00.000Z',
          agent_id: agent1Id,
          provider_id: prov1Id,
          model_id: model1Id,
          event_type: 'chat_completion',
          input_tokens: 200,
          output_tokens: 100,
          cost_usd: 0.01,
        });

        // Event 3: Agent2, Prov2, Model2, chat_completion, 300 in, 150 out, 0.015 USD
        fixtures.createUsageEvent({
          occurred_at: '2026-10-11T09:00:00.000Z',
          agent_id: agent2Id,
          provider_id: prov2Id,
          model_id: model2Id,
          event_type: 'chat_completion',
          input_tokens: 300,
          output_tokens: 150,
          cost_usd: 0.015,
        });

        // Event 4: Null agent (deleted), Prov1, Model1, chat_compaction, 500 in, 250 out, 0.020 USD
        fixtures.createUsageEvent({
          occurred_at: '2026-10-12T15:00:00.000Z',
          agent_id: null,
          provider_id: prov1Id,
          model_id: model1Id,
          event_type: 'chat_compaction',
          input_tokens: 500,
          output_tokens: 250,
          cost_usd: 0.02,
        });

        // Event 5: Agent2, Prov2, Model2, agent_created, null in, null out, null cost (unmeasured)
        fixtures.createUsageEvent({
          occurred_at: '2026-10-13T18:00:00.000Z',
          agent_id: agent2Id,
          provider_id: prov2Id,
          model_id: model2Id,
          event_type: 'agent_created',
          input_tokens: null,
          output_tokens: null,
          cost_usd: null,
        });

        // Event 6: Agent1, Prov1, Model1, chat_completion, 0 in, 0 out, 0.0 cost (zero usage)
        fixtures.createUsageEvent({
          occurred_at: '2026-10-14T20:00:00.000Z',
          agent_id: agent1Id,
          provider_id: prov1Id,
          model_id: model1Id,
          event_type: 'chat_completion',
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: 0,
        });
      });

      it('aggregates overall totals correctly across all events', async () => {
        const result = await service.getUsage({
          from: '2026-10-01T00:00:00.000Z',
          to: '2026-10-31T23:59:59.999Z',
        });

        expect(result.totals).toEqual({
          inputTokens: 1100, // 100 + 200 + 300 + 500 + 0
          outputTokens: 550, // 50 + 100 + 150 + 250 + 0
          totalTokens: 1650,
          costUsd: 0.05, // 0.005 + 0.010 + 0.015 + 0.020 + 0
          eventCount: 6,
          unknownTokensEventCount: 1, // Event 5
          unknownCostEventCount: 1, // Event 5
        });
        expect(result.groups).toEqual([]);
      });

      it('groups by agent and reconciles grouped totals with overall totals including deleted (null) agents', async () => {
        const result = await service.getUsage({
          from: '2026-10-01T00:00:00.000Z',
          to: '2026-10-31T23:59:59.999Z',
          groupBy: 'agent',
        });

        expect(result.groups).toHaveLength(3);

        const nullAgentGroup = result.groups.find((g) => g.agentId === null);
        expect(nullAgentGroup).toBeDefined();
        expect(nullAgentGroup).toMatchObject({
          agentId: null,
          inputTokens: 500,
          outputTokens: 250,
          totalTokens: 750,
          costUsd: 0.02,
          eventCount: 1,
          unknownTokensEventCount: 0,
          unknownCostEventCount: 0,
        });

        const agent1Group = result.groups.find((g) => g.agentId === agent1Id);
        expect(agent1Group).toBeDefined();
        expect(agent1Group).toMatchObject({
          agentId: agent1Id,
          inputTokens: 300,
          outputTokens: 150,
          totalTokens: 450,
          costUsd: 0.015,
          eventCount: 3,
          unknownTokensEventCount: 0,
          unknownCostEventCount: 0,
        });

        const agent2Group = result.groups.find((g) => g.agentId === agent2Id);
        expect(agent2Group).toBeDefined();
        expect(agent2Group).toMatchObject({
          agentId: agent2Id,
          inputTokens: 300,
          outputTokens: 150,
          totalTokens: 450,
          costUsd: 0.015,
          eventCount: 2,
          unknownTokensEventCount: 1,
          unknownCostEventCount: 1,
        });

        // Verify totals reconcile completely:
        const sumInput = result.groups.reduce(
          (acc, g) => acc + g.inputTokens,
          0,
        );
        const sumOutput = result.groups.reduce(
          (acc, g) => acc + g.outputTokens,
          0,
        );
        const sumCost = result.groups.reduce((acc, g) => acc + g.costUsd, 0);
        const sumEvents = result.groups.reduce(
          (acc, g) => acc + g.eventCount,
          0,
        );
        const sumUnknownTokens = result.groups.reduce(
          (acc, g) => acc + g.unknownTokensEventCount,
          0,
        );
        const sumUnknownCost = result.groups.reduce(
          (acc, g) => acc + g.unknownCostEventCount,
          0,
        );

        expect(sumInput).toBe(result.totals.inputTokens);
        expect(sumOutput).toBe(result.totals.outputTokens);
        expect(Math.round(sumCost * 1e6) / 1e6).toBe(result.totals.costUsd);
        expect(sumEvents).toBe(result.totals.eventCount);
        expect(sumUnknownTokens).toBe(result.totals.unknownTokensEventCount);
        expect(sumUnknownCost).toBe(result.totals.unknownCostEventCount);
      });

      it('groups by provider', async () => {
        const result = await service.getUsage({
          from: '2026-10-01T00:00:00.000Z',
          to: '2026-10-31T23:59:59.999Z',
          groupBy: 'provider',
        });

        expect(result.groups).toHaveLength(2);

        const prov1Group = result.groups.find((g) => g.providerId === prov1Id);
        expect(prov1Group).toMatchObject({
          providerId: prov1Id,
          inputTokens: 800, // 100 + 200 + 500 + 0
          outputTokens: 400, // 50 + 100 + 250 + 0
          totalTokens: 1200,
          costUsd: 0.035, // 0.005 + 0.010 + 0.020 + 0
          eventCount: 4,
          unknownTokensEventCount: 0,
        });

        const prov2Group = result.groups.find((g) => g.providerId === prov2Id);
        expect(prov2Group).toMatchObject({
          providerId: prov2Id,
          inputTokens: 300,
          outputTokens: 150,
          totalTokens: 450,
          costUsd: 0.015,
          eventCount: 2,
          unknownTokensEventCount: 1,
        });
      });

      it('groups by model', async () => {
        const result = await service.getUsage({
          from: '2026-10-01T00:00:00.000Z',
          to: '2026-10-31T23:59:59.999Z',
          groupBy: 'model',
        });

        expect(result.groups).toHaveLength(2);

        const mod1Group = result.groups.find((g) => g.modelId === model1Id);
        expect(mod1Group?.eventCount).toBe(4);
        expect(mod1Group?.inputTokens).toBe(800);

        const mod2Group = result.groups.find((g) => g.modelId === model2Id);
        expect(mod2Group?.eventCount).toBe(2);
        expect(mod2Group?.inputTokens).toBe(300);
      });

      it('groups by day and fills zero-activity time buckets', async () => {
        const from = '2026-10-09T00:00:00.000Z';
        const to = '2026-10-15T23:59:59.999Z';
        const result = await service.getUsage({ from, to, groupBy: 'day' });

        expect(result.groups).toHaveLength(7); // 10-09 through 10-15
        const buckets = result.groups.map((g) => g.bucket);
        expect(buckets).toEqual([
          '2026-10-09',
          '2026-10-10',
          '2026-10-11',
          '2026-10-12',
          '2026-10-13',
          '2026-10-14',
          '2026-10-15',
        ]);

        // 2026-10-09 has 0 activity:
        expect(result.groups[0]).toMatchObject({
          bucket: '2026-10-09',
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          eventCount: 0,
        });

        // 2026-10-10 has events 1 & 2:
        expect(result.groups[1]).toMatchObject({
          bucket: '2026-10-10',
          inputTokens: 300,
          outputTokens: 150,
          costUsd: 0.015,
          eventCount: 2,
        });

        // 2026-10-11 has event 3:
        expect(result.groups[2]).toMatchObject({
          bucket: '2026-10-11',
          inputTokens: 300,
          outputTokens: 150,
          costUsd: 0.015,
          eventCount: 1,
        });

        // 2026-10-12 has event 4:
        expect(result.groups[3]).toMatchObject({
          bucket: '2026-10-12',
          inputTokens: 500,
          outputTokens: 250,
          costUsd: 0.02,
          eventCount: 1,
        });

        // 2026-10-13 has event 5 (unmeasured):
        expect(result.groups[4]).toMatchObject({
          bucket: '2026-10-13',
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          eventCount: 1,
          unknownTokensEventCount: 1,
          unknownCostEventCount: 1,
        });

        // 2026-10-14 has event 6 (zero tokens, not unmeasured):
        expect(result.groups[5]).toMatchObject({
          bucket: '2026-10-14',
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          eventCount: 1,
          unknownTokensEventCount: 0,
          unknownCostEventCount: 0,
        });

        // 2026-10-15 has 0 activity:
        expect(result.groups[6]).toMatchObject({
          bucket: '2026-10-15',
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          eventCount: 0,
        });
      });

      it('groups by week and month', async () => {
        const from = '2026-10-01T00:00:00.000Z';
        const to = '2026-10-31T23:59:59.999Z';

        const weekResult = await service.getUsage({
          from,
          to,
          groupBy: 'week',
        });
        expect(weekResult.groups.length).toBeGreaterThan(0);
        const weekBuckets = weekResult.groups.map((g) => g.bucket);
        expect(weekBuckets.every((b) => /^2026-W\d{2}$/.test(b!))).toBe(true);

        const monthResult = await service.getUsage({
          from,
          to,
          groupBy: 'month',
        });
        expect(monthResult.groups).toHaveLength(1);
        expect(monthResult.groups[0].bucket).toBe('2026-10');
        expect(monthResult.groups[0].inputTokens).toBe(1100);
      });

      it('supports multi-dimensional combinations (e.g. agent and model)', async () => {
        const result = await service.getUsage({
          from: '2026-10-01T00:00:00.000Z',
          to: '2026-10-31T23:59:59.999Z',
          groupBy: ['agent', 'model'],
        });

        expect(result.groups).toHaveLength(3);
        const tuples = result.groups.map((g) => ({
          agentId: g.agentId,
          modelId: g.modelId,
          events: g.eventCount,
        }));

        expect(tuples).toContainEqual({
          agentId: null,
          modelId: model1Id,
          events: 1,
        });
        expect(tuples).toContainEqual({
          agentId: agent1Id,
          modelId: model1Id,
          events: 3,
        });
        expect(tuples).toContainEqual({
          agentId: agent2Id,
          modelId: model2Id,
          events: 2,
        });
      });

      it('supports multi-dimensional combinations with a time bucket (e.g. agent and day)', async () => {
        const result = await service.getUsage({
          from: '2026-10-01T00:00:00.000Z',
          to: '2026-10-31T23:59:59.999Z',
          groupBy: 'agent,day',
        });

        // Active tuples:
        // (Agent1, 2026-10-10): 2 events
        // (Agent2, 2026-10-11): 1 event
        // (null, 2026-10-12): 1 event
        // (Agent2, 2026-10-13): 1 event
        // (Agent1, 2026-10-14): 1 event
        expect(result.groups).toHaveLength(5);
        expect(
          result.groups.find(
            (g) => g.agentId === agent1Id && g.bucket === '2026-10-10',
          )?.eventCount,
        ).toBe(2);
        expect(
          result.groups.find(
            (g) => g.agentId === null && g.bucket === '2026-10-12',
          )?.eventCount,
        ).toBe(1);
      });

      describe('boundary timestamp testing', () => {
        it('includes events exactly on from and to boundaries, excluding those outside', async () => {
          // Exactly on from: Event 1 ('2026-10-10T10:00:00.000Z')
          // Inside: Event 2 ('2026-10-10T12:00:00.000Z')
          // Exactly on to: Event 3 ('2026-10-11T09:00:00.000Z')
          const result = await service.getUsage({
            from: '2026-10-10T10:00:00.000Z',
            to: '2026-10-11T09:00:00.000Z',
          });

          expect(result.totals.eventCount).toBe(3);
          expect(result.totals.inputTokens).toBe(600); // 100 + 200 + 300
          expect(result.totals.outputTokens).toBe(300); // 50 + 100 + 150
          expect(result.totals.costUsd).toBe(0.03); // 0.005 + 0.010 + 0.015
        });

        it('excludes events strictly before from and strictly after to', async () => {
          const result = await service.getUsage({
            from: '2026-10-10T10:00:00.001Z', // 1ms after Event 1
            to: '2026-10-10T11:59:59.999Z', // 1ms before Event 2
          });

          expect(result.totals.eventCount).toBe(0);
          expect(result.totals.inputTokens).toBe(0);
        });
      });

      describe('filtering by entity and eventType', () => {
        it('filters by agentId', async () => {
          const result = await service.getUsage({
            from: '2026-10-01T00:00:00.000Z',
            to: '2026-10-31T23:59:59.999Z',
            agentId: agent1Id,
          });

          expect(result.totals.eventCount).toBe(3);
          expect(result.totals.inputTokens).toBe(300);
        });

        it('filters by providerId', async () => {
          const result = await service.getUsage({
            from: '2026-10-01T00:00:00.000Z',
            to: '2026-10-31T23:59:59.999Z',
            providerId: prov2Id,
          });

          expect(result.totals.eventCount).toBe(2);
          expect(result.totals.inputTokens).toBe(300);
        });

        it('filters by modelId', async () => {
          const result = await service.getUsage({
            from: '2026-10-01T00:00:00.000Z',
            to: '2026-10-31T23:59:59.999Z',
            modelId: model1Id,
          });

          expect(result.totals.eventCount).toBe(4);
          expect(result.totals.inputTokens).toBe(800);
        });

        it('filters by eventType', async () => {
          const result = await service.getUsage({
            from: '2026-10-01T00:00:00.000Z',
            to: '2026-10-31T23:59:59.999Z',
            eventType: 'chat_compaction',
          });

          expect(result.totals.eventCount).toBe(1);
          expect(result.totals.inputTokens).toBe(500);
        });

        it('combines multiple filters', async () => {
          const result = await service.getUsage({
            from: '2026-10-01T00:00:00.000Z',
            to: '2026-10-31T23:59:59.999Z',
            agentId: agent1Id,
            eventType: 'chat_completion',
            modelId: model1Id,
          });

          expect(result.totals.eventCount).toBe(3);
          expect(result.totals.inputTokens).toBe(300);
        });
      });

      describe('timezone shift handling', () => {
        it('shifts time buckets when timezone offset is supplied', async () => {
          // Event 1 is at '2026-10-10T10:00:00.000Z'.
          // Add an event late on 2026-10-10: 23:30:00Z
          fixtures.createUsageEvent({
            occurred_at: '2026-10-10T23:30:00.000Z',
            input_tokens: 42,
            output_tokens: 21,
            cost_usd: 0.001,
          });

          // In UTC (+00:00): falls into '2026-10-10'
          const utcResult = await service.getUsage({
            from: '2026-10-10T00:00:00.000Z',
            to: '2026-10-11T23:59:59.999Z',
            groupBy: 'day',
            timezone: 'UTC',
          });
          const day10Utc = utcResult.groups.find(
            (g) => g.bucket === '2026-10-10',
          );
          expect(day10Utc?.eventCount).toBe(3); // Events 1, 2, and the late event

          // In UTC+02:00: 23:30Z + 2h is 01:30 on 2026-10-11!
          const tzResult = await service.getUsage({
            from: '2026-10-10T00:00:00.000Z',
            to: '2026-10-11T23:59:59.999Z',
            groupBy: 'day',
            timezone: '+02:00',
          });
          const day10Tz = tzResult.groups.find(
            (g) => g.bucket === '2026-10-10',
          );
          const day11Tz = tzResult.groups.find(
            (g) => g.bucket === '2026-10-11',
          );
          expect(day10Tz?.eventCount).toBe(2); // Events 1 and 2
          expect(day11Tz?.eventCount).toBe(2); // Event 3 and the shifted late event!
        });

        it('accepts IANA timezones (e.g. Europe/Zurich)', async () => {
          const result = await service.getUsage({
            from: '2026-10-10T00:00:00.000Z',
            to: '2026-10-11T23:59:59.999Z',
            groupBy: 'day',
            timezone: 'Europe/Zurich',
          });

          expect(result.timeZone).toBe('Europe/Zurich');
          // In CEST (UTC+2), 23:59:59 UTC on 10-11 extends to 01:59 on 10-12, covering 3 local civil days
          expect(result.groups).toHaveLength(3);
          expect(result.groups.map((g) => g.bucket)).toEqual([
            '2026-10-10',
            '2026-10-11',
            '2026-10-12',
          ]);
        });
      });
    });

    describe('validation, bad requests, and security', () => {
      it('rejects an unknown groupBy value with 400 Bad Request', async () => {
        await expect(
          service.getUsage({ groupBy: 'invalid_dimension' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects SQL injection attempts in groupBy with 400 Bad Request', async () => {
        await expect(
          service.getUsage({ groupBy: 'agent; DROP TABLE usage_events; --' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects an inverted time range with 400 Bad Request', async () => {
        await expect(
          service.getUsage({
            from: '2026-10-20T00:00:00.000Z',
            to: '2026-10-10T00:00:00.000Z',
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects invalid from timestamp strings with 400 Bad Request', async () => {
        await expect(
          service.getUsage({ from: 'not-a-valid-date' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects invalid to timestamp strings with 400 Bad Request', async () => {
        await expect(
          service.getUsage({ to: 'invalid-to-date' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects invalid eventType filter with 400 Bad Request', async () => {
        await expect(
          service.getUsage({ eventType: 'unknown_event_type' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects multiple simultaneous time bucket intervals with 400 Bad Request', async () => {
        await expect(
          service.getUsage({ groupBy: ['day', 'week'] }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects a request that exceeds the maximum bucket limit with 400 Bad Request', async () => {
        // Daily grouping over 2 years (~730 days) exceeds MAX_TIME_BUCKETS (366)
        await expect(
          service.getUsage({
            from: '2024-01-01T00:00:00.000Z',
            to: '2026-01-01T00:00:00.000Z',
            groupBy: 'day',
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects invalid timezone string with 400 Bad Request', async () => {
        await expect(
          service.getUsage({ timezone: 'Invalid/Non_Existent_Timezone' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects invalid timezone offset hours or minutes with 400 Bad Request', async () => {
        await expect(service.getUsage({ timezone: '+99:99' })).rejects.toThrow(
          BadRequestException,
        );
      });
    });
  });

  describe('getActivity aggregations and timeline series', () => {
    describe('empty table', () => {
      it('returns 200 with empty totals and zero-activity buckets when table is empty', async () => {
        const from = '2026-11-01T00:00:00.000Z';
        const to = '2026-11-03T23:59:59.999Z';
        const result = await service.getActivity({ from, to, interval: 'day' });

        expect(result.interval).toBe('day');
        expect(result.timeZone).toBe('UTC');
        expect(result.totals).toEqual({
          totalCount: 0,
          byEventType: {
            chat_completion: 0,
            chat_compaction: 0,
            agent_created: 0,
            artifact_created: 0,
          },
        });
        expect(result.series).toHaveLength(3);
        expect(result.series.map((b) => b.bucket)).toEqual([
          '2026-11-01',
          '2026-11-02',
          '2026-11-03',
        ]);
        for (const bucket of result.series) {
          expect(bucket.totalCount).toBe(0);
          expect(bucket.byEventType).toEqual({
            chat_completion: 0,
            chat_compaction: 0,
            agent_created: 0,
            artifact_created: 0,
          });
        }
      });

      it('defaults interval to day and time range to trailing 30 days when omitted', async () => {
        const result = await service.getActivity({});

        expect(result.interval).toBe('day');
        expect(result.timeRange.from).toBeDefined();
        expect(result.timeRange.to).toBeDefined();
        expect(result.totals.totalCount).toBe(0);
        expect(result.series.length).toBeGreaterThanOrEqual(30);
      });
    });

    describe('hand-verifiable activity fixtures across multiple intervals', () => {
      let agent1Id: string;
      let agent2Id: string;
      let prov1Id: string;
      let prov2Id: string;
      let model1Id: string;
      let model2Id: string;

      beforeEach(() => {
        const prov1 = fixtures.createProvider({
          name: 'OpenAI',
          kind: 'openai',
        });
        const prov2 = fixtures.createProvider({
          name: 'Anthropic',
          kind: 'anthropic',
        });
        prov1Id = prov1.id;
        prov2Id = prov2.id;

        const model1 = fixtures.createModel({
          provider_id: prov1Id,
          model_identifier: 'gpt-4o',
          display_name: 'GPT-4o',
        });
        const model2 = fixtures.createModel({
          provider_id: prov2Id,
          model_identifier: 'claude-3-5-sonnet',
          display_name: 'Claude 3.5 Sonnet',
        });
        model1Id = model1.id;
        model2Id = model2.id;

        const agent1 = fixtures.createAgent({
          name: 'Coder Agent',
          model_id: model1Id,
        });
        const agent2 = fixtures.createAgent({
          name: 'Reviewer Agent',
          model_id: model2Id,
        });
        agent1Id = agent1.id;
        agent2Id = agent2.id;

        // Event 1: 2026-10-10 14:10 UTC - chat_completion (Agent1, Prov1, Model1)
        fixtures.createUsageEvent({
          occurred_at: '2026-10-10T14:10:00.000Z',
          agent_id: agent1Id,
          provider_id: prov1Id,
          model_id: model1Id,
          event_type: 'chat_completion',
        });

        // Event 2: 2026-10-10 14:40 UTC - chat_completion (Agent1, Prov1, Model1)
        fixtures.createUsageEvent({
          occurred_at: '2026-10-10T14:40:00.000Z',
          agent_id: agent1Id,
          provider_id: prov1Id,
          model_id: model1Id,
          event_type: 'chat_completion',
        });

        // Event 3: 2026-10-10 15:20 UTC - artifact_created (Agent1, Prov1, Model1)
        fixtures.createUsageEvent({
          occurred_at: '2026-10-10T15:20:00.000Z',
          agent_id: agent1Id,
          provider_id: prov1Id,
          model_id: model1Id,
          event_type: 'artifact_created',
        });

        // Event 4: 2026-10-11 10:00 UTC - agent_created (Agent2, Prov2, Model2)
        fixtures.createUsageEvent({
          occurred_at: '2026-10-11T10:00:00.000Z',
          agent_id: agent2Id,
          provider_id: prov2Id,
          model_id: model2Id,
          event_type: 'agent_created',
        });

        // Event 5: 2026-10-12 08:00 UTC - chat_compaction (null agent / deleted, Prov1, Model1)
        fixtures.createUsageEvent({
          occurred_at: '2026-10-12T08:00:00.000Z',
          agent_id: null,
          provider_id: prov1Id,
          model_id: model1Id,
          event_type: 'chat_compaction',
        });
      });

      it('aggregates overall activity totals correctly', async () => {
        const result = await service.getActivity({
          from: '2026-10-10T00:00:00.000Z',
          to: '2026-10-12T23:59:59.999Z',
          interval: 'day',
        });

        expect(result.totals).toEqual({
          totalCount: 5,
          byEventType: {
            chat_completion: 2,
            artifact_created: 1,
            agent_created: 1,
            chat_compaction: 1,
          },
        });
      });

      it('aggregates with hour interval and fills zero-activity hour buckets', async () => {
        const from = '2026-10-10T13:00:00.000Z';
        const to = '2026-10-10T16:00:00.000Z';
        const result = await service.getActivity({
          from,
          to,
          interval: 'hour',
        });

        expect(result.interval).toBe('hour');
        expect(result.series).toHaveLength(4); // 13:00, 14:00, 15:00, 16:00
        expect(result.series.map((b) => b.bucket)).toEqual([
          '2026-10-10T13:00',
          '2026-10-10T14:00',
          '2026-10-10T15:00',
          '2026-10-10T16:00',
        ]);

        // 13:00 has 0 events:
        expect(result.series[0]).toMatchObject({
          bucket: '2026-10-10T13:00',
          totalCount: 0,
          byEventType: {
            chat_completion: 0,
            artifact_created: 0,
            agent_created: 0,
            chat_compaction: 0,
          },
        });

        // 14:00 has 2 completions (Events 1 & 2):
        expect(result.series[1]).toMatchObject({
          bucket: '2026-10-10T14:00',
          totalCount: 2,
          byEventType: {
            chat_completion: 2,
            artifact_created: 0,
            agent_created: 0,
            chat_compaction: 0,
          },
        });

        // 15:00 has 1 artifact created (Event 3):
        expect(result.series[2]).toMatchObject({
          bucket: '2026-10-10T15:00',
          totalCount: 1,
          byEventType: {
            chat_completion: 0,
            artifact_created: 1,
            agent_created: 0,
            chat_compaction: 0,
          },
        });

        // 16:00 has 0 events:
        expect(result.series[3]).toMatchObject({
          bucket: '2026-10-10T16:00',
          totalCount: 0,
          byEventType: {
            chat_completion: 0,
            artifact_created: 0,
            agent_created: 0,
            chat_compaction: 0,
          },
        });

        // Sum of bucket counts equals totalCount
        const sumCount = result.series.reduce((a, b) => a + b.totalCount, 0);
        expect(sumCount).toBe(result.totals.totalCount);
      });

      it('aggregates with day interval and fills zero-activity day buckets', async () => {
        const from = '2026-10-09T00:00:00.000Z';
        const to = '2026-10-13T23:59:59.999Z';
        const result = await service.getActivity({ from, to, interval: 'day' });

        expect(result.series).toHaveLength(5); // 10-09 through 10-13
        expect(result.series.map((b) => b.bucket)).toEqual([
          '2026-10-09',
          '2026-10-10',
          '2026-10-11',
          '2026-10-12',
          '2026-10-13',
        ]);

        // 10-09: 0 events
        expect(result.series[0].totalCount).toBe(0);

        // 10-10: 3 events (2 completions, 1 artifact)
        expect(result.series[1].totalCount).toBe(3);
        expect(result.series[1].byEventType.chat_completion).toBe(2);
        expect(result.series[1].byEventType.artifact_created).toBe(1);

        // 10-11: 1 event (agent created)
        expect(result.series[2].totalCount).toBe(1);
        expect(result.series[2].byEventType.agent_created).toBe(1);

        // 10-12: 1 event (chat compaction)
        expect(result.series[3].totalCount).toBe(1);
        expect(result.series[3].byEventType.chat_compaction).toBe(1);

        // 10-13: 0 events
        expect(result.series[4].totalCount).toBe(0);

        // Reconciles with totals:
        const sumBuckets = result.series.reduce((a, b) => a + b.totalCount, 0);
        expect(sumBuckets).toBe(result.totals.totalCount);
      });

      it('aggregates with week and month intervals', async () => {
        const from = '2026-10-01T00:00:00.000Z';
        const to = '2026-10-31T23:59:59.999Z';

        const weekResult = await service.getActivity({
          from,
          to,
          interval: 'week',
        });
        expect(weekResult.series.length).toBeGreaterThan(0);
        expect(
          weekResult.series.every((b) => /^2026-W\d{2}$/.test(b.bucket)),
        ).toBe(true);
        const sumWeek = weekResult.series.reduce((a, b) => a + b.totalCount, 0);
        expect(sumWeek).toBe(weekResult.totals.totalCount);

        const monthResult = await service.getActivity({
          from,
          to,
          interval: 'month',
        });
        expect(monthResult.series).toHaveLength(1);
        expect(monthResult.series[0].bucket).toBe('2026-10');
        expect(monthResult.series[0].totalCount).toBe(5);
      });

      describe('bucket boundary timestamp conditions', () => {
        it('assigns boundary events to the exact bucket', () => {
          // Event exactly at 14:00:00.000Z
          fixtures.createUsageEvent({
            occurred_at: '2026-10-10T14:00:00.000Z',
            event_type: 'chat_completion',
          });
          // Event at 14:59:59.999Z
          fixtures.createUsageEvent({
            occurred_at: '2026-10-10T14:59:59.999Z',
            event_type: 'chat_completion',
          });

          return service
            .getActivity({
              from: '2026-10-10T14:00:00.000Z',
              to: '2026-10-10T14:59:59.999Z',
              interval: 'hour',
            })
            .then((res) => {
              expect(res.series).toHaveLength(1);
              expect(res.series[0].bucket).toBe('2026-10-10T14:00');
              // 2 boundary events + 2 previously seeded in 14:00 = 4
              expect(res.series[0].totalCount).toBe(4);
            });
        });
      });

      describe('filtering by entity and event type', () => {
        it('filters by eventType', async () => {
          const result = await service.getActivity({
            from: '2026-10-01T00:00:00.000Z',
            to: '2026-10-31T23:59:59.999Z',
            eventType: 'chat_completion',
          });

          expect(result.totals.totalCount).toBe(2);
          expect(result.totals.byEventType.chat_completion).toBe(2);
          expect(result.totals.byEventType.artifact_created).toBe(0);
          expect(result.totals.byEventType.agent_created).toBe(0);
        });

        it('filters by agentId', async () => {
          const result = await service.getActivity({
            from: '2026-10-01T00:00:00.000Z',
            to: '2026-10-31T23:59:59.999Z',
            agentId: agent1Id,
          });

          // Events 1, 2, 3 belong to Agent1
          expect(result.totals.totalCount).toBe(3);
          expect(result.totals.byEventType.chat_completion).toBe(2);
          expect(result.totals.byEventType.artifact_created).toBe(1);
        });

        it('filters by providerId', async () => {
          const result = await service.getActivity({
            from: '2026-10-01T00:00:00.000Z',
            to: '2026-10-31T23:59:59.999Z',
            providerId: prov2Id,
          });

          // Event 4 belongs to Prov2
          expect(result.totals.totalCount).toBe(1);
          expect(result.totals.byEventType.agent_created).toBe(1);
        });

        it('filters by modelId', async () => {
          const result = await service.getActivity({
            from: '2026-10-01T00:00:00.000Z',
            to: '2026-10-31T23:59:59.999Z',
            modelId: model1Id,
          });

          // Events 1, 2, 3, 5 belong to Model1
          expect(result.totals.totalCount).toBe(4);
        });

        it('combines filters (agentId + eventType)', async () => {
          const result = await service.getActivity({
            from: '2026-10-01T00:00:00.000Z',
            to: '2026-10-31T23:59:59.999Z',
            agentId: agent1Id,
            eventType: 'artifact_created',
          });

          expect(result.totals.totalCount).toBe(1);
          expect(result.totals.byEventType.artifact_created).toBe(1);
        });

        it('retains unattributed events with null foreign key unless explicitly filtered', async () => {
          // Event 5 has agent_id: null
          const allResult = await service.getActivity({
            from: '2026-10-01T00:00:00.000Z',
            to: '2026-10-31T23:59:59.999Z',
          });
          expect(allResult.totals.byEventType.chat_compaction).toBe(1);

          // Filtering by agent1Id excludes Event 5
          const agent1Result = await service.getActivity({
            from: '2026-10-01T00:00:00.000Z',
            to: '2026-10-31T23:59:59.999Z',
            agentId: agent1Id,
          });
          expect(agent1Result.totals.byEventType.chat_compaction).toBe(0);
        });
      });

      describe('timezone shift handling', () => {
        it('shifts bucket hours according to timezone offset modifier', async () => {
          // Event 1 is at 14:10:00Z.
          // In UTC (+00:00): bucket is 14:00
          const utcRes = await service.getActivity({
            from: '2026-10-10T14:00:00.000Z',
            to: '2026-10-10T16:00:00.000Z',
            interval: 'hour',
            timezone: '+00:00',
          });
          expect(
            utcRes.series.find((b) => b.bucket === '2026-10-10T14:00')
              ?.totalCount,
          ).toBe(2);

          // In +02:00: 14:10 UTC becomes 16:10 local!
          const tzRes = await service.getActivity({
            from: '2026-10-10T14:00:00.000Z',
            to: '2026-10-10T16:00:00.000Z',
            interval: 'hour',
            timezone: '+02:00',
          });
          // In local time (+2h), the query from/to shifted is 16:00 to 18:00
          expect(
            tzRes.series.find((b) => b.bucket === '2026-10-10T16:00')
              ?.totalCount,
          ).toBe(2);
        });
      });
    });

    describe('validation, bad requests, and error cases', () => {
      it('rejects an unknown interval with 400 Bad Request', async () => {
        await expect(
          service.getActivity({ interval: 'minute' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects SQL injection attempts in interval with 400 Bad Request', async () => {
        await expect(
          service.getActivity({ interval: 'day; DROP TABLE usage_events; --' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects an inverted time range with 400 Bad Request', async () => {
        await expect(
          service.getActivity({
            from: '2026-10-20T00:00:00.000Z',
            to: '2026-10-10T00:00:00.000Z',
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects invalid from timestamp with 400 Bad Request', async () => {
        await expect(
          service.getActivity({ from: 'not-a-valid-date' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects invalid to timestamp with 400 Bad Request', async () => {
        await expect(
          service.getActivity({ to: 'not-a-valid-date' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects invalid eventType filter with 400 Bad Request', async () => {
        await expect(
          service.getActivity({ eventType: 'invalid_event_type' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects a request that exceeds the maximum bucket limit (hourly over a year) with 400 Bad Request', async () => {
        // Hourly grouping over 1 year (~8760 hours) exceeds MAX_ACTIVITY_BUCKETS (1000)
        await expect(
          service.getActivity({
            from: '2025-01-01T00:00:00.000Z',
            to: '2026-01-01T00:00:00.000Z',
            interval: 'hour',
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects invalid timezone with 400 Bad Request', async () => {
        await expect(
          service.getActivity({ timezone: 'Invalid/Timezone' }),
        ).rejects.toThrow(BadRequestException);
      });
    });
  });
});
