import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from './harness/index.js';
import {
  BOTH_OWNERS_ERROR_MESSAGE,
  CONTEXT_SUMMARY_READONLY_ERROR_MESSAGE,
  NEITHER_OWNER_ERROR_MESSAGE,
  OWNER_IMMUTABLE_ERROR_MESSAGE,
} from '../src/modules/chats/dto/chat-validators.js';
import { MessagesService } from '../src/modules/chats/messages/messages.service.js';
import { InferenceService } from '../src/modules/inference/inference.service.js';
import { ProvidersService } from '../src/modules/providers/providers.service.js';
import { AdapterFactoryService } from '../src/model-adapters/adapter-factory/adapter-factory.service.js';

describe('Chats endpoints (e2e)', () => {
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

  function createAgent(name: string = 'Researcher') {
    return testApp.fixtures.createAgent({ name });
  }

  function createTeam(name: string = 'Engineering') {
    return testApp.fixtures.createTeam({ name });
  }

  function createProject(name: string = 'Main Project') {
    return testApp.fixtures.createProject({ name });
  }

  async function createChat(body: Record<string, unknown>) {
    const response = await testApp
      .request()
      .post('/api/v1/chats')
      .send(body)
      .expect(201);
    return response.body;
  }

  it('asserts foreign-key enforcement is enabled (PRAGMA foreign_keys = ON) as the suite first test', () => {
    const row = testApp.db.get<{ foreign_keys: number }>(
      'PRAGMA foreign_keys',
    );
    expect(row?.foreign_keys).toBe(1);
  });

  describe('Lifecycle and Owner Rule', () => {
    it('covers complete chat lifecycle with identical representation across create, list and get', async () => {
      const agent = createAgent('Lifecycle Agent');
      const createRes = await testApp
        .request()
        .post('/api/v1/chats')
        .send({ agentId: agent.id, title: 'Lifecycle Chat' })
        .expect(201);

      const created = createRes.body;
      expect(createRes.headers.location).toBe(`/api/v1/chats/${created.id}`);
      expect(created).toEqual({
        id: expect.any(String),
        title: 'Lifecycle Chat',
        agentId: agent.id,
        teamId: null,
        projectId: null,
        contextSummary: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      // 1. Retrieve by ID and assert identical representation
      const getRes = await testApp
        .request()
        .get(`/api/v1/chats/${created.id}`)
        .expect(200);
      expect(getRes.body).toEqual(created);

      // 2. List chats and assert consistent representation in items
      const listRes = await testApp
        .request()
        .get(`/api/v1/chats?agentId=${agent.id}`)
        .expect(200);
      expect(listRes.body.total).toBe(1);
      expect(listRes.body.items[0]).toEqual(created);

      // 3. Update title via PATCH
      const patchRes = await testApp
        .request()
        .patch(`/api/v1/chats/${created.id}`)
        .send({ title: 'Updated Lifecycle Chat' })
        .expect(200);
      expect(patchRes.body.id).toBe(created.id);
      expect(patchRes.body.title).toBe('Updated Lifecycle Chat');
      expect(patchRes.body.agentId).toBe(agent.id);
      expect(patchRes.body.createdAt).toBe(created.createdAt);
      expect(new Date(patchRes.body.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(created.updatedAt).getTime(),
      );

      // 4. Retrieve by ID after update
      const updatedGetRes = await testApp
        .request()
        .get(`/api/v1/chats/${created.id}`)
        .expect(200);
      expect(updatedGetRes.body).toEqual(patchRes.body);

      // 5. Delete chat
      await testApp
        .request()
        .delete(`/api/v1/chats/${created.id}`)
        .expect(204);

      // 6. Confirm removal via GET and List
      await testApp
        .request()
        .get(`/api/v1/chats/${created.id}`)
        .expect(404);

      const emptyListRes = await testApp
        .request()
        .get(`/api/v1/chats?agentId=${agent.id}`)
        .expect(200);
      expect(emptyListRes.body.total).toBe(0);
      expect(emptyListRes.body.items).toEqual([]);
    });

    it('creates an agent-owned chat and sets Location header', async () => {
      const agent = createAgent();
      const response = await testApp
        .request()
        .post('/api/v1/chats')
        .send({ agentId: agent.id, title: 'Agent Chat' })
        .expect(201);

      expect(response.body).toMatchObject({
        id: expect.any(String),
        title: 'Agent Chat',
        agentId: agent.id,
        teamId: null,
        projectId: null,
        contextSummary: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      expect(response.headers.location).toBe(`/api/v1/chats/${response.body.id}`);
    });

    it('creates a team-owned chat with project', async () => {
      const team = createTeam();
      const project = createProject();

      const response = await testApp
        .request()
        .post('/api/v1/chats')
        .send({
          teamId: team.id,
          projectId: project.id,
          title: 'Team Project Chat',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        title: 'Team Project Chat',
        teamId: team.id,
        agentId: null,
        projectId: project.id,
      });
    });

    it('rejects create with both owners set and writes no row', async () => {
      const agent = createAgent();
      const team = createTeam();

      const response = await testApp
        .request()
        .post('/api/v1/chats')
        .send({ agentId: agent.id, teamId: team.id, title: 'Both Owners' })
        .expect(400);

      const errorText = JSON.stringify(response.body);
      expect(errorText).toContain(BOTH_OWNERS_ERROR_MESSAGE);

      const rows = testApp.db.all('SELECT * FROM chats');
      expect(rows).toHaveLength(0);
    });

    it('rejects create with neither owner set and writes no row', async () => {
      const response = await testApp
        .request()
        .post('/api/v1/chats')
        .send({ title: 'No Owner' })
        .expect(400);

      const errorText = JSON.stringify(response.body);
      expect(errorText).toContain(NEITHER_OWNER_ERROR_MESSAGE);

      const rows = testApp.db.all('SELECT * FROM chats');
      expect(rows).toHaveLength(0);

      // Explicit nulls for both owners must also reject with 400 and write no row
      const nullResponse = await testApp
        .request()
        .post('/api/v1/chats')
        .send({ agentId: null, teamId: null, title: 'Explicit Nulls' })
        .expect(400);
      expect(JSON.stringify(nullResponse.body)).toContain(NEITHER_OWNER_ERROR_MESSAGE);
      expect(testApp.db.all('SELECT * FROM chats')).toHaveLength(0);
    });

    it('rejects create with non-existent agentId, teamId, or projectId naming the field', async () => {
      const missingId = '018f3a9e-0000-7000-8000-000000999999';

      const agentRes = await testApp
        .request()
        .post('/api/v1/chats')
        .send({ agentId: missingId })
        .expect(422);
      expect(agentRes.body.message).toContain('agentId');

      const teamRes = await testApp
        .request()
        .post('/api/v1/chats')
        .send({ teamId: missingId })
        .expect(422);
      expect(teamRes.body.message).toContain('teamId');

      const agent = createAgent();
      const projectRes = await testApp
        .request()
        .post('/api/v1/chats')
        .send({ agentId: agent.id, projectId: missingId })
        .expect(422);
      expect(projectRes.body.message).toContain('projectId');
    });

    it('rejects context_summary during create', async () => {
      const agent = createAgent();

      const res1 = await testApp
        .request()
        .post('/api/v1/chats')
        .send({ agentId: agent.id, contextSummary: 'Manual compaction' })
        .expect(400);
      expect(JSON.stringify(res1.body)).toContain(
        CONTEXT_SUMMARY_READONLY_ERROR_MESSAGE,
      );

      const res2 = await testApp
        .request()
        .post('/api/v1/chats')
        .send({ agentId: agent.id, context_summary: 'Manual compaction' })
        .expect(400);
      expect(JSON.stringify(res2.body)).toContain(
        CONTEXT_SUMMARY_READONLY_ERROR_MESSAGE,
      );
    });

    it('returns context_summary in responses when populated in database', async () => {
      const agent = createAgent();
      const chat = await createChat({ agentId: agent.id, title: 'Chat With Summary' });

      // Simulate compaction written by background process
      testApp.db.run(
        'UPDATE chats SET context_summary = ? WHERE id = ?',
        ['Compacted conversation summary of previous 20 turns', chat.id],
      );

      // Assert GET by ID returns contextSummary
      const getRes = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}`)
        .expect(200);
      expect(getRes.body.contextSummary).toBe(
        'Compacted conversation summary of previous 20 turns',
      );

      // Assert GET collection returns contextSummary
      const listRes = await testApp
        .request()
        .get(`/api/v1/chats?agentId=${agent.id}`)
        .expect(200);
      expect(listRes.body.items[0].contextSummary).toBe(
        'Compacted conversation summary of previous 20 turns',
      );
    });
  });

  describe('Retrieval and Updates', () => {
    it('retrieves an existing chat by ID with 200', async () => {
      const agent = createAgent();
      const created = await createChat({ agentId: agent.id, title: 'Chat 1' });

      const res = await testApp
        .request()
        .get(`/api/v1/chats/${created.id}`)
        .expect(200);

      expect(res.body).toEqual(created);
    });

    it('returns 404 for unknown chatId on GET, PATCH, and DELETE', async () => {
      const missingChatId = '018f3a9e-0000-7000-8000-111111111111';

      await testApp.request().get(`/api/v1/chats/${missingChatId}`).expect(404);
      await testApp
        .request()
        .patch(`/api/v1/chats/${missingChatId}`)
        .send({ title: 'New' })
        .expect(404);
      await testApp.request().delete(`/api/v1/chats/${missingChatId}`).expect(404);
    });

    it('updates title and moves between projects via PATCH', async () => {
      const agent = createAgent();
      const p1 = createProject('P1');
      const p2 = createProject('P2');
      const created = await createChat({
        agentId: agent.id,
        projectId: p1.id,
        title: 'Original Title',
      });

      const updated = await testApp
        .request()
        .patch(`/api/v1/chats/${created.id}`)
        .send({ title: 'Modified Title', projectId: p2.id })
        .expect(200);

      expect(updated.body.title).toBe('Modified Title');
      expect(updated.body.projectId).toBe(p2.id);

      // Clear project by passing null
      const detached = await testApp
        .request()
        .patch(`/api/v1/chats/${created.id}`)
        .send({ projectId: null })
        .expect(200);
      expect(detached.body.projectId).toBeNull();
    });

    it('rejects owner changes via PATCH with explanatory message', async () => {
      const agent1 = createAgent('A1');
      const agent2 = createAgent('A2');
      const team = createTeam();
      const created = await createChat({ agentId: agent1.id });

      const patchAgent = await testApp
        .request()
        .patch(`/api/v1/chats/${created.id}`)
        .send({ agentId: agent2.id })
        .expect(400);
      expect(JSON.stringify(patchAgent.body)).toContain(
        OWNER_IMMUTABLE_ERROR_MESSAGE,
      );

      const patchTeam = await testApp
        .request()
        .patch(`/api/v1/chats/${created.id}`)
        .send({ teamId: team.id })
        .expect(400);
      expect(JSON.stringify(patchTeam.body)).toContain(
        OWNER_IMMUTABLE_ERROR_MESSAGE,
      );
    });

    it('rejects context_summary during update via PATCH', async () => {
      const agent = createAgent();
      const created = await createChat({ agentId: agent.id });

      const res = await testApp
        .request()
        .patch(`/api/v1/chats/${created.id}`)
        .send({ contextSummary: 'Manual compaction' })
        .expect(400);
      expect(JSON.stringify(res.body)).toContain(
        CONTEXT_SUMMARY_READONLY_ERROR_MESSAGE,
      );
    });
  });

  describe('Collection filtering and pagination', () => {
    it('filters by projectId, agentId, and teamId individually and combined', async () => {
      const p1 = createProject('P1');
      const p2 = createProject('P2');
      const a1 = createAgent('A1');
      const a2 = createAgent('A2');
      const t1 = createTeam('T1');

      await createChat({ agentId: a1.id, projectId: p1.id, title: 'Chat-A1-P1' });
      await createChat({ agentId: a1.id, projectId: p2.id, title: 'Chat-A1-P2' });
      await createChat({ agentId: a2.id, projectId: p1.id, title: 'Chat-A2-P1' });
      await createChat({ teamId: t1.id, projectId: p1.id, title: 'Chat-T1-P1' });

      // Filter by agentId
      const resA1 = await testApp
        .request()
        .get(`/api/v1/chats?agentId=${a1.id}`)
        .expect(200);
      expect(resA1.body.total).toBe(2);

      // Filter by teamId
      const resT1 = await testApp
        .request()
        .get(`/api/v1/chats?teamId=${t1.id}`)
        .expect(200);
      expect(resT1.body.total).toBe(1);
      expect(resT1.body.items[0].title).toBe('Chat-T1-P1');

      // Filter by projectId
      const resP1 = await testApp
        .request()
        .get(`/api/v1/chats?projectId=${p1.id}`)
        .expect(200);
      expect(resP1.body.total).toBe(3);

      // Combined filter
      const resCombined = await testApp
        .request()
        .get(`/api/v1/chats?projectId=${p1.id}&agentId=${a1.id}`)
        .expect(200);
      expect(resCombined.body.total).toBe(1);
      expect(resCombined.body.items[0].title).toBe('Chat-A1-P1');
    });

    it('paginates and sorts chats correctly', async () => {
      const agent = createAgent();
      await createChat({ agentId: agent.id, title: 'B Chat' });
      await createChat({ agentId: agent.id, title: 'A Chat' });
      await createChat({ agentId: agent.id, title: 'C Chat' });

      const sorted = await testApp
        .request()
        .get('/api/v1/chats?sort=title&order=asc&limit=2&offset=0')
        .expect(200);

      expect(sorted.body.total).toBe(3);
      expect(sorted.body.items).toHaveLength(2);
      expect(sorted.body.items[0].title).toBe('A Chat');
      expect(sorted.body.items[1].title).toBe('B Chat');

      const page2 = await testApp
        .request()
        .get('/api/v1/chats?sort=title&order=asc&limit=2&offset=2')
        .expect(200);
      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.items[0].title).toBe('C Chat');
    });

    it('searches by title substring, ignoring ASCII case', async () => {
      const agent = createAgent();
      await createChat({ agentId: agent.id, title: 'Release plan for Q3' });
      await createChat({ agentId: agent.id, title: 'Weekly sync' });
      await createChat({ agentId: agent.id });

      const res = await testApp
        .request()
        .get('/api/v1/chats?search=RELEASE')
        .expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].title).toBe('Release plan for Q3');

      const blank = await testApp
        .request()
        .get('/api/v1/chats?search=%20%20')
        .expect(200);
      expect(blank.body.total).toBe(3);
    });

    it('matches non-ASCII titles case-sensitively, like the other search endpoints', async () => {
      const agent = createAgent();
      await createChat({ agentId: agent.id, title: 'Über die Brücke' });

      const exact = await testApp
        .request()
        .get(`/api/v1/chats?search=${encodeURIComponent('Brücke')}`)
        .expect(200);
      expect(exact.body.total).toBe(1);

      // SQLite's LIKE only folds ASCII: "über" does not match "Über".
      const folded = await testApp
        .request()
        .get(`/api/v1/chats?search=${encodeURIComponent('über')}`)
        .expect(200);
      expect(folded.body.total).toBe(0);
    });

    it('treats % and _ in the search term as literal characters', async () => {
      const agent = createAgent();
      await createChat({ agentId: agent.id, title: '100% done' });
      await createChat({ agentId: agent.id, title: 'snake_case naming' });
      await createChat({ agentId: agent.id, title: 'snakeXcase naming' });

      const percent = await testApp
        .request()
        .get(`/api/v1/chats?search=${encodeURIComponent('%')}`)
        .expect(200);
      expect(percent.body.total).toBe(1);
      expect(percent.body.items[0].title).toBe('100% done');

      const underscore = await testApp
        .request()
        .get(`/api/v1/chats?search=${encodeURIComponent('snake_case')}`)
        .expect(200);
      expect(underscore.body.total).toBe(1);
      expect(underscore.body.items[0].title).toBe('snake_case naming');
    });

    it('composes search with owner filters and filters before paginating', async () => {
      const a1 = createAgent('A1');
      const a2 = createAgent('A2');
      const t1 = createTeam('T1');
      for (let i = 0; i < 5; i++) {
        await createChat({ agentId: a1.id, title: `Filler ${i}` });
      }
      await createChat({ agentId: a1.id, title: 'Needle for A1' });
      await createChat({ agentId: a2.id, title: 'Needle for A2' });
      await createChat({ teamId: t1.id, title: 'Needle for T1' });

      const page = await testApp
        .request()
        .get(
          '/api/v1/chats?search=needle&sort=title&order=asc&limit=2&offset=0',
        )
        .expect(200);
      expect(page.body.total).toBe(3);
      expect(page.body.items.map((c: { title: string }) => c.title)).toEqual([
        'Needle for A1',
        'Needle for A2',
      ]);

      const lastPage = await testApp
        .request()
        .get(
          '/api/v1/chats?search=needle&sort=title&order=asc&limit=2&offset=2',
        )
        .expect(200);
      expect(
        lastPage.body.items.map((c: { title: string }) => c.title),
      ).toEqual(['Needle for T1']);

      const byAgent = await testApp
        .request()
        .get(`/api/v1/chats?search=needle&agentId=${a2.id}`)
        .expect(200);
      expect(byAgent.body.total).toBe(1);
      expect(byAgent.body.items[0].title).toBe('Needle for A2');

      const byTeam = await testApp
        .request()
        .get(`/api/v1/chats?search=needle&teamId=${t1.id}`)
        .expect(200);
      expect(byTeam.body.total).toBe(1);
      expect(byTeam.body.items[0].title).toBe('Needle for T1');
    });
  });

  describe('Deletion and Cascades', () => {
    it('deletes chat, destroys message history (CASCADE), and clears chatId on artifacts and usage_events (SET NULL)', async () => {
      const agent = createAgent();
      const chat = await createChat({ agentId: agent.id, title: 'To Delete' });

      // Create messages
      testApp.fixtures.createMessage({ chat_id: chat.id, sequence: 1 });
      testApp.fixtures.createMessage({ chat_id: chat.id, sequence: 2 });

      // Create artifact linked to this chat
      const artifact = testApp.fixtures.createArtifact({
        chat_id: chat.id,
        title: 'Important Report',
      });

      // Create usage event linked to this chat
      const usageEvent = testApp.fixtures.createUsageEvent({
        chat_id: chat.id,
        agent_id: agent.id,
      });

      // Verify they exist prior to deletion
      expect(
        testApp.db.all('SELECT * FROM messages WHERE chat_id = ?', [chat.id]),
      ).toHaveLength(2);

      // Delete chat
      await testApp.request().delete(`/api/v1/chats/${chat.id}`).expect(204);

      // Verify chat is gone
      await testApp.request().get(`/api/v1/chats/${chat.id}`).expect(404);

      // Verify messages are permanently destroyed
      const remainingMessages = testApp.db.all(
        'SELECT * FROM messages WHERE chat_id = ?',
        [chat.id],
      );
      expect(remainingMessages).toHaveLength(0);

      // Verify artifact survived with chat_id set to null
      const survivingArtifact = testApp.db.get<{ chat_id: string | null }>(
        'SELECT chat_id FROM artifacts WHERE id = ?',
        [artifact.id],
      );
      expect(survivingArtifact).toBeDefined();
      expect(survivingArtifact?.chat_id).toBeNull();

      // Verify usage event survived with chat_id set to null
      const survivingUsageEvent = testApp.db.get<{ chat_id: string | null }>(
        'SELECT chat_id FROM usage_events WHERE id = ?',
        [usageEvent.id],
      );
      expect(survivingUsageEvent).toBeDefined();
      expect(survivingUsageEvent?.chat_id).toBeNull();
    });
  });

  describe('Owner constraint versus cascade tension (CHECK vs ON DELETE SET NULL)', () => {
    it('demonstrates that deleting an owner fails SQLite CHECK constraint when a chat exists', async () => {
      const agent = createAgent('Owner Agent');
      const chat = await createChat({ agentId: agent.id, title: 'Dependent Chat' });

      // Direct SQL attempt to delete the owning agent when foreign keys are enforced.
      // Foreign key ON DELETE SET NULL attempts to update chats SET agent_id = NULL.
      // But chats has CHECK ((agent_id IS NOT NULL AND team_id IS NULL) OR (agent_id IS NULL AND team_id IS NOT NULL)).
      // SQLite evaluates CHECK on the updated row and rejects the deletion with a constraint violation.
      expect(() => {
        testApp.db.run('DELETE FROM agents WHERE id = ?', [agent.id]);
      }).toThrow(/CHECK constraint failed/);

      // Verify the agent and chat both remain intact in the database
      expect(testApp.db.get('SELECT id FROM agents WHERE id = ?', [agent.id])).toBeDefined();
      expect(testApp.db.get('SELECT id FROM chats WHERE id = ?', [chat.id])).toBeDefined();
    });

    it('demonstrates that deleting an owning team also fails SQLite CHECK constraint when a chat exists', async () => {
      const team = createTeam('Owner Team');
      const chat = await createChat({ teamId: team.id, title: 'Team Dependent Chat' });

      expect(() => {
        testApp.db.run('DELETE FROM teams WHERE id = ?', [team.id]);
      }).toThrow(/CHECK constraint failed/);

      expect(testApp.db.get('SELECT id FROM teams WHERE id = ?', [team.id])).toBeDefined();
      expect(testApp.db.get('SELECT id FROM chats WHERE id = ?', [chat.id])).toBeDefined();
    });

    it('defensively handles orphaned chats (both agent_id and team_id null) on list and get without crashing', async () => {
      const agent = createAgent('Temporary Agent');
      const chat = await createChat({ agentId: agent.id, title: 'Orphaned Chat' });

      // Simulate an orphaned row by temporarily disabling check constraints in SQLite
      testApp.db.exec('PRAGMA ignore_check_constraints = ON');
      testApp.db.run('UPDATE chats SET agent_id = NULL WHERE id = ?', [chat.id]);
      testApp.db.exec('PRAGMA ignore_check_constraints = OFF');

      // 1. GET /api/v1/chats/:chatId must return 200 with null owners rather than crashing
      const getRes = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}`)
        .expect(200);

      expect(getRes.body).toMatchObject({
        id: chat.id,
        title: 'Orphaned Chat',
        agentId: null,
        teamId: null,
      });

      // 2. GET /api/v1/chats must include the orphaned chat without crashing
      const listRes = await testApp
        .request()
        .get('/api/v1/chats')
        .expect(200);

      const found = listRes.body.items.find((c: any) => c.id === chat.id);
      expect(found).toBeDefined();
      expect(found.agentId).toBeNull();
      expect(found.teamId).toBeNull();
    });
  });

  describe('Bulk deletion (DELETE /api/v1/chats)', () => {

    it('rejects bulk deletion when confirm parameter is omitted and deletes nothing', async () => {
      const agent = createAgent();
      await createChat({ agentId: agent.id, title: 'Chat to protect' });

      const response = await testApp
        .request()
        .delete('/api/v1/chats')
        .expect(400);

      expect(JSON.stringify(response.body)).toContain(
        'confirm query parameter is required',
      );

      const rows = testApp.db.all('SELECT * FROM chats');
      expect(rows).toHaveLength(1);
    });

    it('rejects bulk deletion when confirm parameter is not "true" and deletes nothing', async () => {
      const agent = createAgent();
      await createChat({ agentId: agent.id, title: 'Chat to protect' });

      for (const invalidValue of ['false', 'no', '0', '1', 'TRUE']) {
        const response = await testApp
          .request()
          .delete(`/api/v1/chats?confirm=${invalidValue}`)
          .expect(400);

        expect(response.body.details).toContain(
          'confirm must be "true" to authorize irreversible deletion',
        );
      }

      const rows = testApp.db.all('SELECT * FROM chats');
      expect(rows).toHaveLength(1);
    });

    it('returns success with counts of 0 when deleting from an empty database', async () => {
      const response = await testApp
        .request()
        .delete('/api/v1/chats?confirm=true')
        .expect(200);

      expect(response.body).toEqual({
        deletedChats: 0,
        deletedMessages: 0,
      });
    });

    it('destroys all chats and messages, preserves artifacts and usage_events with null chatId, and leaves other entities untouched', async () => {
      const agent = createAgent('Owner Agent');
      const team = createTeam('Owner Team');
      const project = createProject('Related Project');
      testApp.fixtures.createAgentMemory({
        agent_id: agent.id,
        content: 'Agent memory',
      });
      testApp.fixtures.createSharedMemory({ content: 'Shared memory' });

      // Create chats
      const chat1 = await createChat({
        agentId: agent.id,
        projectId: project.id,
        title: 'Chat 1',
      });
      const chat2 = await createChat({ agentId: agent.id, title: 'Chat 2' });
      const chat3 = await createChat({ teamId: team.id, title: 'Chat 3' });

      // Create messages across the chats
      testApp.fixtures.createMessage({ chat_id: chat1.id, sequence: 1 });
      testApp.fixtures.createMessage({ chat_id: chat1.id, sequence: 2 });
      testApp.fixtures.createMessage({ chat_id: chat2.id, sequence: 1 });
      testApp.fixtures.createMessage({ chat_id: chat3.id, sequence: 1 });
      testApp.fixtures.createMessage({ chat_id: chat3.id, sequence: 2 });
      testApp.fixtures.createMessage({ chat_id: chat3.id, sequence: 3 });

      // Create artifact linked to chat1
      const artifact = testApp.fixtures.createArtifact({
        chat_id: chat1.id,
        title: 'Project Brief',
      });

      // Create usage event linked to chat1
      const usageEvent = testApp.fixtures.createUsageEvent({
        chat_id: chat1.id,
        agent_id: agent.id,
      });

      // Assert pre-state
      expect(testApp.db.all('SELECT * FROM chats')).toHaveLength(3);
      expect(testApp.db.all('SELECT * FROM messages')).toHaveLength(6);

      // Perform bulk deletion
      const response = await testApp
        .request()
        .delete('/api/v1/chats?confirm=true')
        .expect(200);

      expect(response.body).toEqual({
        deletedChats: 3,
        deletedMessages: 6,
      });

      // Verify all chats and messages are gone
      expect(testApp.db.all('SELECT * FROM chats')).toHaveLength(0);
      expect(testApp.db.all('SELECT * FROM messages')).toHaveLength(0);

      // Verify artifact survived with chat_id set to null (ON DELETE SET NULL)
      const survivingArtifact = testApp.db.get<{ chat_id: string | null }>(
        'SELECT chat_id FROM artifacts WHERE id = ?',
        [artifact.id],
      );
      expect(survivingArtifact).toBeDefined();
      expect(survivingArtifact?.chat_id).toBeNull();

      // Verify usage event survived with chat_id set to null (ON DELETE SET NULL)
      const survivingUsageEvent = testApp.db.get<{
        chat_id: string | null;
        agent_id: string;
      }>('SELECT chat_id, agent_id FROM usage_events WHERE id = ?', [
        usageEvent.id,
      ]);
      expect(survivingUsageEvent).toBeDefined();
      expect(survivingUsageEvent?.chat_id).toBeNull();
      expect(survivingUsageEvent?.agent_id).toBe(agent.id);

      // Verify unrelated entities are completely untouched
      expect(testApp.db.all('SELECT * FROM agents')).toHaveLength(1);
      expect(testApp.db.all('SELECT * FROM teams')).toHaveLength(1);
      expect(testApp.db.all('SELECT * FROM projects')).toHaveLength(1);
      expect(testApp.db.all('SELECT * FROM agent_memories')).toHaveLength(1);
      expect(testApp.db.all('SELECT * FROM shared_memories')).toHaveLength(1);
    });
  });

  describe('Boundary between persistence and execution (No execution on persistence)', () => {
    it('creates a chat and posts a message without invoking any model provider or inference service', async () => {
      const providerFailureMessage =
        'Architectural boundary violation: Provider or inference service was unexpectedly invoked during persistence';

      const forbiddenMethods = ['complete', 'stream', 'invoke', 'embed', 'generate', 'call'];

      for (const method of forbiddenMethods) {
        (InferenceService.prototype as any)[method] = vi.fn().mockImplementation(() => {
          throw new Error(providerFailureMessage);
        });
        (ProvidersService.prototype as any)[method] = vi.fn().mockImplementation(() => {
          throw new Error(providerFailureMessage);
        });
        (AdapterFactoryService.prototype as any)[method] = vi.fn().mockImplementation(() => {
          throw new Error(providerFailureMessage);
        });
      }

      try {
        const agent = createAgent('Inference Boundary Agent');

        // 1. Chat creation must make no provider call
        const chatRes = await testApp
          .request()
          .post('/api/v1/chats')
          .send({ agentId: agent.id, title: 'No-Provider Chat' })
          .expect(201);

        const chatId = chatRes.body.id;

        // 2. Message persistence must make no provider call
        const msgRes = await testApp
          .request()
          .post(`/api/v1/chats/${chatId}/messages`)
          .send({ content: 'Persistent turn without model invocation' })
          .expect(201);

        expect(msgRes.body.sequence).toBe(1);
        expect(msgRes.body.content).toBe('Persistent turn without model invocation');
        expect(msgRes.body.status).toBe('complete');

        for (const method of forbiddenMethods) {
          expect((InferenceService.prototype as any)[method]).not.toHaveBeenCalled();
          expect((ProvidersService.prototype as any)[method]).not.toHaveBeenCalled();
          expect((AdapterFactoryService.prototype as any)[method]).not.toHaveBeenCalled();
        }
      } finally {
        for (const method of forbiddenMethods) {
          delete (InferenceService.prototype as any)[method];
          delete (ProvidersService.prototype as any)[method];
          delete (AdapterFactoryService.prototype as any)[method];
        }
      }
    });
  });

  describe('Message Sequencing and Concurrency', () => {
    it('assigns sequence starting at 1 and increments with no gaps, independent across chats', async () => {
      const agent = createAgent();
      const chatA = await createChat({ agentId: agent.id, title: 'Seq Chat A' });
      const chatB = await createChat({ agentId: agent.id, title: 'Seq Chat B' });

      // Chat A turn 1
      const resA1 = await testApp
        .request()
        .post(`/api/v1/chats/${chatA.id}/messages`)
        .send({ content: 'Chat A Turn 1' })
        .expect(201);
      expect(resA1.body.sequence).toBe(1);

      // Chat B turn 1 (independent from Chat A)
      const resB1 = await testApp
        .request()
        .post(`/api/v1/chats/${chatB.id}/messages`)
        .send({ content: 'Chat B Turn 1' })
        .expect(201);
      expect(resB1.body.sequence).toBe(1);

      // Chat A turn 2
      const resA2 = await testApp
        .request()
        .post(`/api/v1/chats/${chatA.id}/messages`)
        .send({ content: 'Chat A Turn 2' })
        .expect(201);
      expect(resA2.body.sequence).toBe(2);

      // Chat A turn 3
      const resA3 = await testApp
        .request()
        .post(`/api/v1/chats/${chatA.id}/messages`)
        .send({ content: 'Chat A Turn 3' })
        .expect(201);
      expect(resA3.body.sequence).toBe(3);

      // Chat B turn 2
      const resB2 = await testApp
        .request()
        .post(`/api/v1/chats/${chatB.id}/messages`)
        .send({ content: 'Chat B Turn 2' })
        .expect(201);
      expect(resB2.body.sequence).toBe(2);

      // Verify sequence lists
      const listA = await testApp
        .request()
        .get(`/api/v1/chats/${chatA.id}/messages`)
        .expect(200);
      expect(listA.body.items.map((m: any) => m.sequence)).toEqual([1, 2, 3]);

      const listB = await testApp
        .request()
        .get(`/api/v1/chats/${chatB.id}/messages`)
        .expect(200);
      expect(listB.body.items.map((m: any) => m.sequence)).toEqual([1, 2]);
    });

    it('persists simultaneous HTTP POST requests with distinct contiguous sequences and none are lost', async () => {
      const agent = createAgent();
      const chat = await createChat({ agentId: agent.id, title: 'Concurrent Chat' });
      const concurrentPosts = 15;

      const requests = Array.from({ length: concurrentPosts }, (_, i) =>
        testApp
          .request()
          .post(`/api/v1/chats/${chat.id}/messages`)
          .send({ content: `Simultaneous message #${i + 1}` }),
      );

      const responses = await Promise.all(requests);

      for (const res of responses) {
        expect(res.status).toBe(201);
      }

      const assignedSequences = responses
        .map((r) => r.body.sequence)
        .sort((a, b) => a - b);
      const expectedSequences = Array.from(
        { length: concurrentPosts },
        (_, i) => i + 1,
      );

      expect(assignedSequences).toEqual(expectedSequences);

      const listRes = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?limit=50`)
        .expect(200);

      expect(listRes.body.total).toBe(concurrentPosts);
      expect(listRes.body.items.map((m: any) => m.sequence)).toEqual(
        expectedSequences,
      );
    });

    it('exercises concurrency at the service layer directly to prove atomic sequence assignment without driver serialization', async () => {
      const agent = createAgent();
      const chat = await createChat({ agentId: agent.id, title: 'Service Concurrent Chat' });
      const messagesService = testApp.app.get(MessagesService);
      const concurrentCalls = 12;

      const promises = Array.from({ length: concurrentCalls }, (_, i) =>
        messagesService.create(chat.id, {
          content: `Service-level concurrent post #${i + 1}`,
          role: 'user',
        }),
      );

      const results = await Promise.all(promises);
      const sequences = results.map((r) => r.sequence).sort((a, b) => a - b);
      const expected = Array.from({ length: concurrentCalls }, (_, i) => i + 1);

      expect(sequences).toEqual(expected);

      const dbRows = testApp.db.all<{ sequence: number }>(
        'SELECT sequence FROM messages WHERE chat_id = ? ORDER BY sequence ASC',
        [chat.id],
      );
      expect(dbRows.map((r) => r.sequence)).toEqual(expected);
    });
  });

  describe('Message Scoping and Cross-Chat Isolation', () => {
    it('ensures messages in one chat do not leak into another chat message list or URL', async () => {
      const agent = createAgent();
      const chatA = await createChat({ agentId: agent.id, title: 'Chat Alpha' });
      const chatB = await createChat({ agentId: agent.id, title: 'Chat Beta' });

      const msgA = await testApp
        .request()
        .post(`/api/v1/chats/${chatA.id}/messages`)
        .send({ content: 'Alpha message' })
        .expect(201);

      const msgB = await testApp
        .request()
        .post(`/api/v1/chats/${chatB.id}/messages`)
        .send({ content: 'Beta message' })
        .expect(201);

      // List Chat A messages: contains only msgA
      const listA = await testApp
        .request()
        .get(`/api/v1/chats/${chatA.id}/messages`)
        .expect(200);
      expect(listA.body.items).toHaveLength(1);
      expect(listA.body.items[0].id).toBe(msgA.body.id);
      expect(listA.body.items[0].chatId).toBe(chatA.id);

      // List Chat B messages: contains only msgB
      const listB = await testApp
        .request()
        .get(`/api/v1/chats/${chatB.id}/messages`)
        .expect(200);
      expect(listB.body.items).toHaveLength(1);
      expect(listB.body.items[0].id).toBe(msgB.body.id);
      expect(listB.body.items[0].chatId).toBe(chatB.id);

      // Message ID scoping: resolving a message ID from Chat A under Chat B's URL must return 404
      await testApp
        .request()
        .get(`/api/v1/chats/${chatB.id}/messages/${msgA.body.id}`)
        .expect(404);
    });
  });

  describe('Message Ordering and Pagination Completeness', () => {
    it('orders by sequence ascending by default and descending when order=desc', async () => {
      const agent = createAgent();
      const chat = await createChat({ agentId: agent.id, title: 'Ordering Chat' });

      for (let i = 1; i <= 5; i += 1) {
        testApp.fixtures.createMessage({
          chat_id: chat.id,
          sequence: i,
          content: `Message ${i}`,
        });
      }

      const ascRes = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages`)
        .expect(200);
      expect(ascRes.body.items.map((m: any) => m.sequence)).toEqual([1, 2, 3, 4, 5]);

      const descRes = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?order=desc`)
        .expect(200);
      expect(descRes.body.items.map((m: any) => m.sequence)).toEqual([5, 4, 3, 2, 1]);
    });

    it('pages through a long conversation returning every message exactly once with no gaps or duplicates', async () => {
      const agent = createAgent();
      const chat = await createChat({ agentId: agent.id, title: 'Long Conversation' });
      const totalMessages = 25;

      for (let i = 1; i <= totalMessages; i += 1) {
        testApp.fixtures.createMessage({
          chat_id: chat.id,
          sequence: i,
          content: `Turn #${i}`,
        });
      }

      // 1. Forward cursor pagination using ?after=<seq>
      const collectedForward: number[] = [];
      let afterCursor: number | undefined = undefined;

      while (true) {
        const query = afterCursor !== undefined ? `&after=${afterCursor}` : '';
        const res = await testApp
          .request()
          .get(`/api/v1/chats/${chat.id}/messages?limit=6${query}`)
          .expect(200);

        expect(res.body.total).toBe(totalMessages);
        if (res.body.items.length === 0) break;

        for (const item of res.body.items) {
          collectedForward.push(item.sequence);
        }
        afterCursor = res.body.items[res.body.items.length - 1].sequence;
      }

      const expected = Array.from({ length: totalMessages }, (_, i) => i + 1);
      expect(collectedForward).toEqual(expected);

      // 2. Backward cursor pagination using ?before=<seq>&order=desc
      const collectedBackward: number[] = [];
      let beforeCursor: number | undefined = undefined;

      while (true) {
        const query = beforeCursor !== undefined ? `&before=${beforeCursor}` : '';
        const res = await testApp
          .request()
          .get(`/api/v1/chats/${chat.id}/messages?limit=6&order=desc${query}`)
          .expect(200);

        expect(res.body.total).toBe(totalMessages);
        if (res.body.items.length === 0) break;

        for (const item of res.body.items) {
          collectedBackward.push(item.sequence);
        }
        beforeCursor = res.body.items[res.body.items.length - 1].sequence;
      }

      expect(collectedBackward).toEqual([...expected].reverse());

      // 3. Offset pagination
      const collectedOffset: number[] = [];
      const pageSize = 7;
      let offset = 0;

      while (offset < totalMessages) {
        const res = await testApp
          .request()
          .get(`/api/v1/chats/${chat.id}/messages?limit=${pageSize}&offset=${offset}`)
          .expect(200);

        for (const item of res.body.items) {
          collectedOffset.push(item.sequence);
        }
        offset += pageSize;
      }

      expect(collectedOffset).toEqual(expected);
    });
  });

  describe('Referential Behaviour and In-Flight States', () => {
    it('returns a message whose agent was deleted with a null agentId rather than disappearing or erroring', async () => {
      const ownerAgent = createAgent('Chat Owner');
      const chat = await createChat({ agentId: ownerAgent.id, title: 'Chat With Agent Message' });

      // Create a contributing agent who produces a message
      const contributingAgent = createAgent('Contributing Agent');
      const contribMsg = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/messages`)
        .send({
          content: 'Contributing agent answer.',
          role: 'assistant',
          agentId: contributingAgent.id,
        })
        .expect(201);

      // Delete contributingAgent via API (no chat owns this agent, so deletion succeeds)
      await testApp
        .request()
        .delete(`/api/v1/agents/${contributingAgent.id}`)
        .expect(204);

      // List messages: message must still be there, with agentId: null
      const listRes = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages`)
        .expect(200);

      const targetMsg = listRes.body.items.find((m: any) => m.id === contribMsg.body.id);
      expect(targetMsg).toBeDefined();
      expect(targetMsg.agentId).toBeNull();
      expect(targetMsg.content).toBe('Contributing agent answer.');
    });

    it('returns messages with in-flight status (pending or streaming) rather than filtering them out', async () => {
      const agent = createAgent();
      const chat = await createChat({ agentId: agent.id, title: 'In-flight Status Chat' });

      testApp.fixtures.createMessage({
        chat_id: chat.id,
        sequence: 1,
        role: 'user',
        status: 'complete',
        content: 'User prompt',
      });
      testApp.fixtures.createMessage({
        chat_id: chat.id,
        sequence: 2,
        role: 'assistant',
        status: 'streaming',
        content: 'Partial response streaming...',
      });
      testApp.fixtures.createMessage({
        chat_id: chat.id,
        sequence: 3,
        role: 'assistant',
        status: 'pending',
        content: '',
      });

      const listRes = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages`)
        .expect(200);

      expect(listRes.body.total).toBe(3);
      expect(listRes.body.items).toHaveLength(3);

      expect(listRes.body.items[0]).toMatchObject({
        sequence: 1,
        status: 'complete',
      });
      expect(listRes.body.items[1]).toMatchObject({
        sequence: 2,
        status: 'streaming',
        content: 'Partial response streaming...',
      });
      expect(listRes.body.items[2]).toMatchObject({
        sequence: 3,
        status: 'pending',
        content: '',
      });
    });
  });

  describe('Not-Found and Validation Paths for Chat and Message Endpoints', () => {
    it('returns 404 for non-existent chat on messages endpoints', async () => {
      const nonExistentChatId = '018f3a9e-0000-7000-8000-000000999999';

      const getRes = await testApp
        .request()
        .get(`/api/v1/chats/${nonExistentChatId}/messages`)
        .expect(404);
      expect(getRes.body.code).toBe('CHAT_NOT_FOUND');

      const postRes = await testApp
        .request()
        .post(`/api/v1/chats/${nonExistentChatId}/messages`)
        .send({ content: 'Hello' })
        .expect(404);
      expect(postRes.body.code).toBe('CHAT_NOT_FOUND');
    });

    it('returns 404 when referencing non-existent agentId during message creation', async () => {
      const agent = createAgent();
      const chat = await createChat({ agentId: agent.id });
      const nonExistentAgentId = '018f3a9e-0000-7000-8000-000000888888';

      const res = await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/messages`)
        .send({ content: 'Agent prompt', agentId: nonExistentAgentId })
        .expect(404);

      expect(res.body.code).toBe('AGENT_NOT_FOUND');
      expect(res.body.message).toContain('agentId');
    });

    it('returns 400 when message payload has missing content or invalid role', async () => {
      const agent = createAgent();
      const chat = await createChat({ agentId: agent.id });

      // Missing content
      await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/messages`)
        .send({})
        .expect(400);

      // Invalid role
      await testApp
        .request()
        .post(`/api/v1/chats/${chat.id}/messages`)
        .send({ content: 'Hi', role: 'moderator' })
        .expect(400);
    });

    it('returns 400 when client supplies server-managed fields on message creation', async () => {
      const agent = createAgent();
      const chat = await createChat({ agentId: agent.id });

      const forbiddenFields = [
        { id: '018f3a9e-0000-7000-8000-000000000001' },
        { sequence: 5 },
        { status: 'complete' },
        { tokenCount: 50 },
        { createdAt: '2026-10-19T00:00:00.000Z' },
      ];

      for (const field of forbiddenFields) {
        await testApp
          .request()
          .post(`/api/v1/chats/${chat.id}/messages`)
          .send({ content: 'Valid message', ...field })
          .expect(400);
      }
    });

    it('returns 400 for invalid query parameters on message listing', async () => {
      const agent = createAgent();
      const chat = await createChat({ agentId: agent.id });

      // limit > 100
      await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?limit=101`)
        .expect(400);

      // limit < 1
      await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?limit=0`)
        .expect(400);

      // offset < 0
      await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?offset=-1`)
        .expect(400);

      // before < 1
      await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?before=0`)
        .expect(400);

      // after < 0
      await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?after=-1`)
        .expect(400);

      // invalid sort
      await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?sort=invalid_col`)
        .expect(400);

      // invalid role filter
      await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?role=bot`)
        .expect(400);

      // invalid status filter
      await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}/messages?status=paused`)
        .expect(400);
    });
  });
});

