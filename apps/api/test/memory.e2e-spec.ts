import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness/index.js';

describe('Memory Integration & Resource Boundary Suite (e2e)', () => {
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

  // --- Helper Functions ---

  function createAgent(name = 'Test Agent') {
    return testApp.fixtures.createAgent({ name });
  }

  async function createAgentMemoryViaApi(
    agentId: string,
    payload: { content: string; tags?: string[] },
  ) {
    const res = await testApp
      .request()
      .post(`/api/v1/agents/${agentId}/memories`)
      .send(payload);
    return res;
  }

  async function createSharedMemoryViaApi(payload: {
    content: string;
    tags?: string[];
  }) {
    const res = await testApp.request().post('/api/v1/memories').send(payload);
    return res;
  }

  // =========================================================================
  // 1. Foreign-Key Enforcement & Database Invariants
  // =========================================================================
  describe('Foreign-Key Enforcement & Database Invariants', () => {
    it('asserts foreign-key enforcement is explicitly active in test SQLite database (PRAGMA foreign_keys = ON)', () => {
      const pragma = testApp.db.get<{ foreign_keys: number }>(
        'PRAGMA foreign_keys',
      );
      expect(pragma?.foreign_keys).toBe(1);
    });

    it('rejects agent_memories rows with non-existent agent_id at the database layer directly', () => {
      expect(() => {
        testApp.db.run(
          `INSERT INTO agent_memories (id, agent_id, content, tags, created_at, updated_at)
           VALUES ('bad-fk-mem', 'non-existent-agent-id', 'Content', NULL, '2026-10-09T00:00:00.000Z', '2026-10-09T00:00:00.000Z')`,
        );
      }).toThrow(/FOREIGN KEY constraint failed/i);
    });
  });

  // =========================================================================
  // 2. Resource Isolation (Agent Memories vs Shared Memories)
  // =========================================================================
  describe('Cross-Resource Isolation (The Central Theme)', () => {
    it('never leaks agent memories into GET /api/v1/memories (shared list isolation)', async () => {
      const agentA = createAgent('Agent A');
      const agentB = createAgent('Agent B');

      await createAgentMemoryViaApi(agentA.id, {
        content: 'Agent A private thought',
      });
      await createAgentMemoryViaApi(agentB.id, {
        content: 'Agent B private thought',
      });

      const sharedRes = await createSharedMemoryViaApi({
        content: 'Shared company fact',
      });
      expect(sharedRes.status).toBe(201);

      const listRes = await testApp.request().get('/api/v1/memories').expect(200);

      expect(listRes.body.total).toBe(1);
      expect(listRes.body.items).toHaveLength(1);
      expect(listRes.body.items[0].id).toBe(sharedRes.body.id);
      expect(listRes.body.items[0].content).toBe('Shared company fact');
      expect(listRes.body.items[0]).not.toHaveProperty('agentId');
    });

    it('never leaks shared memories into GET /api/v1/agents/:agentId/memories (agent list isolation)', async () => {
      const agent = createAgent('Target Agent');

      await createSharedMemoryViaApi({ content: 'Global shared rule 1' });
      await createSharedMemoryViaApi({ content: 'Global shared rule 2' });

      const agentMemRes = await createAgentMemoryViaApi(agent.id, {
        content: 'Agent private rule',
      });
      expect(agentMemRes.status).toBe(201);

      const listRes = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories`)
        .expect(200);

      expect(listRes.body.total).toBe(1);
      expect(listRes.body.items).toHaveLength(1);
      expect(listRes.body.items[0].id).toBe(agentMemRes.body.id);
      expect(listRes.body.items[0].content).toBe('Agent private rule');
      expect(listRes.body.items[0].agentId).toBe(agent.id);
    });

    it('rejects resolving an agent memory ID through shared memory endpoints (GET, PATCH, DELETE) and leaves data intact', async () => {
      const agent = createAgent();
      const agentMem = await createAgentMemoryViaApi(agent.id, {
        content: 'Original Agent Content',
        tags: ['agent-tag'],
      });
      const agentMemId = agentMem.body.id;

      // 1. GET /api/v1/memories/:agentMemId -> 404
      await testApp.request().get(`/api/v1/memories/${agentMemId}`).expect(404);

      // 2. PATCH /api/v1/memories/:agentMemId -> 404
      await testApp
        .request()
        .patch(`/api/v1/memories/${agentMemId}`)
        .send({ content: 'Tampered Content' })
        .expect(404);

      // Re-read via agent endpoint: verify content, tags, updatedAt are completely unchanged
      const verifyAfterPatch = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories/${agentMemId}`)
        .expect(200);
      expect(verifyAfterPatch.body.content).toBe('Original Agent Content');
      expect(verifyAfterPatch.body.tags).toEqual(['agent-tag']);
      expect(verifyAfterPatch.body.updatedAt).toBe(agentMem.body.updatedAt);

      // 3. DELETE /api/v1/memories/:agentMemId -> 404
      await testApp
        .request()
        .delete(`/api/v1/memories/${agentMemId}`)
        .expect(404);

      // Re-read via agent endpoint: verify memory still exists
      const verifyAfterDelete = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories/${agentMemId}`)
        .expect(200);
      expect(verifyAfterDelete.body.id).toBe(agentMemId);
    });

    it('rejects resolving a shared memory ID through agent memory endpoints (GET, PATCH, DELETE) and leaves data intact', async () => {
      const agent = createAgent();
      const sharedMem = await createSharedMemoryViaApi({
        content: 'Original Shared Content',
        tags: ['shared-tag'],
      });
      const sharedMemId = sharedMem.body.id;

      // 1. GET /api/v1/agents/:agentId/memories/:sharedMemId -> 404
      await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories/${sharedMemId}`)
        .expect(404);

      // 2. PATCH /api/v1/agents/:agentId/memories/:sharedMemId -> 404
      await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}/memories/${sharedMemId}`)
        .send({ content: 'Tampered Content' })
        .expect(404);

      // Re-read via shared endpoint: verify content, tags, updatedAt are completely unchanged
      const verifyAfterPatch = await testApp
        .request()
        .get(`/api/v1/memories/${sharedMemId}`)
        .expect(200);
      expect(verifyAfterPatch.body.content).toBe('Original Shared Content');
      expect(verifyAfterPatch.body.tags).toEqual(['shared-tag']);
      expect(verifyAfterPatch.body.updatedAt).toBe(sharedMem.body.updatedAt);

      // 3. DELETE /api/v1/agents/:agentId/memories/:sharedMemId -> 404
      await testApp
        .request()
        .delete(`/api/v1/agents/${agent.id}/memories/${sharedMemId}`)
        .expect(404);

      // Re-read via shared endpoint: verify memory still exists
      const verifyAfterDelete = await testApp
        .request()
        .get(`/api/v1/memories/${sharedMemId}`)
        .expect(200);
      expect(verifyAfterDelete.body.id).toBe(sharedMemId);
    });
  });

  // =========================================================================
  // 3. Isolation Between Agents (Cross-Agent Access)
  // =========================================================================
  describe('Isolation Between Agents', () => {
    it("never permits agent B to read, update or delete agent A's memory, asserting data is unchanged after each attempt", async () => {
      const agentA = createAgent('Agent Alpha');
      const agentB = createAgent('Agent Beta');

      const memA = await createAgentMemoryViaApi(agentA.id, {
        content: 'Secret alpha plan',
        tags: ['alpha-confidential'],
      });
      const memAId = memA.body.id;

      // 1. Attempt GET through agent B's URL -> 404
      await testApp
        .request()
        .get(`/api/v1/agents/${agentB.id}/memories/${memAId}`)
        .expect(404);

      // 2. Attempt PATCH through agent B's URL -> 404
      await testApp
        .request()
        .patch(`/api/v1/agents/${agentB.id}/memories/${memAId}`)
        .send({ content: 'Tampered by Beta', tags: ['compromised'] })
        .expect(404);

      // Re-read through agent A's URL: verify completely unchanged
      const afterPatch = await testApp
        .request()
        .get(`/api/v1/agents/${agentA.id}/memories/${memAId}`)
        .expect(200);
      expect(afterPatch.body.content).toBe('Secret alpha plan');
      expect(afterPatch.body.tags).toEqual(['alpha-confidential']);
      expect(afterPatch.body.updatedAt).toBe(memA.body.updatedAt);

      // 3. Attempt DELETE through agent B's URL -> 404
      await testApp
        .request()
        .delete(`/api/v1/agents/${agentB.id}/memories/${memAId}`)
        .expect(404);

      // Re-read through agent A's URL: verify memory still exists
      const afterDelete = await testApp
        .request()
        .get(`/api/v1/agents/${agentA.id}/memories/${memAId}`)
        .expect(200);
      expect(afterDelete.body.id).toBe(memAId);
      expect(afterDelete.body.content).toBe('Secret alpha plan');
    });

    it('isolates collection listings between agents', async () => {
      const agentA = createAgent('Agent A');
      const agentB = createAgent('Agent B');

      await createAgentMemoryViaApi(agentA.id, { content: 'Memory A1' });
      await createAgentMemoryViaApi(agentA.id, { content: 'Memory A2' });
      await createAgentMemoryViaApi(agentB.id, { content: 'Memory B1' });

      const listA = await testApp
        .request()
        .get(`/api/v1/agents/${agentA.id}/memories`)
        .expect(200);
      expect(listA.body.total).toBe(2);
      expect(listA.body.items.map((i: any) => i.content)).toEqual(
        expect.arrayContaining(['Memory A1', 'Memory A2']),
      );
      expect(listA.body.items.some((i: any) => i.content === 'Memory B1')).toBe(
        false,
      );

      const listB = await testApp
        .request()
        .get(`/api/v1/agents/${agentB.id}/memories`)
        .expect(200);
      expect(listB.body.total).toBe(1);
      expect(listB.body.items[0].content).toBe('Memory B1');
    });
  });

  // =========================================================================
  // 4. Full Lifecycle for Each Resource
  // =========================================================================
  describe('Full Lifecycle for Each Resource', () => {
    it('exercises complete CRUD lifecycle for an agent memory', async () => {
      const agent = createAgent('Lifecycle Agent');

      // 1. CREATE
      const createRes = await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({
          content: 'Initial agent fact',
          tags: ['knowledge', 'lifecycle'],
        })
        .expect(201);

      expect(createRes.header.location).toBe(
        `/api/v1/agents/${agent.id}/memories/${createRes.body.id}`,
      );
      expect(createRes.body.id).toBeDefined();
      expect(createRes.body.agentId).toBe(agent.id);
      expect(createRes.body.content).toBe('Initial agent fact');
      expect(createRes.body.tags).toEqual(['knowledge', 'lifecycle']);
      expect(createRes.body.createdAt).toBeDefined();
      expect(createRes.body.updatedAt).toBe(createRes.body.createdAt);

      const memoryId = createRes.body.id;

      // 2. LIST
      const listRes = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories`)
        .expect(200);
      expect(listRes.body.total).toBe(1);
      expect(listRes.body.items[0].id).toBe(memoryId);

      // 3. RETRIEVE
      const getRes = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories/${memoryId}`)
        .expect(200);
      expect(getRes.body).toEqual(createRes.body);

      // 4. UPDATE
      const patchRes = await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}/memories/${memoryId}`)
        .send({ content: 'Updated agent fact' })
        .expect(200);
      expect(patchRes.body.id).toBe(memoryId);
      expect(patchRes.body.content).toBe('Updated agent fact');
      expect(patchRes.body.tags).toEqual(['knowledge', 'lifecycle']);
      expect(patchRes.body.updatedAt).not.toBe(createRes.body.createdAt);

      // 5. DELETE
      await testApp
        .request()
        .delete(`/api/v1/agents/${agent.id}/memories/${memoryId}`)
        .expect(204);

      // 6. CONFIRM REMOVAL
      await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories/${memoryId}`)
        .expect(404);

      const finalList = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories`)
        .expect(200);
      expect(finalList.body.total).toBe(0);
      expect(finalList.body.items).toEqual([]);
    });

    it('exercises complete CRUD lifecycle for a shared memory', async () => {
      // 1. CREATE
      const createRes = await testApp
        .request()
        .post('/api/v1/memories')
        .send({
          content: 'Global engineering policy',
          tags: ['policy', 'shared'],
        })
        .expect(201);

      expect(createRes.header.location).toBe(
        `/api/v1/memories/${createRes.body.id}`,
      );
      expect(createRes.body.id).toBeDefined();
      expect(createRes.body).not.toHaveProperty('agentId');
      expect(createRes.body.content).toBe('Global engineering policy');
      expect(createRes.body.tags).toEqual(['policy', 'shared']);
      expect(createRes.body.createdAt).toBeDefined();
      expect(createRes.body.updatedAt).toBe(createRes.body.createdAt);

      const memoryId = createRes.body.id;

      // 2. LIST
      const listRes = await testApp.request().get('/api/v1/memories').expect(200);
      expect(listRes.body.total).toBe(1);
      expect(listRes.body.items[0].id).toBe(memoryId);

      // 3. RETRIEVE
      const getRes = await testApp
        .request()
        .get(`/api/v1/memories/${memoryId}`)
        .expect(200);
      expect(getRes.body).toEqual(createRes.body);

      // 4. UPDATE
      const patchRes = await testApp
        .request()
        .patch(`/api/v1/memories/${memoryId}`)
        .send({ content: 'Updated global engineering policy' })
        .expect(200);
      expect(patchRes.body.id).toBe(memoryId);
      expect(patchRes.body.content).toBe('Updated global engineering policy');
      expect(patchRes.body.tags).toEqual(['policy', 'shared']);

      // 5. DELETE
      await testApp.request().delete(`/api/v1/memories/${memoryId}`).expect(204);

      // 6. CONFIRM REMOVAL
      await testApp.request().get(`/api/v1/memories/${memoryId}`).expect(404);

      const finalList = await testApp
        .request()
        .get('/api/v1/memories')
        .expect(200);
      expect(finalList.body.total).toBe(0);
      expect(finalList.body.items).toEqual([]);
    });
  });

  // =========================================================================
  // 5. Bulk Deletion Scoping (Tested in Both Orders)
  // =========================================================================
  describe('Bulk Deletion Scoping & Safety', () => {
    it('clears scopes in Order 1: Agent A -> Agent B -> Shared, verifying boundary integrity at every step', async () => {
      const agentA = createAgent('Agent A');
      const agentB = createAgent('Agent B');

      await createAgentMemoryViaApi(agentA.id, { content: 'Mem A1' });
      await createAgentMemoryViaApi(agentA.id, { content: 'Mem A2' });
      await createAgentMemoryViaApi(agentB.id, { content: 'Mem B1' });
      await createAgentMemoryViaApi(agentB.id, { content: 'Mem B2' });
      await createSharedMemoryViaApi({ content: 'Shared 1' });
      await createSharedMemoryViaApi({ content: 'Shared 2' });

      // 1. Bulk delete Agent A memories
      const delARes = await testApp
        .request()
        .delete(`/api/v1/agents/${agentA.id}/memories?confirm=true`)
        .expect(200);
      expect(delARes.body).toEqual({ deleted: 2 });

      // Verify Agent A has 0
      const listA = await testApp
        .request()
        .get(`/api/v1/agents/${agentA.id}/memories`)
        .expect(200);
      expect(listA.body.total).toBe(0);

      // Verify Agent B still has 2
      const listB = await testApp
        .request()
        .get(`/api/v1/agents/${agentB.id}/memories`)
        .expect(200);
      expect(listB.body.total).toBe(2);

      // Verify Shared still has 2
      const listShared = await testApp
        .request()
        .get('/api/v1/memories')
        .expect(200);
      expect(listShared.body.total).toBe(2);

      // 2. Bulk delete Agent B memories
      const delBRes = await testApp
        .request()
        .delete(`/api/v1/agents/${agentB.id}/memories?confirm=true`)
        .expect(200);
      expect(delBRes.body).toEqual({ deleted: 2 });

      // Verify Agent A is 0, Agent B is 0, Shared is still 2
      expect(
        (
          await testApp
            .request()
            .get(`/api/v1/agents/${agentA.id}/memories`)
            .expect(200)
        ).body.total,
      ).toBe(0);
      expect(
        (
          await testApp
            .request()
            .get(`/api/v1/agents/${agentB.id}/memories`)
            .expect(200)
        ).body.total,
      ).toBe(0);
      expect(
        (await testApp.request().get('/api/v1/memories').expect(200)).body.total,
      ).toBe(2);

      // 3. Bulk delete Shared memories
      const delSharedRes = await testApp
        .request()
        .delete('/api/v1/memories?confirm=true')
        .expect(200);
      expect(delSharedRes.body).toEqual({ deleted: 2 });

      // Verify all are now 0
      expect(
        (await testApp.request().get('/api/v1/memories').expect(200)).body.total,
      ).toBe(0);
      expect(
        (
          await testApp
            .request()
            .get(`/api/v1/agents/${agentA.id}/memories`)
            .expect(200)
        ).body.total,
      ).toBe(0);
      expect(
        (
          await testApp
            .request()
            .get(`/api/v1/agents/${agentB.id}/memories`)
            .expect(200)
        ).body.total,
      ).toBe(0);
    });

    it('clears scopes in Order 2: Shared -> Agent B -> Agent A, verifying boundary integrity at every step', async () => {
      const agentA = createAgent('Agent A');
      const agentB = createAgent('Agent B');

      await createAgentMemoryViaApi(agentA.id, { content: 'Mem A1' });
      await createAgentMemoryViaApi(agentA.id, { content: 'Mem A2' });
      await createAgentMemoryViaApi(agentB.id, { content: 'Mem B1' });
      await createAgentMemoryViaApi(agentB.id, { content: 'Mem B2' });
      await createSharedMemoryViaApi({ content: 'Shared 1' });
      await createSharedMemoryViaApi({ content: 'Shared 2' });

      // 1. Bulk delete Shared memories first
      const delSharedRes = await testApp
        .request()
        .delete('/api/v1/memories?confirm=true')
        .expect(200);
      expect(delSharedRes.body).toEqual({ deleted: 2 });

      // Verify Shared has 0
      expect(
        (await testApp.request().get('/api/v1/memories').expect(200)).body.total,
      ).toBe(0);

      // Verify Agent A still has 2
      expect(
        (
          await testApp
            .request()
            .get(`/api/v1/agents/${agentA.id}/memories`)
            .expect(200)
        ).body.total,
      ).toBe(2);

      // Verify Agent B still has 2
      expect(
        (
          await testApp
            .request()
            .get(`/api/v1/agents/${agentB.id}/memories`)
            .expect(200)
        ).body.total,
      ).toBe(2);

      // 2. Bulk delete Agent B memories
      const delBRes = await testApp
        .request()
        .delete(`/api/v1/agents/${agentB.id}/memories?confirm=true`)
        .expect(200);
      expect(delBRes.body).toEqual({ deleted: 2 });

      // Verify Shared is 0, Agent B is 0, Agent A still has 2
      expect(
        (await testApp.request().get('/api/v1/memories').expect(200)).body.total,
      ).toBe(0);
      expect(
        (
          await testApp
            .request()
            .get(`/api/v1/agents/${agentB.id}/memories`)
            .expect(200)
        ).body.total,
      ).toBe(0);
      expect(
        (
          await testApp
            .request()
            .get(`/api/v1/agents/${agentA.id}/memories`)
            .expect(200)
        ).body.total,
      ).toBe(2);

      // 3. Bulk delete Agent A memories
      const delARes = await testApp
        .request()
        .delete(`/api/v1/agents/${agentA.id}/memories?confirm=true`)
        .expect(200);
      expect(delARes.body).toEqual({ deleted: 2 });

      // Verify all are now 0
      expect(
        (
          await testApp
            .request()
            .get(`/api/v1/agents/${agentA.id}/memories`)
            .expect(200)
        ).body.total,
      ).toBe(0);
      expect(
        (
          await testApp
            .request()
            .get(`/api/v1/agents/${agentB.id}/memories`)
            .expect(200)
        ).body.total,
      ).toBe(0);
      expect(
        (await testApp.request().get('/api/v1/memories').expect(200)).body.total,
      ).toBe(0);
    });

    it('enforces ?confirm=true confirmation on bulk deletion and preserves data on rejection', async () => {
      const agent = createAgent();
      await createAgentMemoryViaApi(agent.id, { content: 'Preserved Fact' });
      await createSharedMemoryViaApi({ content: 'Preserved Shared Fact' });

      // Missing confirm on agent bulk delete -> 400
      await testApp
        .request()
        .delete(`/api/v1/agents/${agent.id}/memories`)
        .expect(400);

      // confirm=false on agent bulk delete -> 400
      await testApp
        .request()
        .delete(`/api/v1/agents/${agent.id}/memories?confirm=false`)
        .expect(400);

      // Missing confirm on shared bulk delete -> 400
      await testApp.request().delete('/api/v1/memories').expect(400);

      // confirm=false on shared bulk delete -> 400
      await testApp
        .request()
        .delete('/api/v1/memories?confirm=false')
        .expect(400);

      // Assert data is completely intact
      expect(
        (
          await testApp
            .request()
            .get(`/api/v1/agents/${agent.id}/memories`)
            .expect(200)
        ).body.total,
      ).toBe(1);
      expect(
        (await testApp.request().get('/api/v1/memories').expect(200)).body.total,
      ).toBe(1);
    });
  });

  // =========================================================================
  // 6. Cascade Behaviour on Agent Deletion
  // =========================================================================
  describe('Cascade Behaviour', () => {
    it('cascades agent deletion to agent_memories rows and leaves shared memories untouched', async () => {
      const agentA = createAgent('Agent to be deleted');
      const agentB = createAgent('Surviving Agent');

      const memA = await createAgentMemoryViaApi(agentA.id, {
        content: 'Agent A doomed memory',
      });
      const memB = await createAgentMemoryViaApi(agentB.id, {
        content: 'Agent B surviving memory',
      });
      const sharedMem = await createSharedMemoryViaApi({
        content: 'Shared surviving memory',
      });

      // Verify row exists in DB before delete
      const rowABefore = testApp.db.get(
        'SELECT * FROM agent_memories WHERE id = ?',
        [memA.body.id],
      );
      expect(rowABefore).toBeDefined();

      // Delete Agent A
      await testApp.request().delete(`/api/v1/agents/${agentA.id}`).expect(204);

      // Verify Agent A's memory is removed from DB via ON DELETE CASCADE
      const rowAAfter = testApp.db.get(
        'SELECT * FROM agent_memories WHERE id = ?',
        [memA.body.id],
      );
      expect(rowAAfter).toBeUndefined();

      // Querying Agent A memories endpoint returns 404 (agent not found)
      await testApp
        .request()
        .get(`/api/v1/agents/${agentA.id}/memories`)
        .expect(404);

      // Agent B memories remain completely intact
      const listB = await testApp
        .request()
        .get(`/api/v1/agents/${agentB.id}/memories`)
        .expect(200);
      expect(listB.body.total).toBe(1);
      expect(listB.body.items[0].id).toBe(memB.body.id);

      // Shared memories remain completely intact
      const listShared = await testApp
        .request()
        .get('/api/v1/memories')
        .expect(200);
      expect(listShared.body.total).toBe(1);
      expect(listShared.body.items[0].id).toBe(sharedMem.body.id);
    });
  });

  // =========================================================================
  // 7. Memory Tags: Storage, Normalisation & Filter Pagination Composition
  // =========================================================================
  describe('Memory Tags Format, Normalisation & Filtering', () => {
    it('round-trips tags as a string array, normalises empty arrays to SQL NULL, and reads back as []', async () => {
      const agent = createAgent();

      // 1. Array with tags: trimmed, lowercased, deduplicated, sorted
      const resTags = await createAgentMemoryViaApi(agent.id, {
        content: 'Tagged memory',
        tags: ['Frontend', '  react ', 'frontend', 'architecture'],
      });
      expect(resTags.status).toBe(201);
      expect(resTags.body.tags).toEqual(['architecture', 'frontend', 'react']);

      // 2. Empty array -> stored as NULL, returned as []
      const resEmpty = await createAgentMemoryViaApi(agent.id, {
        content: 'Empty tags memory',
        tags: [],
      });
      expect(resEmpty.status).toBe(201);
      expect(resEmpty.body.tags).toEqual([]);

      const rowEmpty = testApp.db.get<{ tags: string | null }>(
        'SELECT tags FROM agent_memories WHERE id = ?',
        [resEmpty.body.id],
      );
      expect(rowEmpty?.tags).toBeNull();

      // 3. Omitted tags -> stored as NULL, returned as []
      const resOmitted = await createAgentMemoryViaApi(agent.id, {
        content: 'Omitted tags memory',
      });
      expect(resOmitted.status).toBe(201);
      expect(resOmitted.body.tags).toEqual([]);

      const rowOmitted = testApp.db.get<{ tags: string | null }>(
        'SELECT tags FROM agent_memories WHERE id = ?',
        [resOmitted.body.id],
      );
      expect(rowOmitted?.tags).toBeNull();
    });

    it('rejects invalid tag payloads with 400 Bad Request', async () => {
      const agent = createAgent();

      // String instead of array
      await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Fact', tags: 'not-an-array' })
        .expect(400);

      // Array containing numbers
      await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Fact', tags: ['valid', 123] })
        .expect(400);

      // Array containing empty string
      await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Fact', tags: ['valid', ''] })
        .expect(400);

      // Same validation on shared memory endpoint
      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Shared fact', tags: 'not-an-array' })
        .expect(400);
    });

    it('proves tag filtering composes correctly with pagination in SQL rather than paging before filtering', async () => {
      const agent = createAgent();

      // Seed 8 untagged memories
      for (let i = 1; i <= 8; i++) {
        await createAgentMemoryViaApi(agent.id, {
          content: `Background untagged ${i}`,
        });
      }

      // Seed 5 tagged memories with 'target-tag'
      for (let i = 1; i <= 5; i++) {
        await createAgentMemoryViaApi(agent.id, {
          content: `Tagged target memory ${i}`,
          tags: ['target-tag'],
        });
      }

      // Query page 1 with limit=2 (if paged in app before filtering, this would return 0 items)
      const page1 = await testApp
        .request()
        .get(
          `/api/v1/agents/${agent.id}/memories?tag=target-tag&limit=2&offset=0&sortBy=content&order=asc`,
        )
        .expect(200);

      expect(page1.body.total).toBe(5);
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.items[0].content).toBe('Tagged target memory 1');
      expect(page1.body.items[1].content).toBe('Tagged target memory 2');

      // Query page 2 with limit=2, offset=2
      const page2 = await testApp
        .request()
        .get(
          `/api/v1/agents/${agent.id}/memories?tag=target-tag&limit=2&offset=2&sortBy=content&order=asc`,
        )
        .expect(200);

      expect(page2.body.total).toBe(5);
      expect(page2.body.items).toHaveLength(2);
      expect(page2.body.items[0].content).toBe('Tagged target memory 3');
      expect(page2.body.items[1].content).toBe('Tagged target memory 4');

      // Query page 3 with limit=2, offset=4
      const page3 = await testApp
        .request()
        .get(
          `/api/v1/agents/${agent.id}/memories?tag=target-tag&limit=2&offset=4&sortBy=content&order=asc`,
        )
        .expect(200);

      expect(page3.body.total).toBe(5);
      expect(page3.body.items).toHaveLength(1);
      expect(page3.body.items[0].content).toBe('Tagged target memory 5');
    });
  });

  // =========================================================================
  // 8. Partial Update Isolation
  // =========================================================================
  describe('Partial Update Isolation', () => {
    it('updates only content on agent memory and leaves tags intact', async () => {
      const agent = createAgent();
      const created = await createAgentMemoryViaApi(agent.id, {
        content: 'Original content',
        tags: ['tag-one', 'tag-two'],
      });

      const updated = await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}/memories/${created.body.id}`)
        .send({ content: 'Modified content only' })
        .expect(200);

      expect(updated.body.content).toBe('Modified content only');
      expect(updated.body.tags).toEqual(['tag-one', 'tag-two']);
    });

    it('updates only tags on agent memory and leaves content intact', async () => {
      const agent = createAgent();
      const created = await createAgentMemoryViaApi(agent.id, {
        content: 'Original content to preserve',
        tags: ['old-tag'],
      });

      const updated = await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}/memories/${created.body.id}`)
        .send({ tags: ['new-tag-alpha', 'new-tag-beta'] })
        .expect(200);

      expect(updated.body.content).toBe('Original content to preserve');
      expect(updated.body.tags).toEqual(['new-tag-alpha', 'new-tag-beta']);
    });

    it('updates only content on shared memory and leaves tags intact', async () => {
      const created = await createSharedMemoryViaApi({
        content: 'Shared original content',
        tags: ['shared-tag'],
      });

      const updated = await testApp
        .request()
        .patch(`/api/v1/memories/${created.body.id}`)
        .send({ content: 'Shared modified content' })
        .expect(200);

      expect(updated.body.content).toBe('Shared modified content');
      expect(updated.body.tags).toEqual(['shared-tag']);
    });

    it('updates only tags on shared memory and leaves content intact', async () => {
      const created = await createSharedMemoryViaApi({
        content: 'Shared preserved content',
        tags: ['old-shared-tag'],
      });

      const updated = await testApp
        .request()
        .patch(`/api/v1/memories/${created.body.id}`)
        .send({ tags: ['replacement-tag'] })
        .expect(200);

      expect(updated.body.content).toBe('Shared preserved content');
      expect(updated.body.tags).toEqual(['replacement-tag']);
    });
  });

  // =========================================================================
  // 9. Not-Found Paths Across All ID Endpoints
  // =========================================================================
  describe('Not-Found Paths', () => {
    it('returns 404 for non-existent agentId across all agent memory endpoints', async () => {
      const fakeAgentId = '018f3a9e-0000-7000-8000-000000000999';

      await testApp
        .request()
        .get(`/api/v1/agents/${fakeAgentId}/memories`)
        .expect(404);

      await testApp
        .request()
        .post(`/api/v1/agents/${fakeAgentId}/memories`)
        .send({ content: 'Fact' })
        .expect(404);

      await testApp
        .request()
        .get(`/api/v1/agents/${fakeAgentId}/memories/any-id`)
        .expect(404);

      await testApp
        .request()
        .patch(`/api/v1/agents/${fakeAgentId}/memories/any-id`)
        .send({ content: 'Update' })
        .expect(404);

      await testApp
        .request()
        .delete(`/api/v1/agents/${fakeAgentId}/memories/any-id`)
        .expect(404);

      await testApp
        .request()
        .delete(`/api/v1/agents/${fakeAgentId}/memories?confirm=true`)
        .expect(404);
    });

    it('returns 404 for existing agent with non-existent memoryId', async () => {
      const agent = createAgent();
      const fakeMemoryId = '018f3a9e-0000-7000-8000-000000000888';

      await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories/${fakeMemoryId}`)
        .expect(404);

      await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}/memories/${fakeMemoryId}`)
        .send({ content: 'Update' })
        .expect(404);

      await testApp
        .request()
        .delete(`/api/v1/agents/${agent.id}/memories/${fakeMemoryId}`)
        .expect(404);
    });

    it('returns 404 for non-existent memoryId on shared memory endpoints', async () => {
      const fakeMemoryId = '018f3a9e-0000-7000-8000-000000000777';

      await testApp.request().get(`/api/v1/memories/${fakeMemoryId}`).expect(404);

      await testApp
        .request()
        .patch(`/api/v1/memories/${fakeMemoryId}`)
        .send({ content: 'Update' })
        .expect(404);

      await testApp
        .request()
        .delete(`/api/v1/memories/${fakeMemoryId}`)
        .expect(404);
    });
  });

  // =========================================================================
  // 10. Pagination & Sorting Invariants
  // =========================================================================
  describe('Pagination & Sorting Boundaries', () => {
    it('paginates across page boundaries and maintains deterministic sorting', async () => {
      const agent = createAgent();

      for (let i = 1; i <= 5; i++) {
        await createAgentMemoryViaApi(agent.id, {
          content: `Item ${i.toString().padStart(2, '0')}`,
        });
      }

      // Page 1: limit 2, offset 0
      const p1 = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories?limit=2&offset=0&sortBy=content&order=asc`)
        .expect(200);
      expect(p1.body.total).toBe(5);
      expect(p1.body.limit).toBe(2);
      expect(p1.body.offset).toBe(0);
      expect(p1.body.items).toHaveLength(2);
      expect(p1.body.items[0].content).toBe('Item 01');
      expect(p1.body.items[1].content).toBe('Item 02');

      // Page 2: limit 2, offset 2
      const p2 = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories?limit=2&offset=2&sortBy=content&order=asc`)
        .expect(200);
      expect(p2.body.total).toBe(5);
      expect(p2.body.offset).toBe(2);
      expect(p2.body.items).toHaveLength(2);
      expect(p2.body.items[0].content).toBe('Item 03');
      expect(p2.body.items[1].content).toBe('Item 04');

      // Page 3: limit 2, offset 4
      const p3 = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories?limit=2&offset=4&sortBy=content&order=asc`)
        .expect(200);
      expect(p3.body.total).toBe(5);
      expect(p3.body.offset).toBe(4);
      expect(p3.body.items).toHaveLength(1);
      expect(p3.body.items[0].content).toBe('Item 05');
    });

    it('validates pagination query parameters with 400 Bad Request', async () => {
      const agent = createAgent();

      // limit < 1
      await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories?limit=0`)
        .expect(400);

      // limit > 100
      await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories?limit=101`)
        .expect(400);

      // offset < 0
      await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories?offset=-1`)
        .expect(400);

      // invalid sort column
      await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories?sort=malicious_col`)
        .expect(400);

      // invalid order
      await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories?order=sideways`)
        .expect(400);
    });
  });

  // =========================================================================
  // 11. Request Validation & Security Boundaries
  // =========================================================================
  describe('Request Validation & Server-Managed Field Rejection', () => {
    it('rejects missing or empty content on creation with 400 Bad Request', async () => {
      const agent = createAgent();

      // Missing content
      await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ tags: ['valid-tag'] })
        .expect(400);

      // Empty content string
      await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: '' })
        .expect(400);

      // Same on shared memory endpoint
      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: '' })
        .expect(400);
    });

    it('rejects unknown properties in request bodies (whitelist validation)', async () => {
      const agent = createAgent();

      await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Valid', unknownProp: 'bad' })
        .expect(400);

      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Valid', rogueField: 42 })
        .expect(400);
    });

    it('rejects client-supplied server-managed fields in request bodies', async () => {
      const agent = createAgent();

      // id
      await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Valid', id: 'custom-id' })
        .expect(400);

      // createdAt / created_at
      await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Valid', createdAt: '2020-01-01T00:00:00.000Z' })
        .expect(400);

      await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Valid', created_at: '2020-01-01T00:00:00.000Z' })
        .expect(400);

      // updatedAt / updated_at
      await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Valid', updatedAt: '2020-01-01T00:00:00.000Z' })
        .expect(400);

      await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Valid', updated_at: '2020-01-01T00:00:00.000Z' })
        .expect(400);

      // agentId / agent_id passed into shared memory
      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Valid', agentId: agent.id })
        .expect(400);

      await testApp
        .request()
        .post('/api/v1/memories')
        .send({ content: 'Valid', agent_id: agent.id })
        .expect(400);

      // agentId / agent_id passed into agent memory body
      await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Valid', agentId: agent.id })
        .expect(400);

      await testApp
        .request()
        .post(`/api/v1/agents/${agent.id}/memories`)
        .send({ content: 'Valid', agent_id: agent.id })
        .expect(400);
    });

    it('rejects invalid or empty updates on PATCH', async () => {
      const agent = createAgent();
      const mem = await createAgentMemoryViaApi(agent.id, {
        content: 'Original',
      });

      // Empty content string on PATCH
      await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}/memories/${mem.body.id}`)
        .send({ content: '' })
        .expect(400);

      // Server-managed id on PATCH
      await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}/memories/${mem.body.id}`)
        .send({ id: 'new-id' })
        .expect(400);

      // Unknown property on PATCH
      await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}/memories/${mem.body.id}`)
        .send({ invalidProperty: 'value' })
        .expect(400);
    });
  });
});
