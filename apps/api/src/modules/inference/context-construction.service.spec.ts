import { NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../database/database.service.js';
import { ContextLengthExceededError } from '../../model-adapters/errors/model-adapter-error.js';
import { TestFixtures } from '../../../test/harness/fixtures.js';
import {
  assembleSystemPrompt,
  buildContextPure,
  ContextConstructionService,
  estimateMessageTokens,
  estimateTokens,
} from './context-construction.service.js';
import type {
  BuildContextInput,
  ContextInputMessage,
  ContextSourceData,
  MemoryInjectionSeam,
} from './context-construction.types.js';

describe('ContextConstructionService (Pure assembly & fitting)', () => {
  // =========================================================================
  // 1. System Context Assembly: 8 Combinations of Prompt, Personality, Instructions
  // =========================================================================
  describe('System prompt layer combinations (8 cases)', () => {
    const P = 'You are a foundational system assistant.';
    const PERS = 'Speaks only in haiku.';
    const I = 'Always answer in concise sentences.';

    it('Case 1: None present (all undefined or empty) -> undefined systemPrompt', () => {
      const sources: ContextSourceData = {};
      const { systemPrompt, breakdown } = assembleSystemPrompt(sources);

      expect(systemPrompt).toBeUndefined();
      expect(breakdown.combined).toBeNull();
      expect(breakdown.promptTemplate).toBeNull();
      expect(breakdown.personality).toBeNull();
      expect(breakdown.instructions).toBeNull();
    });

    it('Case 2: System prompt only', () => {
      const sources: ContextSourceData = { systemPromptTemplate: P };
      const { systemPrompt, breakdown } = assembleSystemPrompt(sources);

      expect(systemPrompt).toBe(P);
      expect(breakdown.combined).toBe(P);
      expect(breakdown.promptTemplate).toBe(P);
      expect(breakdown.personality).toBeNull();
      expect(breakdown.instructions).toBeNull();
    });

    it('Case 3: Personality only', () => {
      const sources: ContextSourceData = { personality: PERS };
      const { systemPrompt, breakdown } = assembleSystemPrompt(sources);

      expect(systemPrompt).toBe(PERS);
      expect(breakdown.combined).toBe(PERS);
      expect(breakdown.promptTemplate).toBeNull();
      expect(breakdown.personality).toBe(PERS);
      expect(breakdown.instructions).toBeNull();
    });

    it('Case 4: Instructions only', () => {
      const sources: ContextSourceData = { instructions: I };
      const { systemPrompt, breakdown } = assembleSystemPrompt(sources);

      expect(systemPrompt).toBe(I);
      expect(breakdown.combined).toBe(I);
      expect(breakdown.promptTemplate).toBeNull();
      expect(breakdown.personality).toBeNull();
      expect(breakdown.instructions).toBe(I);
    });

    it('Case 5: System prompt + Personality', () => {
      const sources: ContextSourceData = {
        systemPromptTemplate: P,
        personality: PERS,
      };
      const { systemPrompt, breakdown } = assembleSystemPrompt(sources);

      const expected = `${P}\n\n${PERS}`;
      expect(systemPrompt).toBe(expected);
      expect(breakdown.combined).toBe(expected);
      expect(breakdown.promptTemplate).toBe(P);
      expect(breakdown.personality).toBe(PERS);
      expect(breakdown.instructions).toBeNull();
    });

    it('Case 6: System prompt + Instructions', () => {
      const sources: ContextSourceData = {
        systemPromptTemplate: P,
        instructions: I,
      };
      const { systemPrompt, breakdown } = assembleSystemPrompt(sources);

      const expected = `${P}\n\n${I}`;
      expect(systemPrompt).toBe(expected);
      expect(breakdown.combined).toBe(expected);
      expect(breakdown.promptTemplate).toBe(P);
      expect(breakdown.personality).toBeNull();
      expect(breakdown.instructions).toBe(I);
    });

    it('Case 7: Personality + Instructions', () => {
      const sources: ContextSourceData = {
        personality: PERS,
        instructions: I,
      };
      const { systemPrompt, breakdown } = assembleSystemPrompt(sources);

      const expected = `${PERS}\n\n${I}`;
      expect(systemPrompt).toBe(expected);
      expect(breakdown.combined).toBe(expected);
      expect(breakdown.promptTemplate).toBeNull();
      expect(breakdown.personality).toBe(PERS);
      expect(breakdown.instructions).toBe(I);
    });

    it('Case 8: System prompt + Personality + Instructions (all 3 present)', () => {
      const sources: ContextSourceData = {
        systemPromptTemplate: P,
        personality: PERS,
        instructions: I,
      };
      const { systemPrompt, breakdown } = assembleSystemPrompt(sources);

      // Documented order: System Prompt -> Personality -> Instructions
      const expected = `${P}\n\n${PERS}\n\n${I}`;
      expect(systemPrompt).toBe(expected);
      expect(breakdown.combined).toBe(expected);
      expect(breakdown.promptTemplate).toBe(P);
      expect(breakdown.personality).toBe(PERS);
      expect(breakdown.instructions).toBe(I);
    });

    it('trims whitespace and ignores whitespace-only fields', () => {
      const sources: ContextSourceData = {
        systemPromptTemplate: '   \n  ',
        personality: '  Witty and sharp.  ',
        instructions: '   ',
      };
      const { systemPrompt } = assembleSystemPrompt(sources);

      expect(systemPrompt).toBe('Witty and sharp.');
    });
  });

  // =========================================================================
  // 2. Token Estimation Heuristic
  // =========================================================================
  describe('Token estimation heuristic', () => {
    it('estimates tokens using character count ceiling (~4 chars/token)', () => {
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens(null)).toBe(0);
      expect(estimateTokens(undefined)).toBe(0);
      expect(estimateTokens('abcd')).toBe(1);
      expect(estimateTokens('abcde')).toBe(2);
      expect(estimateTokens('12345678')).toBe(2);
      expect(estimateTokens('123456789')).toBe(3);
    });

    it('includes 4 framing tokens overhead in message token estimation', () => {
      const msg = { role: 'user' as const, content: 'Hello' };
      // 4 overhead + ceil(5 / 4) = 4 + 2 = 6
      expect(estimateMessageTokens(msg)).toBe(6);
    });

    it('adds participant name tokens when message has an agent name/id', () => {
      const msg = {
        role: 'assistant' as const,
        content: 'Hi',
        name: 'agent_coder_1',
      };
      // 4 overhead + ceil(2/4)=1 + ceil(13/4)=4 -> 9 tokens
      expect(estimateMessageTokens(msg)).toBe(9);
    });
  });

  // =========================================================================
  // 3. History Ordering & Role Mapping
  // =========================================================================
  describe('History ordering and role mapping', () => {
    it('orders messages strictly by sequence ascending, including interleaved roles', () => {
      const inputMessages: ContextInputMessage[] = [
        {
          sequence: 4,
          role: 'assistant',
          content: 'Step 4 done.',
          status: 'complete',
        },
        {
          sequence: 1,
          role: 'user',
          content: 'Step 1 start.',
          status: 'complete',
        },
        {
          sequence: 3,
          role: 'tool',
          content: 'Step 3 result.',
          status: 'complete',
        },
        {
          sequence: 2,
          role: 'assistant',
          content: 'Step 2 thinking.',
          status: 'complete',
        },
        {
          sequence: 5,
          role: 'user',
          content: 'Step 5 next.',
          status: 'complete',
        },
      ];

      const assembled = buildContextPure({
        sources: {},
        messages: inputMessages,
      });

      expect(assembled.messages).toHaveLength(5);
      expect(assembled.messages.map((m) => m.content)).toEqual([
        'Step 1 start.',
        'Step 2 thinking.',
        'Step 3 result.',
        'Step 4 done.',
        'Step 5 next.',
      ]);
      expect(assembled.messages.map((m) => m.role)).toEqual([
        'user',
        'assistant',
        'tool',
        'assistant',
        'user',
      ]);
      expect(assembled.messageDetails.map((m) => m.sequence)).toEqual([
        1, 2, 3, 4, 5,
      ]);
    });
  });

  // =========================================================================
  // 4. context_summary Incorporation and Replacement
  // =========================================================================
  describe('context_summary incorporation and message replacement', () => {
    it('omits context summary when absent', () => {
      const assembled = buildContextPure({
        sources: {
          systemPromptTemplate: 'Base prompt',
          contextSummary: null,
        },
        messages: [
          { sequence: 1, role: 'user', content: 'Turn 1', status: 'complete' },
        ],
      });

      expect(assembled.systemPrompt).toBe('Base prompt');
      expect(assembled.systemDetails.contextSummary).toBeNull();
      expect(assembled.messages).toHaveLength(1);
    });

    it('incorporates context summary into system context under "Context summary:" label', () => {
      const summary =
        'The user discussed setting up a NestJS API and chose SQLite.';
      const assembled = buildContextPure({
        sources: {
          systemPromptTemplate: 'Base prompt',
          instructions: 'Be helpful.',
          contextSummary: summary,
        },
        messages: [
          { sequence: 1, role: 'user', content: 'Turn 1', status: 'complete' },
        ],
      });

      expect(assembled.systemPrompt).toContain('Base prompt');
      expect(assembled.systemPrompt).toContain('Be helpful.');
      expect(assembled.systemPrompt).toContain(`Context summary:\n${summary}`);
      expect(assembled.systemDetails.contextSummary).toBe(summary);
    });

    it('documents that context_summary replaces prior turns and does not duplicate active messages', () => {
      const summary = 'User asked about weather. Assistant replied rainy.';
      const inputMessages: ContextInputMessage[] = [
        // Messages 1 and 2 were covered in summary; sequence 3 is new post-compaction turn
        {
          sequence: 1,
          role: 'user',
          content: 'What is the weather?',
          status: 'complete',
        },
        {
          sequence: 2,
          role: 'assistant',
          content: 'It is rainy.',
          status: 'complete',
        },
        {
          sequence: 3,
          role: 'user',
          content: 'Should I bring an umbrella?',
          status: 'complete',
        },
      ];

      // Specifying compactedBeforeSequence=3 ensures turns covered by the summary are pruned
      const assembled = buildContextPure({
        sources: { contextSummary: summary },
        messages: inputMessages,
        compactedBeforeSequence: 3,
      });

      expect(assembled.systemPrompt).toBe(`Context summary:\n${summary}`);
      expect(assembled.messages).toHaveLength(1);
      expect(assembled.messages[0].content).toBe('Should I bring an umbrella?');
      expect(assembled.excludedMessages).toHaveLength(2);
      expect(assembled.excludedMessages[0].reason).toBe('compacted_history');
      expect(assembled.excludedMessages[1].reason).toBe('compacted_history');
    });
  });

  // =========================================================================
  // 5. Context Window Fitting: Over-limit Strategy & Unknown Window
  // =========================================================================
  describe('Context window fitting and over-limit strategy', () => {
    it('handles unknown context_window (null or undefined) by proceeding without fitting', () => {
      const longMessage = 'A'.repeat(2000);
      const assembled = buildContextPure({
        sources: { systemPromptTemplate: 'Prompt' },
        messages: [
          {
            sequence: 1,
            role: 'user',
            content: longMessage,
            status: 'complete',
          },
        ],
        contextWindow: null, // Unknown window
      });

      expect(assembled.messages).toHaveLength(1);
      expect(assembled.tokenEstimate.contextWindow).toBeNull();
      expect(assembled.tokenEstimate.fitsContextWindow).toBe(true);
      expect(assembled.tokenEstimate.totalTokens).toBeGreaterThan(500);
    });

    it('succeeds when history is within model context window', () => {
      const assembled = buildContextPure({
        sources: { systemPromptTemplate: 'Prompt' },
        messages: [
          { sequence: 1, role: 'user', content: 'Short', status: 'complete' },
        ],
        contextWindow: 1000,
      });

      expect(assembled.messages).toHaveLength(1);
      expect(assembled.tokenEstimate.fitsContextWindow).toBe(true);
    });

    it('refuses with ContextLengthExceededError (413) by default when history exceeds context window', () => {
      // 400 characters = ~100 tokens + overhead. With window = 30 tokens, must refuse.
      const longMessage = 'A'.repeat(400);

      expect(() =>
        buildContextPure({
          sources: { systemPromptTemplate: 'Prompt' },
          messages: [
            {
              sequence: 1,
              role: 'user',
              content: longMessage,
              status: 'complete',
            },
          ],
          contextWindow: 30,
          fittingStrategy: 'refuse',
        }),
      ).toThrow(ContextLengthExceededError);

      try {
        buildContextPure({
          sources: { systemPromptTemplate: 'Prompt' },
          messages: [
            {
              sequence: 1,
              role: 'user',
              content: longMessage,
              status: 'complete',
            },
          ],
          contextWindow: 30,
        });
      } catch (err: any) {
        expect(err.statusCode).toBe(413);
        expect(err.code).toBe('CONTEXT_LENGTH_EXCEEDED');
        expect(err.message).toContain(
          'Context length exceeded: prompt contains approximately',
        );
      }
    });

    it('supports alternative "truncate_oldest" strategy to drop oldest messages until fitting', () => {
      const msg1 = {
        sequence: 1,
        role: 'user',
        content: 'Old turn 1 ' + 'A'.repeat(80),
        status: 'complete',
      };
      const msg2 = {
        sequence: 2,
        role: 'assistant',
        content: 'Old turn 2 ' + 'B'.repeat(80),
        status: 'complete',
      };
      const msg3 = {
        sequence: 3,
        role: 'user',
        content: 'Recent question',
        status: 'complete',
      };

      // Each msg1 & msg2 takes ~25 tokens. msg3 takes ~8 tokens. System prompt takes ~5 tokens.
      // With contextWindow = 35, msg1 and msg2 should be dropped, preserving msg3.
      const assembled = buildContextPure({
        sources: { systemPromptTemplate: 'Hi' },
        messages: [msg1, msg2, msg3],
        contextWindow: 35,
        fittingStrategy: 'truncate_oldest',
      });

      expect(assembled.messages).toHaveLength(1);
      expect(assembled.messages[0].content).toBe('Recent question');
      expect(assembled.excludedMessages).toHaveLength(2);
      expect(assembled.excludedMessages[0].reason).toBe('truncated_for_window');
      expect(assembled.excludedMessages[0].sequence).toBe(1);
      expect(assembled.excludedMessages[1].reason).toBe('truncated_for_window');
      expect(assembled.excludedMessages[1].sequence).toBe(2);
    });

    it('throws ContextLengthExceededError under "truncate_oldest" if single turn still exceeds window', () => {
      const hugeTurn = 'X'.repeat(500);

      expect(() =>
        buildContextPure({
          sources: {},
          messages: [
            {
              sequence: 1,
              role: 'user',
              content: hugeTurn,
              status: 'complete',
            },
          ],
          contextWindow: 10,
          fittingStrategy: 'truncate_oldest',
        }),
      ).toThrow(ContextLengthExceededError);
    });
  });

  // =========================================================================
  // 6. Message Status Inclusion / Exclusion Rules
  // =========================================================================
  describe('Message status handling (pending, streaming, error, complete)', () => {
    it('includes complete messages and excludes pending, streaming, and error messages', () => {
      const messages: ContextInputMessage[] = [
        {
          sequence: 1,
          role: 'user',
          content: 'Hello assistant',
          status: 'complete',
        },
        {
          sequence: 2,
          role: 'assistant',
          content: 'Partial generation...',
          status: 'streaming',
        },
        {
          sequence: 3,
          role: 'assistant',
          content: '',
          status: 'pending',
        },
        {
          sequence: 4,
          role: 'assistant',
          content: 'Aborted halfway due to error...',
          status: 'error',
        },
        {
          sequence: 5,
          role: 'user',
          content: 'Can you try again?',
          status: 'complete',
        },
      ];

      const assembled = buildContextPure({
        sources: {},
        messages,
      });

      expect(assembled.messages).toHaveLength(2);
      expect(assembled.messages[0].content).toBe('Hello assistant');
      expect(assembled.messages[1].content).toBe('Can you try again?');

      expect(assembled.excludedMessages).toHaveLength(3);
      expect(assembled.excludedMessages.map((e) => e.status)).toEqual([
        'streaming',
        'pending',
        'error',
      ]);
      expect(
        assembled.excludedMessages.every(
          (e) => e.reason === 'status_not_complete',
        ),
      ).toBe(true);
    });

    it('excludes complete messages with empty or whitespace-only content', () => {
      const messages: ContextInputMessage[] = [
        {
          sequence: 1,
          role: 'user',
          content: '   ',
          status: 'complete',
        },
        {
          sequence: 2,
          role: 'user',
          content: 'Real message',
          status: 'complete',
        },
      ];

      const assembled = buildContextPure({
        sources: {},
        messages,
      });

      expect(assembled.messages).toHaveLength(1);
      expect(assembled.messages[0].content).toBe('Real message');
      expect(assembled.excludedMessages).toHaveLength(1);
      expect(assembled.excludedMessages[0].reason).toBe('empty_content');
    });
  });

  // =========================================================================
  // 7. Null Agent ID & Team Attribution
  // =========================================================================
  describe('Null agent_id and team attribution preservation', () => {
    it('handles a message with a null agent_id without erroring', () => {
      const messages: ContextInputMessage[] = [
        {
          sequence: 1,
          role: 'assistant',
          content: 'Produced by an agent that was subsequently deleted',
          status: 'complete',
          agentId: null,
        },
      ];

      const assembled = buildContextPure({
        sources: {},
        messages,
      });

      expect(assembled.messages).toHaveLength(1);
      expect(assembled.messages[0].name).toBeUndefined();
      expect(assembled.messageDetails[0].agentId).toBeNull();
    });

    it('preserves per-message agent attribution in team chats', () => {
      const messages: ContextInputMessage[] = [
        {
          sequence: 1,
          role: 'user',
          content: 'Plan architecture',
          status: 'complete',
        },
        {
          sequence: 2,
          role: 'assistant',
          content: 'Here is the schema',
          status: 'complete',
          agentId: 'architect-agent-id',
        },
        {
          sequence: 3,
          role: 'assistant',
          content: 'Here is the implementation',
          status: 'complete',
          agentId: 'coder-agent-id',
        },
      ];

      const assembled = buildContextPure({
        sources: {},
        messages,
      });

      expect(assembled.messages).toHaveLength(3);
      expect(assembled.messages[0].name).toBeUndefined();
      expect(assembled.messages[1].name).toBe('architect-agent-id');
      expect(assembled.messages[2].name).toBe('coder-agent-id');

      expect(assembled.messageDetails[1].agentId).toBe('architect-agent-id');
      expect(assembled.messageDetails[2].agentId).toBe('coder-agent-id');
    });
  });

  // =========================================================================
  // 8. Semantic Memory Seam
  // =========================================================================
  describe('Semantic memory seam (docs/rfc-semantic-memory.md)', () => {
    it('leaves marked seam with nothing injected by default', () => {
      const assembled = buildContextPure({
        sources: {
          systemPromptTemplate: 'Base prompt',
        },
        messages: [],
      });

      expect(assembled.systemPrompt).toBe('Base prompt');
      expect(assembled.systemDetails.memorySeam).toBeNull();
    });

    it('injects memories via seam when provider hook supplies them', () => {
      const mockSeam: MemoryInjectionSeam = {
        retrieveMemories: () => [
          'User prefers strict TypeScript.',
          'Always use snake_case for SQLite columns.',
        ],
      };

      const assembled = buildContextPure({
        sources: {
          systemPromptTemplate: 'Base prompt',
          personality: 'Helpful',
          instructions: 'Follow guidelines',
          contextSummary: 'Prior discussion',
        },
        messages: [],
        memorySeam: mockSeam,
      });

      expect(assembled.systemPrompt).toContain(
        '<memories>\nUser prefers strict TypeScript.\nAlways use snake_case for SQLite columns.\n</memories>',
      );
      expect(assembled.systemDetails.memorySeam).toContain('<memories>');
    });

    it('safely handles memory injection retriever errors without breaking prompt assembly', () => {
      const failingSeam: MemoryInjectionSeam = {
        retrieveMemories: () => {
          throw new Error('Vector DB connection timeout');
        },
      };

      const assembled = buildContextPure({
        sources: { systemPromptTemplate: 'Base prompt' },
        messages: [],
        memorySeam: failingSeam,
      });

      expect(assembled.systemPrompt).toBe('Base prompt');
      expect(assembled.systemDetails.memorySeam).toBeNull();
    });
  });

  // =========================================================================
  // 9. Snapshot-Style Test Over Fully-Populated Agent
  // =========================================================================
  describe('Snapshot-style test over fully-populated agent', () => {
    it('produces an exact stable snapshot of assembled context and breakdown', () => {
      const input: BuildContextInput = {
        sources: {
          systemPromptTemplate:
            'You are an expert AI software engineer in Glassbeetle.',
          personality: 'Professional, analytical, and highly structured.',
          instructions:
            'Always write idiomatic TypeScript. Never omit type annotations.',
          contextSummary:
            'The user previously initialized the database and ran migrations.',
        },
        messages: [
          {
            id: 'msg-1',
            sequence: 1,
            role: 'user',
            content: 'How should we build the context construction service?',
            status: 'complete',
            agentId: null,
          },
          {
            id: 'msg-2',
            sequence: 2,
            role: 'assistant',
            content:
              'We should isolate it as a pure function and test all edge cases.',
            status: 'complete',
            agentId: 'agent-senior-dev',
          },
          {
            id: 'msg-3',
            sequence: 3,
            role: 'user',
            content: 'Sounds great, please implement it.',
            status: 'complete',
          },
        ],
        contextWindow: 10000,
      };

      const assembled = buildContextPure(input);

      // Snapshot assertion over full assembled structure
      expect(assembled).toMatchInlineSnapshot(`
        {
          "excludedMessages": [],
          "messageDetails": [
            {
              "agentId": null,
              "content": "How should we build the context construction service?",
              "estimatedTokens": 18,
              "id": "msg-1",
              "role": "user",
              "sequence": 1,
              "status": "complete",
            },
            {
              "agentId": "agent-senior-dev",
              "content": "We should isolate it as a pure function and test all edge cases.",
              "estimatedTokens": 24,
              "id": "msg-2",
              "role": "assistant",
              "sequence": 2,
              "status": "complete",
            },
            {
              "agentId": null,
              "content": "Sounds great, please implement it.",
              "estimatedTokens": 13,
              "id": "msg-3",
              "role": "user",
              "sequence": 3,
              "status": "complete",
            },
          ],
          "messages": [
            {
              "content": "How should we build the context construction service?",
              "role": "user",
            },
            {
              "content": "We should isolate it as a pure function and test all edge cases.",
              "name": "agent-senior-dev",
              "role": "assistant",
            },
            {
              "content": "Sounds great, please implement it.",
              "role": "user",
            },
          ],
          "systemDetails": {
            "combined": "You are an expert AI software engineer in Glassbeetle.

        Professional, analytical, and highly structured.

        Always write idiomatic TypeScript. Never omit type annotations.

        Context summary:
        The user previously initialized the database and ran migrations.",
            "contextSummary": "The user previously initialized the database and ran migrations.",
            "instructions": "Always write idiomatic TypeScript. Never omit type annotations.",
            "memorySeam": null,
            "personality": "Professional, analytical, and highly structured.",
            "promptTemplate": "You are an expert AI software engineer in Glassbeetle.",
          },
          "systemPrompt": "You are an expert AI software engineer in Glassbeetle.

        Professional, analytical, and highly structured.

        Always write idiomatic TypeScript. Never omit type annotations.

        Context summary:
        The user previously initialized the database and ran migrations.",
          "tokenEstimate": {
            "contextWindow": 10000,
            "fitsContextWindow": true,
            "heuristic": "Character-based heuristic (~4 characters per token + 4 tokens overhead per message/system turn). Exact token count requires model-specific tokenizer.",
            "messagesTokens": 55,
            "systemTokens": 67,
            "totalTokens": 122,
          },
        }
      `);
    });
  });
});

