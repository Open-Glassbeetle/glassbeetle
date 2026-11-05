import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileStorageService } from '../src/file-storage/file-storage.service.js';
import { createTestApp, type TestApp } from './harness/index.js';

describe('Artifacts Endpoints (e2e)', () => {
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

  describe('GET /api/v1/artifacts', () => {
    it('returns 200 with an empty paginated collection when there are none', async () => {
      const res = await testApp.request().get('/api/v1/artifacts').expect(200);

      expect(res.body).toEqual({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      });
    });

    it('returns a paginated list of created artifacts, omits content, sets hasFile, and hides file_path', async () => {
      const a1 = testApp.fixtures.createArtifact({
        title: 'Spec Document',
        type: 'document',
        content: '# Very long specification content that should not bloat lists',
        file_path: null,
      });
      const a2 = testApp.fixtures.createArtifact({
        title: 'Binary Archive',
        type: 'file',
        content: null,
        file_path: 'artifacts/archive.tar.gz',
      });

      const res = await testApp.request().get('/api/v1/artifacts').expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.limit).toBe(50);
      expect(res.body.offset).toBe(0);

      const doc = res.body.items.find((a: any) => a.id === a1.id);
      expect(doc).toMatchObject({
        id: a1.id,
        title: 'Spec Document',
        type: 'document',
        hasFile: false,
        version: 1,
      });
      // Decision: content is omitted from collection list items
      expect(doc.content).toBeUndefined();
      expect(doc.file_path).toBeUndefined();
      expect(doc.filePath).toBeUndefined();

      const file = res.body.items.find((a: any) => a.id === a2.id);
      expect(file).toMatchObject({
        id: a2.id,
        title: 'Binary Archive',
        type: 'file',
        hasFile: true,
        version: 1,
      });
      expect(file.content).toBeUndefined();
      expect(file.file_path).toBeUndefined();
      expect(file.filePath).toBeUndefined();
    });

    it('supports pagination query parameters (limit and offset)', async () => {
      testApp.fixtures.createArtifact({ title: 'Artifact 1' });
      testApp.fixtures.createArtifact({ title: 'Artifact 2' });
      testApp.fixtures.createArtifact({ title: 'Artifact 3' });

      const page1 = await testApp
        .request()
        .get('/api/v1/artifacts?limit=2&offset=0&sort=title&order=asc')
        .expect(200);

      expect(page1.body.total).toBe(3);
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.items[0].title).toBe('Artifact 1');
      expect(page1.body.items[1].title).toBe('Artifact 2');

      const page2 = await testApp
        .request()
        .get('/api/v1/artifacts?limit=2&offset=2&sort=title&order=asc')
        .expect(200);

      expect(page2.body.total).toBe(3);
      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.items[0].title).toBe('Artifact 3');
    });

    it('filters artifacts by projectId, including "null" for unfiled artifacts', async () => {
      const p1 = testApp.fixtures.createProject({ name: 'Project 1' });
      testApp.fixtures.createArtifact({
        title: 'P1 Artifact',
        project_id: p1.id,
      });
      testApp.fixtures.createArtifact({
        title: 'Unfiled Artifact',
        project_id: null,
      });

      const p1Res = await testApp
        .request()
        .get(`/api/v1/artifacts?projectId=${p1.id}`)
        .expect(200);
      expect(p1Res.body.total).toBe(1);
      expect(p1Res.body.items[0].title).toBe('P1 Artifact');

      const unfiledRes = await testApp
        .request()
        .get('/api/v1/artifacts?projectId=null')
        .expect(200);
      expect(unfiledRes.body.total).toBe(1);
      expect(unfiledRes.body.items[0].title).toBe('Unfiled Artifact');
    });

    it('filters artifacts by chatId, including "null" for unfiled artifacts', async () => {
      const c1 = testApp.fixtures.createChat({ title: 'Chat 1' });
      testApp.fixtures.createArtifact({ title: 'C1 Artifact', chat_id: c1.id });
      testApp.fixtures.createArtifact({
        title: 'Standalone Artifact',
        chat_id: null,
      });

      const c1Res = await testApp
        .request()
        .get(`/api/v1/artifacts?chatId=${c1.id}`)
        .expect(200);
      expect(c1Res.body.total).toBe(1);
      expect(c1Res.body.items[0].title).toBe('C1 Artifact');

      const standalone = await testApp
        .request()
        .get('/api/v1/artifacts?chatId=null')
        .expect(200);
      expect(standalone.body.total).toBe(1);
      expect(standalone.body.items[0].title).toBe('Standalone Artifact');
    });

    it('filters artifacts by agentId, including "null" for unassigned', async () => {
      const ag = testApp.fixtures.createAgent({ name: 'Agent 1' });
      testApp.fixtures.createArtifact({
        title: 'Agent Artifact',
        agent_id: ag.id,
      });
      testApp.fixtures.createArtifact({
        title: 'User Artifact',
        agent_id: null,
      });

      const agentRes = await testApp
        .request()
        .get(`/api/v1/artifacts?agentId=${ag.id}`)
        .expect(200);
      expect(agentRes.body.total).toBe(1);
      expect(agentRes.body.items[0].title).toBe('Agent Artifact');

      const userRes = await testApp
        .request()
        .get('/api/v1/artifacts?agentId=null')
        .expect(200);
      expect(userRes.body.total).toBe(1);
      expect(userRes.body.items[0].title).toBe('User Artifact');
    });

    it('filters artifacts by type', async () => {
      testApp.fixtures.createArtifact({
        title: 'Code Snippet',
        type: 'code',
      });
      testApp.fixtures.createArtifact({
        title: 'Structured Table',
        type: 'structured',
      });

      const res = await testApp
        .request()
        .get('/api/v1/artifacts?type=code')
        .expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].title).toBe('Code Snippet');
    });

    it('filters artifacts by title substring search', async () => {
      testApp.fixtures.createArtifact({
        title: 'Architecture Blueprint',
      });
      testApp.fixtures.createArtifact({
        title: 'Test Summary',
      });

      const res = await testApp
        .request()
        .get('/api/v1/artifacts?search=Blueprint')
        .expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].title).toBe('Architecture Blueprint');
    });

    it('supports sorting by created_at, updated_at, title, type, and version', async () => {
      testApp.fixtures.createArtifact({
        title: 'Zebra',
        version: 1,
        created_at: '2026-09-21T01:00:00.000Z',
      });
      testApp.fixtures.createArtifact({
        title: 'Apple',
        version: 5,
        created_at: '2026-09-21T02:00:00.000Z',
      });

      const titleAsc = await testApp
        .request()
        .get('/api/v1/artifacts?sort=title&order=asc')
        .expect(200);
      expect(titleAsc.body.items[0].title).toBe('Apple');

      const versionDesc = await testApp
        .request()
        .get('/api/v1/artifacts?sort=version&order=desc')
        .expect(200);
      expect(versionDesc.body.items[0].title).toBe('Apple');
    });

    it('rejects invalid sort column with 400 Bad Request', async () => {
      const res = await testApp
        .request()
        .get('/api/v1/artifacts?sort=invalid_col')
        .expect(400);

      expect(res.body).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
      });
    });

    it('rejects limit > 100 with 400 Bad Request', async () => {
      await testApp.request().get('/api/v1/artifacts?limit=101').expect(400);
    });
  });

  describe('POST /api/v1/artifacts', () => {
    it('creates an artifact with inline content, returns 201, and sets Location header', async () => {
      const payload = {
        title: 'Database Design Document',
        type: 'document',
        mimeType: 'text/markdown',
        content: '# Database Design\nRelational schema definition...',
      };

      const res = await testApp
        .request()
        .post('/api/v1/artifacts')
        .send(payload)
        .expect(201);

      expect(res.body).toMatchObject({
        title: payload.title,
        type: payload.type,
        mimeType: payload.mimeType,
        content: payload.content,
        hasFile: false,
        version: 1,
        projectId: null,
        chatId: null,
        agentId: null,
      });
      expect(res.body.id).toBeDefined();
      expect(res.body.createdAt).toBeDefined();
      expect(res.body.updatedAt).toBe(res.body.createdAt);
      expect(res.headers.location).toBe(`/api/v1/artifacts/${res.body.id}`);
      expect(res.body.file_path).toBeUndefined();
    });

    it('creates an artifact backed by a stored file', async () => {
      const payload = {
        title: 'Compiled Native Binary',
        type: 'file',
        mimeType: 'application/octet-stream',
        filePath: 'artifacts/binary.bin',
      };

      const res = await testApp
        .request()
        .post('/api/v1/artifacts')
        .send(payload)
        .expect(201);

      expect(res.body).toMatchObject({
        title: payload.title,
        type: payload.type,
        hasFile: true,
        content: null,
      });
      expect(res.body.file_path).toBeUndefined();
      expect(res.body.filePath).toBeUndefined();
    });

    it('creates an artifact linked to existing project, chat, and agent', async () => {
      const project = testApp.fixtures.createProject();
      const chat = testApp.fixtures.createChat();
      const agent = testApp.fixtures.createAgent();

      const res = await testApp
        .request()
        .post('/api/v1/artifacts')
        .send({
          title: 'Linked Artifact',
          type: 'code',
          content: 'export const X = 1;',
          projectId: project.id,
          chatId: chat.id,
          agentId: agent.id,
        })
        .expect(201);

      expect(res.body.projectId).toBe(project.id);
      expect(res.body.chatId).toBe(chat.id);
      expect(res.body.agentId).toBe(agent.id);
    });

    it('rejects creation when both content and filePath are supplied (400)', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/artifacts')
        .send({
          title: 'Conflict Artifact',
          type: 'code',
          content: 'const a = 1;',
          filePath: 'artifacts/code.ts',
        })
        .expect(400);

      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.stringContaining('cannot define both content and filePath'),
        ]),
      );
    });

    it('rejects creation when neither content nor filePath is supplied (400)', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/artifacts')
        .send({
          title: 'Incomplete Artifact',
          type: 'document',
        })
        .expect(400);

      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.stringContaining('must define exactly one of content'),
        ]),
      );
    });

    it('rejects creation when title is missing or empty (400)', async () => {
      await testApp
        .request()
        .post('/api/v1/artifacts')
        .send({
          title: '',
          type: 'document',
          content: 'Hello',
        })
        .expect(400);

      await testApp
        .request()
        .post('/api/v1/artifacts')
        .send({
          type: 'document',
          content: 'Hello',
        })
        .expect(400);
    });

    it('rejects creation when type is invalid (400)', async () => {
      await testApp
        .request()
        .post('/api/v1/artifacts')
        .send({
          title: 'Artifact',
          type: 'multimedia',
          content: 'Hello',
        })
        .expect(400);
    });

    it('rejects client attempts to supply server-managed fields (400)', async () => {
      for (const forbidden of ['id', 'version', 'hasFile', 'createdAt', 'updatedAt']) {
        const res = await testApp
          .request()
          .post('/api/v1/artifacts')
          .send({
            title: 'Artifact',
            type: 'document',
            content: 'Hello',
            [forbidden]: 'unexpected',
          })
          .expect(400);

        expect(
          res.body.details?.some((d: string) => d.includes(forbidden)) ||
            res.body.message?.some((m: string) => m.includes(forbidden)),
        ).toBe(true);
      }
    });

    it('rejects non-existent projectId with 422 Unprocessable Entity', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/artifacts')
        .send({
          title: 'Artifact',
          type: 'document',
          content: 'Hello',
          projectId: '018f3a9e-0000-7000-8000-000000000099',
        })
        .expect(422);

      expect(res.body.code).toBe('PROJECT_NOT_FOUND');
    });

    it('rejects non-existent chatId with 422 Unprocessable Entity', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/artifacts')
        .send({
          title: 'Artifact',
          type: 'document',
          content: 'Hello',
          chatId: '018f3a9e-0000-7000-8000-000000000099',
        })
        .expect(422);

      expect(res.body.code).toBe('CHAT_NOT_FOUND');
    });

    it('rejects non-existent agentId with 422 Unprocessable Entity', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/artifacts')
        .send({
          title: 'Artifact',
          type: 'document',
          content: 'Hello',
          agentId: '018f3a9e-0000-7000-8000-000000000099',
        })
        .expect(422);

      expect(res.body.code).toBe('AGENT_NOT_FOUND');
    });
  });

  describe('GET /api/v1/artifacts/:artifactId', () => {
    it('retrieves an artifact by ID including its inline content', async () => {
      const created = testApp.fixtures.createArtifact({
        title: 'Retrievable Artifact',
        type: 'document',
        content: '# Inline Content Heading\nDetailed body',
        mime_type: 'text/markdown',
      });

      const res = await testApp
        .request()
        .get(`/api/v1/artifacts/${created.id}`)
        .expect(200);

      expect(res.body).toMatchObject({
        id: created.id,
        title: 'Retrievable Artifact',
        type: 'document',
        mimeType: 'text/markdown',
        content: '# Inline Content Heading\nDetailed body',
        hasFile: false,
        version: 1,
      });
      expect(res.body.file_path).toBeUndefined();
    });

    it('retrieves a file artifact, sets hasFile: true, content: null, and hides file_path', async () => {
      const created = testApp.fixtures.createArtifact({
        title: 'File Product',
        type: 'file',
        content: null,
        file_path: 'artifacts/blob.dat',
      });

      const res = await testApp
        .request()
        .get(`/api/v1/artifacts/${created.id}`)
        .expect(200);

      expect(res.body).toMatchObject({
        id: created.id,
        title: 'File Product',
        type: 'file',
        hasFile: true,
        content: null,
      });
      expect(res.body.file_path).toBeUndefined();
      expect(res.body.filePath).toBeUndefined();
    });

    it('returns 400 Bad Request for non-UUIDv7 parameter', async () => {
      const res = await testApp
        .request()
        .get('/api/v1/artifacts/not-a-uuid')
        .expect(400);

      expect(res.body.code).toBe('INVALID_IDENTIFIER');
    });

    it('returns 404 Not Found for well-formed UUIDv7 naming no artifact', async () => {
      const res = await testApp
        .request()
        .get('/api/v1/artifacts/018f3a9e-0000-7000-8000-000000000099')
        .expect(404);

      expect(res.body.code).toBe('ARTIFACT_NOT_FOUND');
    });
  });

  describe('PATCH /api/v1/artifacts/:artifactId', () => {
    it('partially updates title, increments version counter, and advances updatedAt', async () => {
      const created = testApp.fixtures.createArtifact({
        title: 'Original Title',
        content: 'Unchanged Content',
        version: 1,
        created_at: '2026-09-21T09:00:00.000Z',
        updated_at: '2026-09-21T09:00:00.000Z',
      });

      const res = await testApp
        .request()
        .patch(`/api/v1/artifacts/${created.id}`)
        .send({ title: 'Updated Title' })
        .expect(200);

      expect(res.body).toMatchObject({
        id: created.id,
        title: 'Updated Title',
        content: 'Unchanged Content',
        version: 2,
      });
      expect(res.body.updatedAt > created.updated_at).toBe(true);
      expect(res.body.createdAt).toBe(created.created_at);
    });

    it('leaves version and updatedAt untouched on empty update payload (no-op)', async () => {
      const created = testApp.fixtures.createArtifact({
        title: 'Static Title',
        version: 1,
        updated_at: '2026-09-21T09:00:00.000Z',
      });

      const res = await testApp
        .request()
        .patch(`/api/v1/artifacts/${created.id}`)
        .send({})
        .expect(200);

      expect(res.body.version).toBe(1);
      expect(res.body.updatedAt).toBe('2026-09-21T09:00:00.000Z');
    });

    it('allows clearing content and setting filePath, and preserves XOR invariant', async () => {
      const created = testApp.fixtures.createArtifact({
        content: 'Initial inline content',
        file_path: null,
      });

      const res = await testApp
        .request()
        .patch(`/api/v1/artifacts/${created.id}`)
        .send({
          content: null,
          filePath: 'artifacts/replacement.bin',
        })
        .expect(200);

      expect(res.body.hasFile).toBe(true);
      expect(res.body.content).toBeNull();
      expect(res.body.version).toBe(2);
    });

    it('cleans up old backing file when replacing file artifact with inline content', async () => {
      const fileStorage = testApp.app.get(FileStorageService);
      const deleteSpy = vi.spyOn(fileStorage, 'delete');

      const created = testApp.fixtures.createArtifact({
        content: null,
        file_path: 'artifacts/to-replace.bin',
      });

      const res = await testApp
        .request()
        .patch(`/api/v1/artifacts/${created.id}`)
        .send({
          content: 'Replacement text content',
          filePath: null,
        })
        .expect(200);

      expect(res.body.hasFile).toBe(false);
      expect(res.body.content).toBe('Replacement text content');
      expect(deleteSpy).toHaveBeenCalledWith('artifacts/to-replace.bin');
    });

    it('rejects update attempting to clear both content and filePath (400)', async () => {
      const created = testApp.fixtures.createArtifact({
        content: 'Original',
        file_path: null,
      });

      await testApp
        .request()
        .patch(`/api/v1/artifacts/${created.id}`)
        .send({
          content: null,
          filePath: null,
        })
        .expect(400);
    });

    it('rejects update attempting to set both content and filePath (400)', async () => {
      const created = testApp.fixtures.createArtifact({
        content: 'Original',
        file_path: null,
      });

      await testApp
        .request()
        .patch(`/api/v1/artifacts/${created.id}`)
        .send({
          content: 'New content',
          filePath: 'artifacts/file.bin',
        })
        .expect(400);
    });

    it('rejects update with non-existent parent reference (422)', async () => {
      const created = testApp.fixtures.createArtifact();

      const res = await testApp
        .request()
        .patch(`/api/v1/artifacts/${created.id}`)
        .send({
          projectId: '018f3a9e-0000-7000-8000-000000000099',
        })
        .expect(422);

      expect(res.body.code).toBe('PROJECT_NOT_FOUND');
    });

    it('returns 404 for updating non-existent artifact', async () => {
      await testApp
        .request()
        .patch('/api/v1/artifacts/018f3a9e-0000-7000-8000-000000000099')
        .send({ title: 'New' })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/artifacts/:artifactId', () => {
    it('deletes an artifact and unlinks backing file from file storage (204)', async () => {
      const fileStorage = testApp.app.get(FileStorageService);
      const deleteSpy = vi.spyOn(fileStorage, 'delete');

      const created = testApp.fixtures.createArtifact({
        content: null,
        file_path: 'artifacts/deletable.bin',
      });

      await testApp
        .request()
        .delete(`/api/v1/artifacts/${created.id}`)
        .expect(204);

      expect(deleteSpy).toHaveBeenCalledWith('artifacts/deletable.bin');

      await testApp.request().get(`/api/v1/artifacts/${created.id}`).expect(404);
    });

    it('returns 400 Bad Request for invalid UUIDv7', async () => {
      await testApp.request().delete('/api/v1/artifacts/bad-id').expect(400);
    });

    it('returns 404 Not Found for non-existent artifact', async () => {
      await testApp
        .request()
        .delete('/api/v1/artifacts/018f3a9e-0000-7000-8000-000000000099')
        .expect(404);
    });
  });

  describe('Cascade behavior (ON DELETE SET NULL)', () => {
    it('preserves artifact and nulls project_id when referenced project is deleted', async () => {
      const project = testApp.fixtures.createProject({ name: 'Container' });
      const artifact = testApp.fixtures.createArtifact({
        title: 'Surviving Artifact',
        project_id: project.id,
      });

      await testApp
        .request()
        .delete(`/api/v1/projects/${project.id}`)
        .expect(204);

      const res = await testApp
        .request()
        .get(`/api/v1/artifacts/${artifact.id}`)
        .expect(200);

      expect(res.body.id).toBe(artifact.id);
      expect(res.body.projectId).toBeNull();
    });

    it('preserves artifact and nulls chat_id when referenced chat is deleted', async () => {
      const chat = testApp.fixtures.createChat({ title: 'Chat' });
      const artifact = testApp.fixtures.createArtifact({
        title: 'Chat Output',
        chat_id: chat.id,
      });

      await testApp.request().delete(`/api/v1/chats/${chat.id}`).expect(204);

      const res = await testApp
        .request()
        .get(`/api/v1/artifacts/${artifact.id}`)
        .expect(200);

      expect(res.body.id).toBe(artifact.id);
      expect(res.body.chatId).toBeNull();
    });

    it('preserves artifact and nulls agent_id when referenced agent is deleted', async () => {
      const agent = testApp.fixtures.createAgent({ name: 'Worker' });
      const artifact = testApp.fixtures.createArtifact({
        title: 'Agent Product',
        agent_id: agent.id,
      });

      await testApp.request().delete(`/api/v1/agents/${agent.id}`).expect(204);

      const res = await testApp
        .request()
        .get(`/api/v1/artifacts/${artifact.id}`)
        .expect(200);

      expect(res.body.id).toBe(artifact.id);
      expect(res.body.agentId).toBeNull();
    });
  });
});
