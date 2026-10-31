import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_MESSAGE_CONTENT_LENGTH } from '../src/modules/chats/messages/dto/create-message.dto.js';
import { createTestApp, type TestApp } from './harness/index.js';

describe('Chat Messages Endpoints (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(() => {
    testApp.reset();
  });

  describe('GET /api/v1/chats/:chatId/messages', () => {
    it('returns 404 when the chat does not exist', async () => {
      const res = await testApp
        .request()
        .get('/api/v1/chats/018f3a9e-0000-7000-8000-000000000099/messages')
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('CHAT_NOT_FOUND');
      expect(res.body.message).toContain('not found');
    });

    it('returns 200 with an empty collection when the chat has no messages', async () => {
      const chat = testApp.fixtures.createChat({ title: 'Empty Chat' });

      const res = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages`)
        .expect(200);

      expect(res.body).toEqual({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      });
    });

    it("returns only that chat's messages and no others (isolation between chats)", async () => {
      const chatA = testApp.fixtures.createChat({ title: 'Chat A' });
      const chatB = testApp.fixtures.createChat({ title: 'Chat B' });

      testApp.fixtures.createMessage({
        chat_id: chatA.id,
        sequence: 1,
        content: 'Chat A Turn 1',
      });
      testApp.fixtures.createMessage({
        chat_id: chatA.id,
        sequence: 2,
        content: 'Chat A Turn 2',
      });

      testApp.fixtures.createMessage({
        chat_id: chatB.id,
        sequence: 1,
        content: 'Chat B Turn 1',
      });

      const resA = await testApp
        .request()
        .get(`/api/v1/chats/${chatA.id}/messages`)
        .expect(200);

      expect(resA.body.total).toBe(2);
      expect(resA.body.items).toHaveLength(2);
      expect(resA.body.items.map((m: any) => m.content)).toEqual([
        'Chat A Turn 1',
        'Chat A Turn 2',
      ]);
      expect(resA.body.items.every((m: any) => m.chatId === chatA.id)).toBe(true);

      const resB = await testApp
        .request()
        .get(`/api/v1/chats/${chatB.id}/messages`)
        .expect(200);

      expect(resB.body.total).toBe(1);
      expect(resB.body.items[0].content).toBe('Chat B Turn 1');
      expect(resB.body.items[0].chatId).toBe(chatB.id);
    });

    it('orders messages by sequence ascending by default and supports reversing with order=desc', async () => {
      const chat = testApp.fixtures.createChat();

      testApp.fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        content: 'First turn',
      });
      testApp.fixtures.createMessage({
        chat_id: chat.id,
        sequence: 2,
        content: 'Second turn',
      });
      testApp.fixtures.createMessage({
        chat_id: chat.id,
        sequence: 3,
        content: 'Third turn',
      });

      // Ascending (default)
      const resAsc = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages`)
        .expect(200);

      expect(resAsc.body.items.map((m: any) => m.sequence)).toEqual([1, 2, 3]);

      // Descending (reversing order)
      const resDesc = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?order=desc`)
        .expect(200);

      expect(resDesc.body.items.map((m: any) => m.sequence)).toEqual([3, 2, 1]);
    });

    it('enforces maximum page size (limit <= 100) and bounds', async () => {
      const chat = testApp.fixtures.createChat();

      // limit = 100 is valid
      await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?limit=100`)
        .expect(200);

      // limit = 101 exceeds max
      const resTooHigh = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?limit=101`)
        .expect(400);

      expect(resTooHigh.body.details).toContain('limit must not exceed 100');

      // limit = 0 is below min
      const resZero = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?limit=0`)
        .expect(400);

      expect(resZero.body.details).toContain('limit must be at least 1');

      // offset < 0
      const resNegOffset = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?offset=-1`)
        .expect(400);

      expect(resNegOffset.body.details).toContain('offset must be at least 0');
    });

    it('supports offset pagination across boundaries', async () => {
      const chat = testApp.fixtures.createChat();
      for (let i = 1; i <= 5; i += 1) {
        testApp.fixtures.createMessage({
          chat_id: chat.id,
          sequence: i,
          content: `Msg ${i}`,
        });
      }

      // First page
      const page1 = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?limit=2&offset=0`)
        .expect(200);
      expect(page1.body.items.map((m: any) => m.sequence)).toEqual([1, 2]);
      expect(page1.body.total).toBe(5);

      // Last page
      const lastPage = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?limit=2&offset=4`)
        .expect(200);
      expect(lastPage.body.items.map((m: any) => m.sequence)).toEqual([5]);
      expect(lastPage.body.total).toBe(5);

      // Offset past the end
      const pastEnd = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?limit=2&offset=50`)
        .expect(200);
      expect(pastEnd.body.items).toEqual([]);
      expect(pastEnd.body.total).toBe(5);
    });

    it('supports sequence cursor pagination: forward (after) through entire conversation with no gaps or duplicates', async () => {
      const chat = testApp.fixtures.createChat();
      const totalMessages = 8;
      for (let i = 1; i <= totalMessages; i += 1) {
        testApp.fixtures.createMessage({
          chat_id: chat.id,
          sequence: i,
          content: `Turn ${i}`,
        });
      }

      const collected: number[] = [];
      let afterCursor: number | undefined = undefined;

      while (true) {
        const query = afterCursor !== undefined ? `&after=${afterCursor}` : '';
        const res = await testApp
          .request()
          .get(`/api/v1/chats/${chat.id}/messages?limit=3${query}`)
          .expect(200);

        expect(res.body.total).toBe(totalMessages);

        if (res.body.items.length === 0) {
          break;
        }

        for (const item of res.body.items) {
          collected.push(item.sequence);
        }

        afterCursor = res.body.items[res.body.items.length - 1].sequence;
      }

      expect(collected).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('supports sequence cursor pagination: backward (before) with order=desc through entire conversation', async () => {
      const chat = testApp.fixtures.createChat();
      const totalMessages = 8;
      for (let i = 1; i <= totalMessages; i += 1) {
        testApp.fixtures.createMessage({
          chat_id: chat.id,
          sequence: i,
          content: `Turn ${i}`,
        });
      }

      const collected: number[] = [];
      let beforeCursor: number | undefined = undefined;

      while (true) {
        const query = beforeCursor !== undefined ? `&before=${beforeCursor}` : '';
        const res = await testApp
          .request()
          .get(`/api/v1/chats/${chat.id}/messages?limit=3&order=desc${query}`)
          .expect(200);

        expect(res.body.total).toBe(totalMessages);

        if (res.body.items.length === 0) {
          break;
        }

        for (const item of res.body.items) {
          collected.push(item.sequence);
        }

        beforeCursor = res.body.items[res.body.items.length - 1].sequence;
      }

      expect(collected).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    });

    it('rejects invalid cursor parameters with 400 Bad Request', async () => {
      const chat = testApp.fixtures.createChat();

      const resBeforeZero = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?before=0`)
        .expect(400);
      expect(resBeforeZero.body.details).toContain('before must be at least 1');

      const resAfterNeg = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?after=-1`)
        .expect(400);
      expect(resAfterNeg.body.details).toContain('after must be at least 0');

      const resNonInt = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?before=abc`)
        .expect(400);
      expect(resNonInt.body.details).toContain('before must be an integer');
    });

    it('rejects invalid sort column with 400 Bad Request', async () => {
      const chat = testApp.fixtures.createChat();

      const res = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?sort=created_at`)
        .expect(400);

      expect(res.body.message).toContain('Allowed sort fields: sequence');
    });

    it('filters messages by role, status, and agentId', async () => {
      const agent1 = testApp.fixtures.createAgent({ name: 'Agent 1' });
      const agent2 = testApp.fixtures.createAgent({ name: 'Agent 2' });
      const chat = testApp.fixtures.createChat();

      testApp.fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        role: 'user',
        status: 'complete',
        agent_id: null,
        content: 'User prompt',
      });
      testApp.fixtures.createMessage({
        chat_id: chat.id,
        sequence: 2,
        role: 'assistant',
        status: 'complete',
        agent_id: agent1.id,
        content: 'Agent 1 response',
      });
      testApp.fixtures.createMessage({
        chat_id: chat.id,
        sequence: 3,
        role: 'assistant',
        status: 'streaming',
        agent_id: agent2.id,
        content: 'Agent 2 partial...',
      });
      testApp.fixtures.createMessage({
        chat_id: chat.id,
        sequence: 4,
        role: 'assistant',
        status: 'pending',
        agent_id: agent1.id,
        content: '',
      });

      // Filter role=user
      const resRole = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?role=user`)
        .expect(200);
      expect(resRole.body.total).toBe(1);
      expect(resRole.body.items[0].content).toBe('User prompt');

      // Filter status=streaming returns in-flight streaming message
      const resStreaming = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?status=streaming`)
        .expect(200);
      expect(resStreaming.body.total).toBe(1);
      expect(resStreaming.body.items[0].content).toBe('Agent 2 partial...');
      expect(resStreaming.body.items[0].status).toBe('streaming');

      // Filter status=pending returns in-flight pending message
      const resPending = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?status=pending`)
        .expect(200);
      expect(resPending.body.total).toBe(1);
      expect(resPending.body.items[0].status).toBe('pending');
      expect(resPending.body.items[0].content).toBe('');

      // Filter agentId
      const resAgent = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?agentId=${agent1.id}`)
        .expect(200);
      expect(resAgent.body.total).toBe(2);

      // Filter agentId=null
      const resNoAgent = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?agentId=null`)
        .expect(200);
      expect(resNoAgent.body.total).toBe(1);
      expect(resNoAgent.body.items[0].content).toBe('User prompt');

      // Combined filters: role=assistant & status=complete & agentId
      const resCombined = await testApp
        .request()
        .get(
          `/api/v1/chats/${chat.id}/messages?role=assistant&status=complete&agentId=${agent1.id}`,
        )
        .expect(200);
      expect(resCombined.body.total).toBe(1);
      expect(resCombined.body.items[0].content).toBe('Agent 1 response');
    });

    it('rejects invalid filter values with 400 Bad Request', async () => {
      const chat = testApp.fixtures.createChat();

      const resBadRole = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?role=admin`)
        .expect(400);
      expect(resBadRole.body.details).toContain(
        'role must be one of user, assistant, system, tool',
      );

      const resBadStatus = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?status=aborted`)
        .expect(400);
      expect(resBadStatus.body.details).toContain(
        'status must be one of pending, streaming, complete, error',
      );
    });

    it('returns a message whose agent was deleted with a null agentId', async () => {
      const agent = testApp.fixtures.createAgent({ name: 'Temporary Agent' });
      const chat = testApp.fixtures.createChat();

      testApp.fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        agent_id: agent.id,
        role: 'assistant',
        content: 'Response before agent deletion',
      });

      // Delete agent via API or DB
      await testApp.request().delete(`/api/v1/agents/${agent.id}`).expect(204);

      // Query chat messages
      const res = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].agentId).toBeNull();
      expect(res.body.items[0].content).toBe('Response before agent deletion');
    });
  });

  describe('POST /api/v1/chats/:chatId/messages', () => {
    it('creates a message and returns 201 with sequence 1 for the first message', async () => {
      const chat = testApp.fixtures.createChat();

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/messages`)
        .send({ content: 'Hello world' })
        .expect(201);

      expect(res.body).toMatchObject({
        chatId: chat.id,
        sequence: 1,
        role: 'user',
        agentId: null,
        content: 'Hello world',
        status: 'complete',
        tokenCount: null,
      });
      expect(typeof res.body.id).toBe('string');
      expect(typeof res.body.createdAt).toBe('string');
    });

    it('assigns sequential sequences (1, 2, 3) on subsequent posts and advances chat updated_at', async () => {
      const chat = testApp.fixtures.createChat({
        updated_at: '2026-01-01T00:00:00.000Z',
      });

      const res1 = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/messages`)
        .send({ content: 'Turn 1' })
        .expect(201);

      const res2 = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/messages`)
        .send({ content: 'Turn 2' })
        .expect(201);

      const res3 = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/messages`)
        .send({ content: 'Turn 3' })
        .expect(201);

      expect(res1.body.sequence).toBe(1);
      expect(res2.body.sequence).toBe(2);
      expect(res3.body.sequence).toBe(3);

      // Verify chat updated_at advanced beyond original timestamp
      const chatRow = testApp.db.get<{ updated_at: string }>(
        'SELECT updated_at FROM chats WHERE id = ?',
        [chat.id],
      );
      expect(chatRow?.updated_at).toBe(res3.body.createdAt);
      expect(chatRow?.updated_at).not.toBe('2026-01-01T00:00:00.000Z');
    });

    it('maintains independent sequence numbering for different chats', async () => {
      const chatA = testApp.fixtures.createChat({ title: 'Chat A' });
      const chatB = testApp.fixtures.createChat({ title: 'Chat B' });

      const resA1 = await testApp
        .request()
        .post(`/api/v1/chats/${chatA.id}/messages`)
        .send({ content: 'A1' })
        .expect(201);

      const resB1 = await testApp
        .request()
        .post(`/api/v1/chats/${chatB.id}/messages`)
        .send({ content: 'B1' })
        .expect(201);

      const resA2 = await testApp
        .request()
        .post(`/api/v1/chats/${chatA.id}/messages`)
        .send({ content: 'A2' })
        .expect(201);

      expect(resA1.body.sequence).toBe(1);
      expect(resB1.body.sequence).toBe(1);
      expect(resA2.body.sequence).toBe(2);
    });

    it('returns 404 when the chat does not exist', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/chats/018f3a9e-0000-7000-8000-000000000099/messages')
        .send({ content: 'Lost in the void' })
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('CHAT_NOT_FOUND');
      expect(res.body.message).toContain('not found');
    });

    it('returns 422 when referenced agentId does not exist naming the field', async () => {
      const chat = testApp.fixtures.createChat();
      const nonExistentAgentId = '018f3a9e-0000-7000-8000-000000000088';

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/messages`)
        .send({ content: 'Agent turn', agentId: nonExistentAgentId })
        .expect(422);

      expect(res.body.statusCode).toBe(422);
      expect(res.body.code).toBe('AGENT_NOT_FOUND');
      expect(res.body.message).toContain('agentId');
    });

    it('accepts valid agentId and explicit roles', async () => {
      const agent = testApp.fixtures.createAgent({ name: 'Assistant Agent' });
      const chat = testApp.fixtures.createChat();

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/messages`)
        .send({
          content: 'I can assist you!',
          role: 'assistant',
          agentId: agent.id,
        })
        .expect(201);

      expect(res.body.agentId).toBe(agent.id);
      expect(res.body.role).toBe('assistant');
      expect(res.body.sequence).toBe(1);
    });

    it('rejects invalid role with 400 Bad Request', async () => {
      const chat = testApp.fixtures.createChat();

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/messages`)
        .send({ content: 'Invalid role message', role: 'root' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body)).toContain('role');
    });

    it('rejects missing content with 400 Bad Request', async () => {
      const chat = testApp.fixtures.createChat();

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/messages`)
        .send({})
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body)).toContain('content');
    });

    it('rejects content longer than 100000 characters with 400', async () => {
      const chat = testApp.fixtures.createChat();

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/messages`)
        .send({ content: 'a'.repeat(MAX_MESSAGE_CONTENT_LENGTH + 1) })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain(
        `content must not exceed ${MAX_MESSAGE_CONTENT_LENGTH} characters`,
      );
    });

    it('accepts a non-ASCII content string of exactly 100000 characters', async () => {
      const chat = testApp.fixtures.createChat();
      const content = '記'.repeat(MAX_MESSAGE_CONTENT_LENGTH);

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/messages`)
        .send({ content })
        .expect(201);

      expect(res.body.content).toBe(content);
    });

    it('rejects client-supplied server-managed fields with 400 Bad Request', async () => {
      const chat = testApp.fixtures.createChat();

      const forbiddenPayloads = [
        { id: '018f3a9e-0000-7000-8000-000000000001' },
        { sequence: 10 },
        { status: 'complete' },
        { tokenCount: 100 },
        { token_count: 100 },
        { createdAt: '2026-10-18T00:00:00.000Z' },
        { created_at: '2026-10-18T00:00:00.000Z' },
      ];

      for (const payload of forbiddenPayloads) {
        const res = await testApp
          .request()
          .post(`/api/v1/chats/${chat.id}/messages`)
          .send({ content: 'Valid message', ...payload })
          .expect(400);

        expect(res.body.statusCode).toBe(400);
      }
    });

    it('defensively permits posting to a chat whose owning agent was deleted', async () => {
      const agent = testApp.fixtures.createAgent();
      const chat = testApp.fixtures.createChat({ agent_id: agent.id });

      testApp.db.exec('PRAGMA ignore_check_constraints = ON');
      testApp.db.run('UPDATE chats SET agent_id = NULL WHERE id = ?', [chat.id]);
      testApp.db.exec('PRAGMA ignore_check_constraints = OFF');

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/messages`)
        .send({ content: 'Message in orphaned chat' })
        .expect(201);

      expect(res.body.sequence).toBe(1);
      expect(res.body.content).toBe('Message in orphaned chat');
    });

    it('allows posted messages to be retrieved via the GET list endpoint in the correct order', async () => {
      const chat = testApp.fixtures.createChat();

      await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/messages`)
        .send({ content: 'Step 1', role: 'user' })
        .expect(201);

      await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/messages`)
        .send({ content: 'Step 2', role: 'assistant' })
        .expect(201);

      const listRes = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages`)
        .expect(200);

      expect(listRes.body.total).toBe(2);
      expect(listRes.body.items).toHaveLength(2);
      expect(listRes.body.items[0]).toMatchObject({
        sequence: 1,
        content: 'Step 1',
        role: 'user',
      });
      expect(listRes.body.items[1]).toMatchObject({
        sequence: 2,
        content: 'Step 2',
        role: 'assistant',
      });
    });

    it('handles concurrent POST requests to the same chat atomically without gaps or lost messages', async () => {
      const chat = testApp.fixtures.createChat();
      const count = 12;

      const requests = Array.from({ length: count }, (_, i) =>
        testApp
          .request()
          .post(`/api/v1/chats/${chat.id}/messages`)
          .send({ content: `Concurrent e2e post #${i + 1}` }),
      );

      const responses = await Promise.all(requests);

      for (const res of responses) {
        expect(res.status).toBe(201);
      }

      const assignedSequences = responses
        .map((r) => r.body.sequence)
        .sort((a, b) => a - b);
      const expectedSequences = Array.from({ length: count }, (_, i) => i + 1);

      expect(assignedSequences).toEqual(expectedSequences);

      const listRes = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?limit=50`)
        .expect(200);

      expect(listRes.body.total).toBe(count);
      expect(listRes.body.items.map((m: any) => m.sequence)).toEqual(expectedSequences);
    });
  });
});