// ===========================================================================
// Database-Backed ContextConstructionService Tests
// ===========================================================================
describe('ContextConstructionService (Database-backed integration)', () => {
  let db: DatabaseService;
  let fixtures: TestFixtures;
  let service: ContextConstructionService;

  beforeEach(() => {
    db = new DatabaseService();
    db.connect(':memory:');
    fixtures = new TestFixtures(db);
    service = new ContextConstructionService(db);
  });

  afterEach(() => {
    db.close();
  });

  it('builds context successfully for an agent with no system prompt (system_prompt_id: null)', () => {
    const model = fixtures.createModel({ context_window: 4096 });
    const agent = fixtures.createAgent({
      model_id: model.id,
      system_prompt_id: null,
      personality: 'Casual tone',
      instructions: 'Answer with brevity',
    });
    const chat = fixtures.createChat({ agent_id: agent.id });

    fixtures.createMessage({
      chat_id: chat.id,
      sequence: 1,
      role: 'user',
      content: 'Hello agent without system prompt',
      status: 'complete',
    });

    const assembled = service.buildForChat(chat, agent, model);

    expect(assembled.systemPrompt).toBe('Casual tone\n\nAnswer with brevity');
    expect(assembled.systemDetails.promptTemplate).toBeNull();
    expect(assembled.systemDetails.personality).toBe('Casual tone');
    expect(assembled.systemDetails.instructions).toBe('Answer with brevity');
    expect(assembled.messages).toHaveLength(1);
    expect(assembled.messages[0].content).toBe(
      'Hello agent without system prompt',
    );
  });

  it('builds and inspects context by chatId through buildByChatId / inspect', () => {
    const prompt = fixtures.createSystemPrompt({
      content: 'Root system instructions.',
    });
    const model = fixtures.createModel({ context_window: 128000 });
    const agent = fixtures.createAgent({
      model_id: model.id,
      system_prompt_id: prompt.id,
      personality: 'Direct and honest',
      instructions: 'Always return JSON',
    });
    const chat = fixtures.createChat({
      agent_id: agent.id,
      context_summary: 'Prior turns discussed data formats.',
    });

    fixtures.createMessage({
      chat_id: chat.id,
      sequence: 1,
      role: 'user',
      content: 'Show me the format',
      status: 'complete',
    });

    const inspected = service.inspect(chat.id);

    expect(inspected.systemPrompt).toContain('Root system instructions.');
    expect(inspected.systemPrompt).toContain('Direct and honest');
    expect(inspected.systemPrompt).toContain('Always return JSON');
    expect(inspected.systemPrompt).toContain(
      'Context summary:\nPrior turns discussed data formats.',
    );
    expect(inspected.messages).toHaveLength(1);
    expect(inspected.messages[0].content).toBe('Show me the format');
    expect(inspected.tokenEstimate.contextWindow).toBe(128000);
    expect(inspected.tokenEstimate.fitsContextWindow).toBe(true);
  });

  it('throws NotFoundException when chat does not exist', () => {
    expect(() => service.buildByChatId('non-existent-chat')).toThrow(
      NotFoundException,
    );
  });

  it('throws NotFoundException when chat has no agent (team chat without individual agent)', () => {
    const team = fixtures.createTeam({ name: 'Architecture Team' });
    const chat = fixtures.createChat({ agent_id: null, team_id: team.id });

    expect(() => service.buildByChatId(chat.id)).toThrow(NotFoundException);
  });
});
