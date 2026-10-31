import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../../database/database.service.js';
import { TestFixtures } from '../../../../test/harness/fixtures.js';
import { ChatsService } from '../chats.service.js';
import { MessagesService } from './messages.service.js';

describe('MessagesService', () => {
  let db: DatabaseService;
  let fixtures: TestFixtures;
  let chats: ChatsService;
  let service: MessagesService;

  beforeEach(() => {
    db = new DatabaseService();
    db.connect(':memory:');
    fixtures = new TestFixtures(db);
    chats = new ChatsService(db);
    service = new MessagesService(db, chats);
  });

  afterEach(() => {
    db.close();
  });

  describe('chat isolation and scoping', () => {
    it('returns only the messages belonging to the requested chat and no others', async () => {
      const chat1 = fixtures.createChat({ title: 'Chat 1' });
      const chat2 = fixtures.createChat({ title: 'Chat 2' });

      fixtures.createMessage({
        chat_id: chat1.id,
        sequence: 1,
        content: 'Chat 1 Message 1',
      });
      fixtures.createMessage({
        chat_id: chat1.id,
        sequence: 2,
        content: 'Chat 1 Message 2',
      });

      fixtures.createMessage({
        chat_id: chat2.id,
        sequence: 1,
        content: 'Chat 2 Message 1',
      });

      const res1 = await service.findAll(chat1.id, { limit: 50, offset: 0 });
      expect(res1.total).toBe(2);
      expect(res1.items).toHaveLength(2);
      expect(res1.items.map((m) => m.content)).toEqual([
        'Chat 1 Message 1',
        'Chat 1 Message 2',
      ]);
      expect(res1.items.every((m) => m.chatId === chat1.id)).toBe(true);

      const res2 = await service.findAll(chat2.id, { limit: 50, offset: 0 });
      expect(res2.total).toBe(1);
      expect(res2.items).toHaveLength(1);
      expect(res2.items[0].content).toBe('Chat 2 Message 1');
      expect(res2.items[0].chatId).toBe(chat2.id);
    });

    it('throws 404 NotFoundException for an unknown chat', async () => {
      await expect(
        service.findAll('non-existent-chat-id', { limit: 50, offset: 0 }),
      ).rejects.toThrow(NotFoundException);

      try {
        await service.findAll('non-existent-chat-id', { limit: 50, offset: 0 });
      } catch (error: any) {
        expect(error.getResponse()).toEqual({
          code: 'CHAT_NOT_FOUND',
          message: 'Chat with ID "non-existent-chat-id" not found',
        });
      }
    });

    it('returns an empty collection with 200 for a chat with no messages', async () => {
      const chat = fixtures.createChat({ title: 'Empty Chat' });

      const res = await service.findAll(chat.id, { limit: 50, offset: 0 });
      expect(res).toEqual({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      });
    });
  });

  describe('ordering by sequence', () => {
    it('orders by sequence ascending by default', async () => {
      const chat = fixtures.createChat();
      fixtures.createMessage({ chat_id: chat.id, sequence: 1, content: 'First' });
      fixtures.createMessage({ chat_id: chat.id, sequence: 2, content: 'Second' });
      fixtures.createMessage({ chat_id: chat.id, sequence: 3, content: 'Third' });

      const res = await service.findAll(chat.id, { limit: 50, offset: 0 });
      expect(res.items.map((m) => m.sequence)).toEqual([1, 2, 3]);
      expect(res.items.map((m) => m.content)).toEqual(['First', 'Second', 'Third']);
    });

    it('reverses order when order=desc is specified', async () => {
      const chat = fixtures.createChat();
      fixtures.createMessage({ chat_id: chat.id, sequence: 1, content: 'First' });
      fixtures.createMessage({ chat_id: chat.id, sequence: 2, content: 'Second' });
      fixtures.createMessage({ chat_id: chat.id, sequence: 3, content: 'Third' });

      const res = await service.findAll(chat.id, {
        limit: 50,
        offset: 0,
        order: 'desc',
      });
      expect(res.items.map((m) => m.sequence)).toEqual([3, 2, 1]);
      expect(res.items.map((m) => m.content)).toEqual(['Third', 'Second', 'First']);
    });

    it('rejects an invalid sort field with 400 BadRequestException', async () => {
      const chat = fixtures.createChat();

      await expect(
        service.findAll(chat.id, {
          limit: 50,
          offset: 0,
          sort: 'created_at',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts explicitly sort=sequence', async () => {
      const chat = fixtures.createChat();
      fixtures.createMessage({ chat_id: chat.id, sequence: 1, content: 'First' });

      const res = await service.findAll(chat.id, {
        limit: 50,
        offset: 0,
        sort: 'sequence',
      });
      expect(res.items).toHaveLength(1);
    });
  });

  describe('pagination boundaries and cursor navigation', () => {
    it('supports offset pagination: first page, last page, and offset past the end', async () => {
      const chat = fixtures.createChat();
      for (let i = 1; i <= 5; i += 1) {
        fixtures.createMessage({ chat_id: chat.id, sequence: i, content: `Message ${i}` });
      }

      // First page
      const page1 = await service.findAll(chat.id, { limit: 2, offset: 0 });
      expect(page1.items.map((m) => m.sequence)).toEqual([1, 2]);
      expect(page1.total).toBe(5);

      // Second page
      const page2 = await service.findAll(chat.id, { limit: 2, offset: 2 });
      expect(page2.items.map((m) => m.sequence)).toEqual([3, 4]);
      expect(page2.total).toBe(5);

      // Last page
      const page3 = await service.findAll(chat.id, { limit: 2, offset: 4 });
      expect(page3.items.map((m) => m.sequence)).toEqual([5]);
      expect(page3.total).toBe(5);

      // Offset past the end
      const pastEnd = await service.findAll(chat.id, { limit: 2, offset: 100 });
      expect(pastEnd.items).toEqual([]);
      expect(pastEnd.total).toBe(5);
    });

    it('pages through the entire conversation with cursor pagination (forward / after) without gaps or duplicates', async () => {
      const chat = fixtures.createChat();
      const totalMessages = 10;
      for (let i = 1; i <= totalMessages; i += 1) {
        fixtures.createMessage({ chat_id: chat.id, sequence: i, content: `Msg ${i}` });
      }

      const collectedMessages: number[] = [];
      let afterCursor: number | undefined = undefined;
      const pageSize = 3;

      while (true) {
        const res = await service.findAll(chat.id, {
          limit: pageSize,
          order: 'asc',
          after: afterCursor,
        });

        expect(res.total).toBe(totalMessages);

        if (res.items.length === 0) {
          break;
        }

        for (const item of res.items) {
          collectedMessages.push(item.sequence);
        }

        afterCursor = res.items[res.items.length - 1].sequence;
      }

      expect(collectedMessages).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('pages backwards through the entire conversation with cursor pagination (backward / before) without gaps or duplicates', async () => {
      const chat = fixtures.createChat();
      const totalMessages = 10;
      for (let i = 1; i <= totalMessages; i += 1) {
        fixtures.createMessage({ chat_id: chat.id, sequence: i, content: `Msg ${i}` });
      }

      const collectedMessages: number[] = [];
      let beforeCursor: number | undefined = undefined;
      const pageSize = 3;

      while (true) {
        const res = await service.findAll(chat.id, {
          limit: pageSize,
          order: 'desc',
          before: beforeCursor,
        });

        expect(res.total).toBe(totalMessages);

        if (res.items.length === 0) {
          break;
        }

        for (const item of res.items) {
          collectedMessages.push(item.sequence);
        }

        beforeCursor = res.items[res.items.length - 1].sequence;
      }

      expect(collectedMessages).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    });

    it('returns empty items when cursor is past the end', async () => {
      const chat = fixtures.createChat();
      fixtures.createMessage({ chat_id: chat.id, sequence: 1 });
      fixtures.createMessage({ chat_id: chat.id, sequence: 2 });

      const res = await service.findAll(chat.id, {
        limit: 10,
        after: 999,
      });

      expect(res.items).toEqual([]);
      expect(res.total).toBe(2);
    });
  });

  describe('filters (role, status, agentId)', () => {
    it('filters messages by role', async () => {
      const chat = fixtures.createChat();
      fixtures.createMessage({ chat_id: chat.id, sequence: 1, role: 'user', content: 'User Q' });
      fixtures.createMessage({ chat_id: chat.id, sequence: 2, role: 'assistant', content: 'Bot A' });
      fixtures.createMessage({ chat_id: chat.id, sequence: 3, role: 'system', content: 'Sys Prompt' });
      fixtures.createMessage({ chat_id: chat.id, sequence: 4, role: 'tool', content: 'Tool Result' });

      const userRes = await service.findAll(chat.id, { role: 'user' });
      expect(userRes.total).toBe(1);
      expect(userRes.items[0].content).toBe('User Q');

      const botRes = await service.findAll(chat.id, { role: 'assistant' });
      expect(botRes.total).toBe(1);
      expect(botRes.items[0].content).toBe('Bot A');

      const toolRes = await service.findAll(chat.id, { role: 'tool' });
      expect(toolRes.total).toBe(1);
      expect(toolRes.items[0].content).toBe('Tool Result');
    });

    it('filters messages by status and retains in-flight (pending, streaming) messages', async () => {
      const chat = fixtures.createChat();
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        status: 'complete',
        content: 'Finished answer',
      });
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 2,
        status: 'streaming',
        content: 'Partial ans...',
      });
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 3,
        status: 'pending',
        content: '',
      });
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 4,
        status: 'error',
        content: 'Model timeout',
      });

      // Assert all statuses returned in general query
      const allRes = await service.findAll(chat.id, {});
      expect(allRes.items.map((m) => m.status)).toEqual([
        'complete',
        'streaming',
        'pending',
        'error',
      ]);
      expect(allRes.items[1].content).toBe('Partial ans...');
      expect(allRes.items[2].content).toBe('');

      // Filter by streaming
      const streamingRes = await service.findAll(chat.id, { status: 'streaming' });
      expect(streamingRes.total).toBe(1);
      expect(streamingRes.items[0].status).toBe('streaming');
      expect(streamingRes.items[0].content).toBe('Partial ans...');

      // Filter by pending
      const pendingRes = await service.findAll(chat.id, { status: 'pending' });
      expect(pendingRes.total).toBe(1);
      expect(pendingRes.items[0].status).toBe('pending');
      expect(pendingRes.items[0].content).toBe('');
    });

    it('filters messages by agentId and handles deleted agent cascade to null', async () => {
      const agent1 = fixtures.createAgent({ name: 'Agent 1' });
      const agent2 = fixtures.createAgent({ name: 'Agent 2' });
      const chat = fixtures.createChat();

      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        agent_id: agent1.id,
        role: 'assistant',
        content: 'From Agent 1',
      });
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 2,
        agent_id: agent2.id,
        role: 'assistant',
        content: 'From Agent 2',
      });
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 3,
        agent_id: null,
        role: 'user',
        content: 'From User',
      });

      // Filter by agent1
      const resAgent1 = await service.findAll(chat.id, { agentId: agent1.id });
      expect(resAgent1.total).toBe(1);
      expect(resAgent1.items[0].content).toBe('From Agent 1');

      // Filter by agentId="null"
      const resNoAgent = await service.findAll(chat.id, { agentId: 'null' });
      expect(resNoAgent.total).toBe(1);
      expect(resNoAgent.items[0].content).toBe('From User');

      // Delete agent1 from SQLite; ON DELETE SET NULL cascades to messages
      db.run('DELETE FROM agents WHERE id = ?', [agent1.id]);

      // Message originally from agent1 now has agent_id null
      const resAfterDelete = await service.findAll(chat.id, {});
      const msg1 = resAfterDelete.items.find((m) => m.sequence === 1);
      expect(msg1?.agentId).toBeNull();

      // Now filter by agentId="null" matches two messages
      const resNullAfterDelete = await service.findAll(chat.id, { agentId: 'null' });
      expect(resNullAfterDelete.total).toBe(2);
    });

    it('supports combining filters: role, status, agentId, and cursor', async () => {
      const agent = fixtures.createAgent();
      const chat = fixtures.createChat();

      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        role: 'assistant',
        status: 'complete',
        agent_id: agent.id,
        content: 'Target 1',
      });
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 2,
        role: 'assistant',
        status: 'pending',
        agent_id: agent.id,
        content: 'In flight',
      });
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 3,
        role: 'assistant',
        status: 'complete',
        agent_id: agent.id,
        content: 'Target 2',
      });
      fixtures.createMessage({
        chat_id: chat.id,
        sequence: 4,
        role: 'user',
        status: 'complete',
        agent_id: null,
        content: 'User msg',
      });

      const res = await service.findAll(chat.id, {
        role: 'assistant',
        status: 'complete',
        agentId: agent.id,
        after: 1,
      });

      expect(res.total).toBe(2); // total complete assistant messages in chat is 2
      expect(res.items).toHaveLength(1);
      expect(res.items[0].content).toBe('Target 2');
      expect(res.items[0].sequence).toBe(3);
    });
  });

  describe('create', () => {
    it('assigns sequence = 1 to the first message in a chat', async () => {
      const chat = fixtures.createChat();

      const message = await service.create(chat.id, {
        content: 'Initial message',
      });

      expect(message.sequence).toBe(1);
      expect(message.chatId).toBe(chat.id);
      expect(message.role).toBe('user');
      expect(message.status).toBe('complete');
      expect(message.tokenCount).toBeNull();
      expect(message.agentId).toBeNull();
      expect(message.content).toBe('Initial message');
    });

    it('assigns sequential sequences (1, 2, 3) with no gaps', async () => {
      const chat = fixtures.createChat();

      const m1 = await service.create(chat.id, { content: 'Turn 1' });
      const m2 = await service.create(chat.id, { content: 'Turn 2' });
      const m3 = await service.create(chat.id, { content: 'Turn 3' });

      expect(m1.sequence).toBe(1);
      expect(m2.sequence).toBe(2);
      expect(m3.sequence).toBe(3);

      const list = await service.findAll(chat.id, {});
      expect(list.total).toBe(3);
      expect(list.items.map((m) => m.sequence)).toEqual([1, 2, 3]);
      expect(list.items.map((m) => m.content)).toEqual(['Turn 1', 'Turn 2', 'Turn 3']);
    });

    it('maintains independent sequence numbering for different chats', async () => {
      const chatA = fixtures.createChat({ title: 'Chat A' });
      const chatB = fixtures.createChat({ title: 'Chat B' });

      const a1 = await service.create(chatA.id, { content: 'A - 1' });
      const b1 = await service.create(chatB.id, { content: 'B - 1' });
      const a2 = await service.create(chatA.id, { content: 'A - 2' });
      const b2 = await service.create(chatB.id, { content: 'B - 2' });

      expect(a1.sequence).toBe(1);
      expect(a2.sequence).toBe(2);
      expect(b1.sequence).toBe(1);
      expect(b2.sequence).toBe(2);
    });

    it('persists explicit roles (assistant, system, tool)', async () => {
      const chat = fixtures.createChat();

      const systemMsg = await service.create(chat.id, {
        content: 'System prompt instructions',
        role: 'system',
      });
      const assistantMsg = await service.create(chat.id, {
        content: 'Assistant answer',
        role: 'assistant',
      });
      const toolMsg = await service.create(chat.id, {
        content: '{"result": 42}',
        role: 'tool',
      });

      expect(systemMsg.role).toBe('system');
      expect(assistantMsg.role).toBe('assistant');
      expect(toolMsg.role).toBe('tool');
    });

    it('stores and returns valid agentId when supplied', async () => {
      const agent = fixtures.createAgent({ name: 'Coder Agent' });
      const chat = fixtures.createChat();

      const message = await service.create(chat.id, {
        content: 'Hello from agent',
        role: 'assistant',
        agentId: agent.id,
      });

      expect(message.agentId).toBe(agent.id);

      const retrieved = await service.findAll(chat.id, {});
      expect(retrieved.items[0].agentId).toBe(agent.id);
    });

    it('throws 404 NotFoundException when chat does not exist', async () => {
      await expect(
        service.create('018f3a9e-0000-7000-8000-000000000099', {
          content: 'Hello',
        }),
      ).rejects.toThrow(NotFoundException);

      try {
        await service.create('018f3a9e-0000-7000-8000-000000000099', {
          content: 'Hello',
        });
      } catch (err: any) {
        expect(err.getResponse()).toEqual({
          code: 'CHAT_NOT_FOUND',
          message: 'Chat with ID "018f3a9e-0000-7000-8000-000000000099" not found',
        });
      }
    });

    it('throws 422 UnprocessableEntityException naming agentId field when agent does not exist', async () => {
      const chat = fixtures.createChat();
      const nonExistentAgentId = '018f3a9e-0000-7000-8000-000000000088';

      await expect(
        service.create(chat.id, {
          content: 'Message with bad agent',
          agentId: nonExistentAgentId,
        }),
      ).rejects.toThrow(UnprocessableEntityException);

      try {
        await service.create(chat.id, {
          content: 'Message with bad agent',
          agentId: nonExistentAgentId,
        });
      } catch (err: any) {
        expect(err.getResponse()).toEqual({
          code: 'AGENT_NOT_FOUND',
          message: `Referenced agentId "${nonExistentAgentId}" does not exist`,
        });
      }
    });

    it("advances the parent chat's updated_at timestamp in SQLite in the same transaction", async () => {
      const chat = fixtures.createChat({
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      });

      const futureNow = '2026-10-18T12:00:00.000Z';
      await service.create(
        chat.id,
        { content: 'Advancing time' },
        { now: futureNow },
      );

      const updatedChat = db.get<{ updated_at: string }>(
        'SELECT updated_at FROM chats WHERE id = ?',
        [chat.id],
      );

      expect(updatedChat?.updated_at).toBe(futureNow);
    });

    it('defensively permits posting to a chat whose owning agent was deleted', async () => {
      const agent = fixtures.createAgent();
      const chat = fixtures.createChat({ agent_id: agent.id });

      // Simulate orphaned chat row where agent was deleted and foreign key set to NULL
      db.exec('PRAGMA ignore_check_constraints = ON');
      db.run('UPDATE chats SET agent_id = NULL WHERE id = ?', [chat.id]);
      db.exec('PRAGMA ignore_check_constraints = OFF');

      const msg = await service.create(chat.id, {
        content: 'Appending to orphaned chat',
      });

      expect(msg.sequence).toBe(1);
      expect(msg.content).toBe('Appending to orphaned chat');
    });

    it('atomically assigns dense, distinct sequences under concurrent insertions without gaps', async () => {
      const chat = fixtures.createChat();
      const messageCount = 15;

      const results = await Promise.all(
        Array.from({ length: messageCount }, (_, i) =>
          service.create(chat.id, {
            content: `Concurrent turn #${i + 1}`,
          }),
        ),
      );

      expect(results).toHaveLength(messageCount);

      const assignedSequences = results.map((m) => m.sequence).sort((a, b) => a - b);
      const expectedSequences = Array.from({ length: messageCount }, (_, i) => i + 1);

      expect(assignedSequences).toEqual(expectedSequences);

      // Verify directly in DB
      const list = await service.findAll(chat.id, { limit: 100 });
      expect(list.total).toBe(messageCount);
      expect(list.items.map((m) => m.sequence)).toEqual(expectedSequences);
    });

    it('throws 409 ConflictException when sequence assignment retries are exhausted', async () => {
      const chat = fixtures.createChat();

      vi.spyOn(db, 'transaction').mockImplementation(() => {
        const error: any = new Error(
          'UNIQUE constraint failed: messages.chat_id, messages.sequence',
        );
        error.code = 'SQLITE_CONSTRAINT_UNIQUE';
        throw error;
      });

      await expect(
        service.create(chat.id, { content: 'Will fail due to exhausted retries' }),
      ).rejects.toThrow(ConflictException);

      vi.restoreAllMocks();
    });
  });
});
