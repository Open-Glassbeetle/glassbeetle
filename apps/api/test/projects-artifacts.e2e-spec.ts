import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { newId } from '../src/common/persistence/identifiers.js';
import { resolveDefaultDataDir } from '../src/config/data-dir.js';
import { FileStorageService } from '../src/file-storage/file-storage.service.js';
import {
  MAX_PROJECT_DESCRIPTION_LENGTH,
  MAX_PROJECT_NAME_LENGTH,
} from '../src/modules/projects/dto/create-project.dto.js';
import { MAX_ARTIFACT_TITLE_LENGTH } from '../src/modules/artifacts/dto/artifact-validators.js';
import {
  createTestApp,
  type AgentRow,
  type ArtifactRow,
  type ChatRow,
  type ProjectRow,
  type TestApp,
} from './harness/index.js';

/**
 * Technical Notes & Documented Gaps:
 *
 * 1. Two genuine gaps are present in the current API surface:
 *    - Gap 1: There is no HTTP endpoint for uploading artifact file content.
 *      File-backed artifacts are tested by writing the file via FileStorageService
 *      and supplying its stored relative reference as `filePath` when creating the artifact.
 *    - Gap 2: There is no HTTP route for serving project images back (unlike
 *      `GET /api/v1/agents/:agentId/picture`, there is no `GET /api/v1/projects/:projectId/image`).
 *      Image upload and persistence are verified via database inspections, filesystem
 *      checks, and the `hasImage` boolean in project responses.
 *
 * 2. Survival Invariant:
 *    Artifacts are designed to outlive projects, chats, and agents. All three foreign
 *    keys specify `ON DELETE SET NULL`. This suite verifies that deleting any or all of
 *    them preserves the artifact and sets the respective foreign keys to null, in
 *    multiple deletion orders.
 */

describe('Projects and Artifacts Integration Test Suite (e2e)', () => {
  let testApp: TestApp;

  // 1x1 transparent PNG signature bytes for upload tests
  const validPng = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
  ]);

  const validJpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  ]);

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(() => {
    testApp.reset();
  });

  // ---------------------------------------------------------------------------
  // 1. Database Configuration & Harness Isolation
  // ---------------------------------------------------------------------------
  describe('Safety & Foreign-Key Enforcement', () => {
    it('asserts foreign-key enforcement is enabled explicitly in the test database', () => {
      const pragma = testApp.db.get<{ foreign_keys: number }>(
        'PRAGMA foreign_keys',
      );
      expect(pragma?.foreign_keys).toBe(1);

      // Verify that invalid foreign keys are rejected at the SQLite engine level
      expect(() => {
        testApp.db.run(
          `INSERT INTO artifacts (id, title, type, project_id, version, created_at, updated_at)
           VALUES (?, 'Orphan', 'code', '018f3a9e-0000-7000-8000-000000000404', 1, ?, ?)`,
          [newId(), new Date().toISOString(), new Date().toISOString()],
        );
      }).toThrow(/FOREIGN KEY/i);
    });

    it('verifies the test harness exposes isolated storage and database paths inside tmpdir, never touching the real data directory', () => {
      const fileStorage = testApp.app.get(FileStorageService);
      const systemTmp = tmpdir();
      const realDataDir = resolveDefaultDataDir();

      // Test storage root must be inside OS temp dir
      expect(fileStorage.storageRoot.startsWith(systemTmp)).toBe(true);
      // Test storage root must never match or be inside the real user data directory
      expect(fileStorage.storageRoot).not.toBe(
        path.resolve(realDataDir, 'storage'),
      );

      // SQLite database file must also reside in temp dir
      const dbList = testApp.db.get<{ file: string }>('PRAGMA database_list');
      expect(dbList?.file).toBeDefined();
      expect(dbList!.file.startsWith(systemTmp)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Survival Invariant Helper and Centrepiece Tests
  // ---------------------------------------------------------------------------
  interface SurvivalFixture {
    project: ProjectRow;
    agent: AgentRow;
    chat: ChatRow;
    artifact: ArtifactRow;
  }

  function seedSurvivalFixture(
    overrides?: Partial<ArtifactRow>,
  ): SurvivalFixture {
    const project = testApp.fixtures.createProject({
      name: 'Resilient Project',
      description: 'Survival testing project',
    });
    const agent = testApp.fixtures.createAgent({
      name: 'Resilient Agent',
      personality: 'Survivor',
    });
    // Chat requires exactly one of agent_id or team_id
    const chat = testApp.fixtures.createChat({
      title: 'Resilient Chat',
      project_id: project.id,
      agent_id: agent.id,
    });
    const artifact = testApp.fixtures.createArtifact({
      title: 'Resilient Artifact Spec',
      type: 'document',
      mime_type: 'text/markdown',
      content: '# Invariant: Must survive parent deletions\n\nPreserved.',
      file_path: null,
      project_id: project.id,
      chat_id: chat.id,
      agent_id: agent.id,
      ...overrides,
    });

    return { project, agent, chat, artifact };
  }

  describe('The Survival Invariant (ON DELETE SET NULL)', () => {
    it('Order 1 (Project -> Chat -> Agent): artifact survives every deletion and references become null', async () => {
      const { project, agent, chat, artifact } = seedSurvivalFixture();

      // 1. Delete the Project
      await testApp
        .request()
        .delete(`/api/v1/projects/${project.id}`)
        .expect(204);

      // Project is gone
      await testApp.request().get(`/api/v1/projects/${project.id}`).expect(404);

      // Artifact still exists; project_id became null; chat_id and agent_id intact
      const resAfterProj = await testApp
        .request()
        .get(`/api/v1/artifacts/${artifact.id}`)
        .expect(200);
      expect(resAfterProj.body).toMatchObject({
        id: artifact.id,
        projectId: null,
        chatId: chat.id,
        agentId: agent.id,
      });

      // Chat also survived with project_id nulled
      const chatAfterProj = await testApp
        .request()
        .get(`/api/v1/chats/${chat.id}`)
        .expect(200);
      expect(chatAfterProj.body.projectId).toBeNull();
      expect(chatAfterProj.body.agentId).toBe(agent.id);

      // 2. Delete the Chat
      await testApp.request().delete(`/api/v1/chats/${chat.id}`).expect(204);
      await testApp.request().get(`/api/v1/chats/${chat.id}`).expect(404);

      // Artifact still exists; chat_id also became null; agent_id intact
      const resAfterChat = await testApp
        .request()
        .get(`/api/v1/artifacts/${artifact.id}`)
        .expect(200);
      expect(resAfterChat.body).toMatchObject({
        id: artifact.id,
        projectId: null,
        chatId: null,
        agentId: agent.id,
      });

      // 3. Delete the Agent
      await testApp.request().delete(`/api/v1/agents/${agent.id}`).expect(204);
      await testApp.request().get(`/api/v1/agents/${agent.id}`).expect(404);

      // Artifact still exists; all three foreign keys are now null
      const resAfterAgent = await testApp
        .request()
        .get(`/api/v1/artifacts/${artifact.id}`)
        .expect(200);
      expect(resAfterAgent.body).toMatchObject({
        id: artifact.id,
        title: artifact.title,
        projectId: null,
        chatId: null,
        agentId: null,
      });

      // Confirm directly in SQLite database
      const row = testApp.db.get<ArtifactRow>(
        'SELECT * FROM artifacts WHERE id = ?',
        [artifact.id],
      );
      expect(row).toBeDefined();
      expect(row!.project_id).toBeNull();
      expect(row!.chat_id).toBeNull();
      expect(row!.agent_id).toBeNull();
    });

    it('Order 2 (Chat -> Project -> Agent): artifact survives and nulls in alternative sequence', async () => {
      const { project, agent, chat, artifact } = seedSurvivalFixture();

      // 1. Delete Chat
      await testApp.request().delete(`/api/v1/chats/${chat.id}`).expect(204);

      const resAfterChat = await testApp
        .request()
        .get(`/api/v1/artifacts/${artifact.id}`)
        .expect(200);
      expect(resAfterChat.body).toMatchObject({
        id: artifact.id,
        projectId: project.id,
        chatId: null,
        agentId: agent.id,
      });

      // 2. Delete Project
      await testApp
        .request()
        .delete(`/api/v1/projects/${project.id}`)
        .expect(204);

      const resAfterProj = await testApp
        .request()
        .get(`/api/v1/artifacts/${artifact.id}`)
        .expect(200);
      expect(resAfterProj.body).toMatchObject({
        id: artifact.id,
        projectId: null,
        chatId: null,
        agentId: agent.id,
      });

      // 3. Delete Agent
      await testApp.request().delete(`/api/v1/agents/${agent.id}`).expect(204);

      const resAfterAgent = await testApp
        .request()
        .get(`/api/v1/artifacts/${artifact.id}`)
        .expect(200);
      expect(resAfterAgent.body).toMatchObject({
        id: artifact.id,
        projectId: null,
        chatId: null,
        agentId: null,
      });
    });

    it('Order 3 (Chat -> Agent -> Project): artifact survives when agent is deleted before project', async () => {
      const { project, agent, chat, artifact } = seedSurvivalFixture();

      // 1. Delete Chat
      await testApp.request().delete(`/api/v1/chats/${chat.id}`).expect(204);

      // 2. Delete Agent
      await testApp.request().delete(`/api/v1/agents/${agent.id}`).expect(204);

      const resAfterAgent = await testApp
        .request()
        .get(`/api/v1/artifacts/${artifact.id}`)
        .expect(200);
      expect(resAfterAgent.body).toMatchObject({
        id: artifact.id,
        projectId: project.id,
        chatId: null,
        agentId: null,
      });

      // 3. Delete Project
      await testApp
        .request()
        .delete(`/api/v1/projects/${project.id}`)
        .expect(204);

      const resFinal = await testApp
        .request()
        .get(`/api/v1/artifacts/${artifact.id}`)
        .expect(200);
      expect(resFinal.body).toMatchObject({
        id: artifact.id,
        projectId: null,
        chatId: null,
        agentId: null,
      });
    });

    it('Order 4 (Agent -> Project -> Chat): survival with team-backed chat', async () => {
      const project = testApp.fixtures.createProject({ name: 'Team Project' });
      const agent = testApp.fixtures.createAgent({ name: 'Specialist Agent' });
      const team = testApp.fixtures.createTeam({ name: 'Specialist Team' });
      testApp.fixtures.createTeamMember(team.id, agent.id);

      // Chat owned by team rather than agent directly
      const chat = testApp.fixtures.createChat({
        title: 'Team Collaboration Chat',
        project_id: project.id,
        team_id: team.id,
        agent_id: null,
      });

      const artifact = testApp.fixtures.createArtifact({
        title: 'Team Whitepaper',
        project_id: project.id,
        chat_id: chat.id,
        agent_id: agent.id,
      });

      // 1. Delete Agent first
      await testApp.request().delete(`/api/v1/agents/${agent.id}`).expect(204);

      const resAfterAgent = await testApp
        .request()
        .get(`/api/v1/artifacts/${artifact.id}`)
        .expect(200);
      expect(resAfterAgent.body).toMatchObject({
        id: artifact.id,
        projectId: project.id,
        chatId: chat.id,
        agentId: null,
      });

      // 2. Delete Project
      await testApp
        .request()
        .delete(`/api/v1/projects/${project.id}`)
        .expect(204);

      const resAfterProj = await testApp
        .request()
        .get(`/api/v1/artifacts/${artifact.id}`)
        .expect(200);
      expect(resAfterProj.body).toMatchObject({
        id: artifact.id,
        projectId: null,
        chatId: chat.id,
        agentId: null,
      });

      // Chat survived with null project_id
      const chatRow = testApp.db.get<ChatRow>(
        'SELECT * FROM chats WHERE id = ?',
        [chat.id],
      );
      expect(chatRow).toBeDefined();
      expect(chatRow!.project_id).toBeNull();

      // 3. Delete Chat
      await testApp.request().delete(`/api/v1/chats/${chat.id}`).expect(204);

      const resFinal = await testApp
        .request()
        .get(`/api/v1/artifacts/${artifact.id}`)
        .expect(200);
      expect(resFinal.body).toMatchObject({
        id: artifact.id,
        projectId: null,
        chatId: null,
        agentId: null,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Project Detachment (Direct Database Table Inspection)
  // ---------------------------------------------------------------------------
  describe('Project Detachment', () => {
    it('deleting a project leaves its chats and artifacts intact with null projectId (verified directly in tables)', async () => {
      const project = testApp.fixtures.createProject({
        name: 'Workspace Container',
      });
      const chat1 = testApp.fixtures.createChat({
        project_id: project.id,
        title: 'Project Chat 1',
      });
      const chat2 = testApp.fixtures.createChat({
        project_id: project.id,
        title: 'Project Chat 2',
      });

      const artInline = testApp.fixtures.createArtifact({
        project_id: project.id,
        title: 'Inline Spec',
        content: 'content...',
      });
      const artFile = testApp.fixtures.createArtifact({
        project_id: project.id,
        title: 'File Backed',
        content: null,
        file_path: 'artifacts/stored.bin',
      });

      // Pre-condition check in DB
      expect(
        testApp.db.get('SELECT id FROM projects WHERE id = ?', [project.id]),
      ).toBeDefined();
      expect(
        testApp.db.all('SELECT id FROM chats WHERE project_id = ?', [
          project.id,
        ]),
      ).toHaveLength(2);
      expect(
        testApp.db.all('SELECT id FROM artifacts WHERE project_id = ?', [
          project.id,
        ]),
      ).toHaveLength(2);

      // Execute deletion via API
      await testApp
        .request()
        .delete(`/api/v1/projects/${project.id}`)
        .expect(204);

      // 1. Projects table: row is completely removed
      const projectRow = testApp.db.get('SELECT * FROM projects WHERE id = ?', [
        project.id,
      ]);
      expect(projectRow).toBeUndefined();

      // 2. Chats table: both chats survived with project_id IS NULL
      const chatsInDb = testApp.db.all<{
        id: string;
        title: string;
        project_id: string | null;
      }>(
        'SELECT id, title, project_id FROM chats WHERE id IN (?, ?) ORDER BY title ASC',
        [chat1.id, chat2.id],
      );
      expect(chatsInDb).toHaveLength(2);
      expect(chatsInDb[0]).toEqual({
        id: chat1.id,
        title: 'Project Chat 1',
        project_id: null,
      });
      expect(chatsInDb[1]).toEqual({
        id: chat2.id,
        title: 'Project Chat 2',
        project_id: null,
      });

      // 3. Artifacts table: both artifacts survived with project_id IS NULL
      const artsInDb = testApp.db.all<{
        id: string;
        title: string;
        project_id: string | null;
      }>(
        'SELECT id, title, project_id FROM artifacts WHERE id IN (?, ?) ORDER BY title ASC',
        [artInline.id, artFile.id],
      );
      expect(artsInDb).toHaveLength(2);
      expect(artsInDb[0]).toEqual({
        id: artFile.id,
        title: 'File Backed',
        project_id: null,
      });
      expect(artsInDb[1]).toEqual({
        id: artInline.id,
        title: 'Inline Spec',
        project_id: null,
      });

      // 4. API endpoints also return 200 with projectId: null
      const chatRes = await testApp
        .request()
        .get(`/api/v1/chats/${chat1.id}`)
        .expect(200);
      expect(chatRes.body.projectId).toBeNull();

      const artRes = await testApp
        .request()
        .get(`/api/v1/artifacts/${artInline.id}`)
        .expect(200);
      expect(artRes.body.projectId).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Project Lifecycle & Consistency
  // ---------------------------------------------------------------------------
  describe('Project Lifecycle', () => {
    it('creates, lists, retrieves, updates, and deletes a project with full field consistency', async () => {
      // Create
      const createRes = await testApp
        .request()
        .post('/api/v1/projects')
        .send({
          name: 'End-to-End Alpha Project',
          description: 'A comprehensive lifecycle test project',
        })
        .expect(201);

      const created = createRes.body;
      expect(created.id).toBeDefined();
      expect(created.name).toBe('End-to-End Alpha Project');
      expect(created.description).toBe(
        'A comprehensive lifecycle test project',
      );
      expect(created.hasImage).toBe(false);
      expect(created.chatCount).toBe(0);
      expect(created.artifactCount).toBe(0);
      expect(created.createdAt).toBeDefined();
      expect(created.updatedAt).toBe(created.createdAt);
      expect(createRes.headers.location).toBe(`/api/v1/projects/${created.id}`);

      // List: assert consistency with create
      const listRes = await testApp
        .request()
        .get('/api/v1/projects')
        .expect(200);
      expect(listRes.body.total).toBe(1);
      const listed = listRes.body.items[0];
      expect(listed).toEqual(created);

      // Get: assert consistency with create and list
      const getRes = await testApp
        .request()
        .get(`/api/v1/projects/${created.id}`)
        .expect(200);
      expect(getRes.body).toEqual(created);

      // Update (PATCH)
      const patchRes = await testApp
        .request()
        .patch(`/api/v1/projects/${created.id}`)
        .send({
          name: 'Renamed Project Alpha',
          description: 'Updated description',
        })
        .expect(200);

      expect(patchRes.body.id).toBe(created.id);
      expect(patchRes.body.name).toBe('Renamed Project Alpha');
      expect(patchRes.body.description).toBe('Updated description');
      expect(patchRes.body.createdAt).toBe(created.createdAt);
      expect(patchRes.body.updatedAt > created.updatedAt).toBe(true);

      // Verify retrieval matches updated state
      const updatedGet = await testApp
        .request()
        .get(`/api/v1/projects/${created.id}`)
        .expect(200);
      expect(updatedGet.body).toEqual(patchRes.body);

      // Delete
      await testApp
        .request()
        .delete(`/api/v1/projects/${created.id}`)
        .expect(204);

      // Confirm removal from API and DB
      await testApp.request().get(`/api/v1/projects/${created.id}`).expect(404);
      const dbRow = testApp.db.get('SELECT * FROM projects WHERE id = ?', [
        created.id,
      ]);
      expect(dbRow).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Artifact Lifecycle & Consistency (Inline and File-backed)
  // ---------------------------------------------------------------------------
  describe('Artifact Lifecycle', () => {
    it('covers inline-content artifact lifecycle across create, list, retrieve, update, and delete', async () => {
      // 1. Create inline
      const createRes = await testApp
        .request()
        .post('/api/v1/artifacts')
        .send({
          title: 'Inline Algorithm Specification',
          type: 'code',
          mimeType: 'text/typescript',
          content: 'export function compute(): number { return 42; }',
        })
        .expect(201);

      const created = createRes.body;
      expect(created.id).toBeDefined();
      expect(created.title).toBe('Inline Algorithm Specification');
      expect(created.type).toBe('code');
      expect(created.mimeType).toBe('text/typescript');
      expect(created.content).toBe(
        'export function compute(): number { return 42; }',
      );
      expect(created.hasFile).toBe(false);
      expect(created.version).toBe(1);
      expect(createRes.headers.location).toBe(
        `/api/v1/artifacts/${created.id}`,
      );

      // 2. List: content is omitted from items, hasFile is false
      const listRes = await testApp
        .request()
        .get('/api/v1/artifacts')
        .expect(200);
      expect(listRes.body.total).toBe(1);
      const listItem = listRes.body.items[0];
      expect(listItem.id).toBe(created.id);
      expect(listItem.title).toBe(created.title);
      expect(listItem.hasFile).toBe(false);
      expect(listItem.content).toBeUndefined();
      expect(listItem.filePath).toBeUndefined();

      // 3. Get: returns full resource including content
      const getRes = await testApp
        .request()
        .get(`/api/v1/artifacts/${created.id}`)
        .expect(200);
      expect(getRes.body).toEqual(created);

      // 4. Update: version counter increments, updatedAt advances
      const patchRes = await testApp
        .request()
        .patch(`/api/v1/artifacts/${created.id}`)
        .send({
          title: 'Updated Algorithm Specification v2',
          content: 'export function compute(): number { return 100; }',
        })
        .expect(200);

      expect(patchRes.body.version).toBe(2);
      expect(patchRes.body.title).toBe('Updated Algorithm Specification v2');
      expect(patchRes.body.content).toBe(
        'export function compute(): number { return 100; }',
      );
      expect(patchRes.body.updatedAt > created.updatedAt).toBe(true);

      // 5. Delete
      await testApp
        .request()
        .delete(`/api/v1/artifacts/${created.id}`)
        .expect(204);

      // 6. Confirm removal
      await testApp
        .request()
        .get(`/api/v1/artifacts/${created.id}`)
        .expect(404);
      expect(
        testApp.db.get('SELECT * FROM artifacts WHERE id = ?', [created.id]),
      ).toBeUndefined();
    });

    it('covers file-backed artifact lifecycle across create, list, retrieve, update, and delete', async () => {
      const fileStorage = testApp.app.get(FileStorageService);
      const payload = Buffer.from(
        'Binary machine code payload\x00\x01\x02\x03',
      );
      const stored = await fileStorage.write('artifacts', payload);

      // 1. Create file-backed artifact
      const createRes = await testApp
        .request()
        .post('/api/v1/artifacts')
        .send({
          title: 'Kernel Driver Binary',
          type: 'file',
          mimeType: 'application/octet-stream',
          filePath: stored.reference,
        })
        .expect(201);

      const created = createRes.body;
      expect(created.id).toBeDefined();
      expect(created.title).toBe('Kernel Driver Binary');
      expect(created.type).toBe('file');
      expect(created.hasFile).toBe(true);
      expect(created.content).toBeNull();
      // Internal storage path is never exposed over the wire
      expect(created.filePath).toBeUndefined();
      expect(created.file_path).toBeUndefined();
      expect(created.version).toBe(1);

      // 2. List
      const listRes = await testApp
        .request()
        .get('/api/v1/artifacts')
        .expect(200);
      expect(listRes.body.total).toBe(1);
      expect(listRes.body.items[0]).toMatchObject({
        id: created.id,
        title: 'Kernel Driver Binary',
        hasFile: true,
      });
      expect(listRes.body.items[0].content).toBeUndefined();
      expect(listRes.body.items[0].filePath).toBeUndefined();

      // 3. Get
      const getRes = await testApp
        .request()
        .get(`/api/v1/artifacts/${created.id}`)
        .expect(200);
      expect(getRes.body).toEqual(created);

      // 4. Update title
      const patchRes = await testApp
        .request()
        .patch(`/api/v1/artifacts/${created.id}`)
        .send({ title: 'Kernel Driver Binary v2' })
        .expect(200);
      expect(patchRes.body.version).toBe(2);
      expect(patchRes.body.hasFile).toBe(true);

      // 5. Delete and verify backing file is unlinked from storage
      expect(await fileStorage.exists(stored.reference)).toBe(true);

      await testApp
        .request()
        .delete(`/api/v1/artifacts/${created.id}`)
        .expect(204);

      await testApp
        .request()
        .get(`/api/v1/artifacts/${created.id}`)
        .expect(404);
      expect(await fileStorage.exists(stored.reference)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. The content / filePath XOR Rule
  // ---------------------------------------------------------------------------
  describe('The content/filePath XOR Rule', () => {
    it('rejects creation when both content and filePath are supplied and writes nothing to the database', async () => {
      const initialCount = testApp.db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM artifacts',
      )!.count;

      const res = await testApp
        .request()
        .post('/api/v1/artifacts')
        .send({
          title: 'Contradictory Artifact',
          type: 'document',
          content: 'Inline text',
          filePath: 'artifacts/file.bin',
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.stringContaining('cannot define both content and filePath'),
        ]),
      );

      const afterCount = testApp.db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM artifacts',
      )!.count;
      expect(afterCount).toBe(initialCount);
    });

    it('rejects creation when neither content nor filePath is supplied and writes nothing to the database', async () => {
      const initialCount = testApp.db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM artifacts',
      )!.count;

      const res = await testApp
        .request()
        .post('/api/v1/artifacts')
        .send({
          title: 'Empty Void Artifact',
          type: 'document',
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.stringContaining('must define exactly one of content'),
        ]),
      );

      const afterCount = testApp.db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM artifacts',
      )!.count;
      expect(afterCount).toBe(initialCount);
    });

    it('succeeds when exactly one of content or filePath is provided', async () => {
      // 1. Only content
      const inlineRes = await testApp
        .request()
        .post('/api/v1/artifacts')
        .send({
          title: 'Inline Only',
          type: 'document',
          content: 'Just content',
        })
        .expect(201);
      expect(inlineRes.body.hasFile).toBe(false);
      expect(inlineRes.body.content).toBe('Just content');

      // 2. Only filePath
      const fileRes = await testApp
        .request()
        .post('/api/v1/artifacts')
        .send({
          title: 'File Only',
          type: 'file',
          filePath: 'artifacts/only-file.bin',
        })
        .expect(201);
      expect(fileRes.body.hasFile).toBe(true);
      expect(fileRes.body.content).toBeNull();
    });

    it('enforces the XOR rule on PATCH updates (rejects setting both or clearing both)', async () => {
      const artifact = testApp.fixtures.createArtifact({
        content: 'Original Content',
        file_path: null,
      });

      // Reject attempting to set both
      await testApp
        .request()
        .patch(`/api/v1/artifacts/${artifact.id}`)
        .send({
          content: 'New Content',
          filePath: 'artifacts/new-file.bin',
        })
        .expect(400);

      // Reject attempting to clear both
      await testApp
        .request()
        .patch(`/api/v1/artifacts/${artifact.id}`)
        .send({
          content: null,
          filePath: null,
        })
        .expect(400);

      // Switching from content to file succeeds
      const switchToFile = await testApp
        .request()
        .patch(`/api/v1/artifacts/${artifact.id}`)
        .send({
          content: null,
          filePath: 'artifacts/switched.bin',
        })
        .expect(200);
      expect(switchToFile.body.hasFile).toBe(true);
      expect(switchToFile.body.content).toBeNull();

      // Switching from file to content succeeds
      const switchToContent = await testApp
        .request()
        .patch(`/api/v1/artifacts/${artifact.id}`)
        .send({
          content: 'Back to inline content',
          filePath: null,
        })
        .expect(200);
      expect(switchToContent.body.hasFile).toBe(false);
      expect(switchToContent.body.content).toBe('Back to inline content');
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Content Retrieval, Streaming, and Content-Type Policy
  // ---------------------------------------------------------------------------
  describe('Content Retrieval & Security Policy', () => {
    it('returns inline content correctly including non-ASCII text with nosniff header', async () => {
      const utf8Text =
        '# Glaskäfer 🐞 & Käferkunde\n\n' +
        'Umlaute: Ä, Ö, Ü, ß, ä, ö, ü.\n' +
        'CJK Symbols: 玻璃甲虫, ガラスの甲虫.\n' +
        'Arabic: خنفساء زجاجية.\n' +
        'Math & Symbols: ∀x ∈ ℝ: x² ≥ 0, 🚀, 💻, 🛡️.';

      const artifact = testApp.fixtures.createArtifact({
        title: 'Multilingual Spec 🚀.md',
        type: 'document',
        content: utf8Text,
        file_path: null,
        mime_type: 'text/markdown',
      });

      const res = await testApp
        .request()
        .get(`/api/v1/artifacts/${artifact.id}/content`)
        .expect(200);

      expect(res.text).toBe(utf8Text);
      expect(res.headers['content-type']).toBe('text/markdown; charset=utf-8');
      expect(res.headers['content-length']).toBe(
        Buffer.byteLength(utf8Text, 'utf-8').toString(),
      );
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe(
        'private, max-age=0, must-revalidate',
      );
    });

    it('streams a large file without buffering the whole file and returns byte-for-byte identical content', async () => {
      const fileStorage = testApp.app.get(FileStorageService);

      // Generate a ~256 KiB binary payload with pseudorandom sequential pattern
      const binaryPayload = Buffer.alloc(256 * 1024);
      for (let i = 0; i < binaryPayload.length; i++) {
        binaryPayload[i] = (i * 31 + 7) % 256;
      }

      const stored = await fileStorage.write('artifacts', binaryPayload);
      const artifact = testApp.fixtures.createArtifact({
        title: 'LargePayload.bin',
        type: 'file',
        content: null,
        file_path: stored.reference,
        mime_type: 'application/octet-stream',
      });

      const streamSpy = vi.spyOn(fileStorage, 'createReadStream');

      const res = await testApp
        .request()
        .get(`/api/v1/artifacts/${artifact.id}/content`)
        .responseType('blob')
        .expect(200);

      // Verify that streaming method was invoked rather than reading the entire file at once
      expect(streamSpy).toHaveBeenCalledWith(stored.reference, undefined);

      // Byte-for-byte identity check
      expect(Buffer.compare(res.body, binaryPayload)).toBe(0);
      expect(res.headers['content-length']).toBe(
        binaryPayload.length.toString(),
      );
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('demotes text/html to application/octet-stream and forces attachment to prevent stored XSS', async () => {
      const htmlPayload =
        '<!DOCTYPE html><html><body><script>alert("xss")</script></body></html>';
      const artifact = testApp.fixtures.createArtifact({
        title: 'Exploit.html',
        type: 'document',
        content: htmlPayload,
        file_path: null,
        mime_type: 'text/html',
      });

      const res = await testApp
        .request()
        .get(`/api/v1/artifacts/${artifact.id}/content`)
        .expect(200);

      // Demoted to raw binary octet-stream so webview/browser refuses DOM rendering
      expect(res.headers['content-type']).toBe('application/octet-stream');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment;\s*filename="Exploit\.html"/,
      );
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.body).toEqual(Buffer.from(htmlPayload, 'utf-8'));
    });

    it('demotes image/svg+xml to application/octet-stream and forces attachment to prevent SVG script execution', async () => {
      const svgPayload =
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
      const artifact = testApp.fixtures.createArtifact({
        title: 'Drawing.svg',
        type: 'file',
        content: svgPayload,
        file_path: null,
        mime_type: 'image/svg+xml',
      });

      const res = await testApp
        .request()
        .get(`/api/v1/artifacts/${artifact.id}/content`)
        .expect(200);

      expect(res.headers['content-type']).toBe('application/octet-stream');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment;\s*filename="Drawing\.svg"/,
      );
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('falls back safely when mime_type is null without sniffing', async () => {
      const artifact = testApp.fixtures.createArtifact({
        title: 'RawFile.txt',
        content: 'plain text content',
        file_path: null,
        mime_type: null,
      });

      const res = await testApp
        .request()
        .get(`/api/v1/artifacts/${artifact.id}/content`)
        .expect(200);

      expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  // ---------------------------------------------------------------------------
  // 8. File and Row Consistency
  // ---------------------------------------------------------------------------
  describe('File and Row Consistency', () => {
    it('uploading a replacement project image deletes the old file and leaves exactly one', async () => {
      const fileStorage = testApp.app.get(FileStorageService);
      const project = testApp.fixtures.createProject({
        name: 'Cover Art Project',
      });

      // 1. First upload
      const upload1 = await testApp
        .request()
        .put(`/api/v1/projects/${project.id}/image`)
        .attach('file', validPng, 'cover-v1.png')
        .expect(200);
      expect(upload1.body.hasImage).toBe(true);

      const path1 = testApp.db.get<{ image_path: string }>(
        'SELECT image_path FROM projects WHERE id = ?',
        [project.id],
      )!.image_path;
      expect(await fileStorage.exists(path1)).toBe(true);

      // 2. Replacement upload
      const upload2 = await testApp
        .request()
        .put(`/api/v1/projects/${project.id}/image`)
        .attach('file', validJpeg, 'cover-v2.jpg')
        .expect(200);
      expect(upload2.body.hasImage).toBe(true);

      const path2 = testApp.db.get<{ image_path: string }>(
        'SELECT image_path FROM projects WHERE id = ?',
        [project.id],
      )!.image_path;

      expect(path2).not.toBe(path1);
      // Old file must be unlinked from disk
      expect(await fileStorage.exists(path1)).toBe(false);
      // New file must be present
      expect(await fileStorage.exists(path2)).toBe(true);
    });

    it('deleting a project removes its image file from storage', async () => {
      const fileStorage = testApp.app.get(FileStorageService);
      const project = testApp.fixtures.createProject({
        name: 'Project With Image To Delete',
      });

      await testApp
        .request()
        .put(`/api/v1/projects/${project.id}/image`)
        .attach('file', validPng, 'logo.png')
        .expect(200);

      const dbRow = testApp.db.get<{ image_path: string }>(
        'SELECT image_path FROM projects WHERE id = ?',
        [project.id],
      );
      expect(await fileStorage.exists(dbRow!.image_path)).toBe(true);

      // Delete the project
      await testApp
        .request()
        .delete(`/api/v1/projects/${project.id}`)
        .expect(204);

      // Verify file is gone from disk
      expect(await fileStorage.exists(dbRow!.image_path)).toBe(false);
    });

    it('deleting a file-backed artifact removes its backing file from storage', async () => {
      const fileStorage = testApp.app.get(FileStorageService);
      const stored = await fileStorage.write(
        'artifacts',
        Buffer.from('File content to be deleted'),
      );
      const artifact = testApp.fixtures.createArtifact({
        title: 'Temporary File Artifact',
        content: null,
        file_path: stored.reference,
      });

      expect(await fileStorage.exists(stored.reference)).toBe(true);

      await testApp
        .request()
        .delete(`/api/v1/artifacts/${artifact.id}`)
        .expect(204);

      expect(await fileStorage.exists(stored.reference)).toBe(false);
    });

    it('returns documented 404 ARTIFACT_FILE_NOT_FOUND when backing file is missing on disk without crashing', async () => {
      const fileStorage = testApp.app.get(FileStorageService);
      const stored = await fileStorage.write(
        'artifacts',
        Buffer.from('Doomed file'),
      );
      const artifact = testApp.fixtures.createArtifact({
        title: 'Missing File Artifact',
        content: null,
        file_path: stored.reference,
      });

      // Unlink backing file behind the server's back
      const resolved = await fileStorage.resolveAndVerify(stored.reference);
      await fs.unlink(resolved);

      const res = await testApp
        .request()
        .get(`/api/v1/artifacts/${artifact.id}/content`)
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('ARTIFACT_FILE_NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Upload Validation & Security
  // ---------------------------------------------------------------------------
  describe('Upload Validation', () => {
    it('rejects a non-image file disguised as an image with 415 UNSUPPORTED_MEDIA_TYPE', async () => {
      const project = testApp.fixtures.createProject({
        name: 'Disguised Upload Project',
      });
      const fakeImage = Buffer.from(
        'This is plain text with a .png extension pretending to be an image.',
      );

      const res = await testApp
        .request()
        .put(`/api/v1/projects/${project.id}/image`)
        .attach('file', fakeImage, 'fake.png')
        .expect(415);

      expect(res.body.statusCode).toBe(415);
      expect(res.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');

      const dbRow = testApp.db.get<{ image_path: string | null }>(
        'SELECT image_path FROM projects WHERE id = ?',
        [project.id],
      );
      expect(dbRow?.image_path).toBeNull();
    });

    it('rejects an over-size image file with 413 FILE_TOO_LARGE', async () => {
      const project = testApp.fixtures.createProject({
        name: 'Large Upload Project',
      });
      // Default max picture size is 5 MiB
      const hugeBuffer = Buffer.alloc(5 * 1024 * 1024 + 1024);
      validPng.copy(hugeBuffer, 0, 0, validPng.length);

      const res = await testApp
        .request()
        .put(`/api/v1/projects/${project.id}/image`)
        .attach('file', hugeBuffer, 'oversized.png')
        .expect(413);

      expect(res.body.statusCode).toBe(413);
      expect(res.body.code).toBe('FILE_TOO_LARGE');
    });

    it('stores file using server-generated UUIDv7 when client filename contains directory traversal ../', async () => {
      const fileStorage = testApp.app.get(FileStorageService);
      const project = testApp.fixtures.createProject({
        name: 'Path Traversal Upload Project',
      });

      await testApp
        .request()
        .put(`/api/v1/projects/${project.id}/image`)
        .attach('file', validPng, '../../../../../../etc/shadow.png')
        .expect(200);

      const dbRow = testApp.db.get<{ image_path: string }>(
        'SELECT image_path FROM projects WHERE id = ?',
        [project.id],
      );
      expect(dbRow?.image_path).toMatch(/^project-images\/[0-9a-f-]+\.png$/);
      expect(await fileStorage.exists(dbRow!.image_path)).toBe(true);

      // Verify containment: resolveAndVerify must succeed and stay inside storage root
      const resolved = await fileStorage.resolveAndVerify(dbRow!.image_path);
      expect(resolved.startsWith(fileStorage.storageRoot)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Version Behaviour Across Updates
  // ---------------------------------------------------------------------------
  describe('Version Behaviour Across Updates', () => {
    it('increments version counter on meaningful updates, preserves history, and leaves version untouched on no-op', async () => {
      const artifact = testApp.fixtures.createArtifact({
        title: 'Spec v1',
        content: 'Original draft',
        version: 1,
        created_at: '2026-09-01T10:00:00.000Z',
        updated_at: '2026-09-01T10:00:00.000Z',
      });

      // 1. Update title: version increments to 2
      const res1 = await testApp
        .request()
        .patch(`/api/v1/artifacts/${artifact.id}`)
        .send({ title: 'Spec v2' })
        .expect(200);
      expect(res1.body.version).toBe(2);
      expect(res1.body.updatedAt > artifact.updated_at).toBe(true);

      // Verify historical version 1 is preserved in artifact_versions
      const v1Row = testApp.db.get<{ version: number; title: string }>(
        'SELECT version, title FROM artifact_versions WHERE artifact_id = ? AND version = 1',
        [artifact.id],
      );
      expect(v1Row).toBeDefined();
      expect(v1Row?.title).toBe('Spec v1');

      // 2. Update content: version increments to 3
      const res2 = await testApp
        .request()
        .patch(`/api/v1/artifacts/${artifact.id}`)
        .send({ content: 'Second draft revision' })
        .expect(200);
      expect(res2.body.version).toBe(3);

      const v2Row = testApp.db.get<{ version: number; title: string }>(
        'SELECT version, title FROM artifact_versions WHERE artifact_id = ? AND version = 2',
        [artifact.id],
      );
      expect(v2Row).toBeDefined();
      expect(v2Row?.title).toBe('Spec v2');

      // 3. No-op empty patch: version does NOT increment, updatedAt does NOT bump
      const res3 = await testApp
        .request()
        .patch(`/api/v1/artifacts/${artifact.id}`)
        .send({})
        .expect(200);
      expect(res3.body.version).toBe(3);
      expect(res3.body.updatedAt).toBe(res2.body.updatedAt);
    });
  });

  // ---------------------------------------------------------------------------
  // 11. Filtering and Pagination
  // ---------------------------------------------------------------------------
  describe('Filtering and Pagination', () => {
    describe('Projects List Endpoint', () => {
      it('supports pagination via limit and offset', async () => {
        testApp.fixtures.createProject({ name: 'Alpha Project' });
        testApp.fixtures.createProject({ name: 'Beta Project' });
        testApp.fixtures.createProject({ name: 'Gamma Project' });

        const page1 = await testApp
          .request()
          .get('/api/v1/projects?limit=2&offset=0&sort=name&order=asc')
          .expect(200);
        expect(page1.body.total).toBe(3);
        expect(page1.body.items).toHaveLength(2);
        expect(page1.body.items[0].name).toBe('Alpha Project');
        expect(page1.body.items[1].name).toBe('Beta Project');

        const page2 = await testApp
          .request()
          .get('/api/v1/projects?limit=2&offset=2&sort=name&order=asc')
          .expect(200);
        expect(page2.body.total).toBe(3);
        expect(page2.body.items).toHaveLength(1);
        expect(page2.body.items[0].name).toBe('Gamma Project');
      });

      it('computes chatCount and artifactCount correctly for listed projects', async () => {
        const proj = testApp.fixtures.createProject({ name: 'Counted Proj' });
        testApp.fixtures.createChat({ project_id: proj.id });
        testApp.fixtures.createChat({ project_id: proj.id });
        testApp.fixtures.createArtifact({ project_id: proj.id });

        const res = await testApp.request().get('/api/v1/projects').expect(200);
        const item = res.body.items.find((p: any) => p.id === proj.id);
        expect(item).toMatchObject({
          chatCount: 2,
          artifactCount: 1,
        });
      });
    });

    describe('Artifacts List Endpoint', () => {
      it('filters artifacts by projectId (including "null" for unassigned artifacts)', async () => {
        const p1 = testApp.fixtures.createProject({ name: 'P1' });
        const a1 = testApp.fixtures.createArtifact({
          title: 'A1',
          project_id: p1.id,
        });
        const a2 = testApp.fixtures.createArtifact({
          title: 'Unfiled',
          project_id: null,
        });

        const p1Res = await testApp
          .request()
          .get(`/api/v1/artifacts?projectId=${p1.id}`)
          .expect(200);
        expect(p1Res.body.total).toBe(1);
        expect(p1Res.body.items[0].id).toBe(a1.id);

        const unfiledRes = await testApp
          .request()
          .get('/api/v1/artifacts?projectId=null')
          .expect(200);
        expect(unfiledRes.body.total).toBe(1);
        expect(unfiledRes.body.items[0].id).toBe(a2.id);
      });

      it('filters artifacts by chatId, agentId, and type', async () => {
        const chat = testApp.fixtures.createChat();
        const agent = testApp.fixtures.createAgent();

        const art = testApp.fixtures.createArtifact({
          title: 'Target Artifact',
          chat_id: chat.id,
          agent_id: agent.id,
          type: 'code',
        });
        testApp.fixtures.createArtifact({
          title: 'Other Artifact',
          type: 'document',
        });

        // Filter by chatId
        const chatRes = await testApp
          .request()
          .get(`/api/v1/artifacts?chatId=${chat.id}`)
          .expect(200);
        expect(chatRes.body.total).toBe(1);
        expect(chatRes.body.items[0].id).toBe(art.id);

        // Filter by agentId
        const agentRes = await testApp
          .request()
          .get(`/api/v1/artifacts?agentId=${agent.id}`)
          .expect(200);
        expect(agentRes.body.total).toBe(1);
        expect(agentRes.body.items[0].id).toBe(art.id);

        // Filter by type
        const typeRes = await testApp
          .request()
          .get('/api/v1/artifacts?type=code')
          .expect(200);
        expect(typeRes.body.total).toBe(1);
        expect(typeRes.body.items[0].id).toBe(art.id);
      });

      it('filters artifacts by search query substring matching title', async () => {
        testApp.fixtures.createArtifact({ title: 'Microservice Design Draft' });
        testApp.fixtures.createArtifact({ title: 'Frontend UI Mockup' });

        const res = await testApp
          .request()
          .get('/api/v1/artifacts?search=Microservice')
          .expect(200);
        expect(res.body.total).toBe(1);
        expect(res.body.items[0].title).toBe('Microservice Design Draft');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 12. Not-found and Validation Paths for Every Endpoint
  // ---------------------------------------------------------------------------
  describe('Not-found and Validation Paths', () => {
    describe('Projects Endpoints Validation & Errors', () => {
      it('POST /api/v1/projects: rejects invalid payload (empty name, name too long, client id)', async () => {
        // Missing name
        await testApp.request().post('/api/v1/projects').send({}).expect(400);

        // Empty string name
        await testApp
          .request()
          .post('/api/v1/projects')
          .send({ name: '   ' })
          .expect(400);

        // Name exceeding limit
        await testApp
          .request()
          .post('/api/v1/projects')
          .send({ name: 'a'.repeat(MAX_PROJECT_NAME_LENGTH + 1) })
          .expect(400);

        // Description exceeding limit
        await testApp
          .request()
          .post('/api/v1/projects')
          .send({
            name: 'Valid Name',
            description: 'd'.repeat(MAX_PROJECT_DESCRIPTION_LENGTH + 1),
          })
          .expect(400);

        // Server-managed fields rejected
        await testApp
          .request()
          .post('/api/v1/projects')
          .send({
            name: 'Project',
            id: newId(),
          })
          .expect(400);
      });

      it('GET /api/v1/projects/:id: returns 404 for unknown or non-existent project', async () => {
        const notFoundRes = await testApp
          .request()
          .get('/api/v1/projects/018f3a9e-0000-7000-8000-000000000404')
          .expect(404);
        expect(notFoundRes.body.code).toBe('PROJECT_NOT_FOUND');

        const unknownRes = await testApp
          .request()
          .get('/api/v1/projects/unknown-project-id')
          .expect(404);
        expect(unknownRes.body.code).toBe('PROJECT_NOT_FOUND');
      });

      it('PATCH /api/v1/projects/:id: returns 400 for invalid body and 404 for non-existent project', async () => {
        const project = testApp.fixtures.createProject();

        // Name set to null is rejected
        await testApp
          .request()
          .patch(`/api/v1/projects/${project.id}`)
          .send({ name: null })
          .expect(400);

        // Non-existent ID
        const res = await testApp
          .request()
          .patch('/api/v1/projects/018f3a9e-0000-7000-8000-000000000404')
          .send({ name: 'New Name' })
          .expect(404);
        expect(res.body.code).toBe('PROJECT_NOT_FOUND');
      });

      it('DELETE /api/v1/projects/:id: returns 404 for non-existent project ID', async () => {
        const res = await testApp
          .request()
          .delete('/api/v1/projects/018f3a9e-0000-7000-8000-000000000404')
          .expect(404);
        expect(res.body.code).toBe('PROJECT_NOT_FOUND');

        const nonUuidRes = await testApp
          .request()
          .delete('/api/v1/projects/unknown-id')
          .expect(404);
        expect(nonUuidRes.body.code).toBe('PROJECT_NOT_FOUND');
      });

      it('PUT /api/v1/projects/:id/image: returns 400 when file is missing and 404 for non-existent project', async () => {
        const project = testApp.fixtures.createProject();

        // Missing file
        const missingRes = await testApp
          .request()
          .put(`/api/v1/projects/${project.id}/image`)
          .expect(400);
        expect(missingRes.body.code).toBe('MISSING_FILE');

        // Non-existent project
        const notFoundRes = await testApp
          .request()
          .put('/api/v1/projects/018f3a9e-0000-7000-8000-000000000404/image')
          .attach('file', validPng, 'cover.png')
          .expect(404);
        expect(notFoundRes.body.code).toBe('PROJECT_NOT_FOUND');
      });
    });

    describe('Artifacts Endpoints Validation & Errors', () => {
      it('POST /api/v1/artifacts: validates title, type, and rejects non-existent parent foreign keys with 422', async () => {
        // Missing title
        await testApp
          .request()
          .post('/api/v1/artifacts')
          .send({ type: 'document', content: 'test' })
          .expect(400);

        // Title exceeding length limit
        await testApp
          .request()
          .post('/api/v1/artifacts')
          .send({
            title: 'a'.repeat(MAX_ARTIFACT_TITLE_LENGTH + 1),
            type: 'document',
            content: 'test',
          })
          .expect(400);

        // Invalid type
        await testApp
          .request()
          .post('/api/v1/artifacts')
          .send({
            title: 'Title',
            type: 'invalid-type-choice',
            content: 'test',
          })
          .expect(400);

        // Non-existent projectId reference returns 422
        const p422 = await testApp
          .request()
          .post('/api/v1/artifacts')
          .send({
            title: 'Linked',
            type: 'document',
            content: 'test',
            projectId: '018f3a9e-0000-7000-8000-000000000404',
          })
          .expect(422);
        expect(p422.body.code).toBe('PROJECT_NOT_FOUND');

        // Non-existent chatId reference returns 422
        const c422 = await testApp
          .request()
          .post('/api/v1/artifacts')
          .send({
            title: 'Linked',
            type: 'document',
            content: 'test',
            chatId: '018f3a9e-0000-7000-8000-000000000404',
          })
          .expect(422);
        expect(c422.body.code).toBe('CHAT_NOT_FOUND');

        // Non-existent agentId reference returns 422
        const a422 = await testApp
          .request()
          .post('/api/v1/artifacts')
          .send({
            title: 'Linked',
            type: 'document',
            content: 'test',
            agentId: '018f3a9e-0000-7000-8000-000000000404',
          })
          .expect(422);
        expect(a422.body.code).toBe('AGENT_NOT_FOUND');
      });

      it('GET /api/v1/artifacts/:id: returns 400 for malformed UUID and 404 for non-existent artifact', async () => {
        const badId = await testApp
          .request()
          .get('/api/v1/artifacts/not-uuid')
          .expect(400);
        expect(badId.body.code).toBe('INVALID_IDENTIFIER');

        const notFound = await testApp
          .request()
          .get('/api/v1/artifacts/018f3a9e-0000-7000-8000-000000000404')
          .expect(404);
        expect(notFound.body.code).toBe('ARTIFACT_NOT_FOUND');
      });

      it('GET /api/v1/artifacts/:id/content: returns 404 for non-existent artifact or empty artifact', async () => {
        await testApp
          .request()
          .get('/api/v1/artifacts/018f3a9e-0000-7000-8000-000000000404/content')
          .expect(404);

        // Artifact row having neither content nor file_path
        const emptyId = newId();
        testApp.db.run(
          `INSERT INTO artifacts (id, title, type, content, file_path, version, created_at, updated_at)
           VALUES (?, 'Empty Row', 'document', NULL, NULL, 1, ?, ?)`,
          [emptyId, new Date().toISOString(), new Date().toISOString()],
        );

        const res = await testApp
          .request()
          .get(`/api/v1/artifacts/${emptyId}/content`)
          .expect(404);
        expect(res.body.code).toBe('ARTIFACT_CONTENT_NOT_FOUND');
      });

      it('PATCH /api/v1/artifacts/:id: returns 404 for non-existent artifact and 422 for non-existent parent reference', async () => {
        await testApp
          .request()
          .patch('/api/v1/artifacts/018f3a9e-0000-7000-8000-000000000404')
          .send({ title: 'New' })
          .expect(404);

        const artifact = testApp.fixtures.createArtifact();
        const res = await testApp
          .request()
          .patch(`/api/v1/artifacts/${artifact.id}`)
          .send({
            projectId: '018f3a9e-0000-7000-8000-000000000404',
          })
          .expect(422);
        expect(res.body.code).toBe('PROJECT_NOT_FOUND');
      });

      it('DELETE /api/v1/artifacts/:id: returns 400 for malformed UUID and 404 for non-existent artifact', async () => {
        await testApp
          .request()
          .delete('/api/v1/artifacts/invalid-id')
          .expect(400);

        await testApp
          .request()
          .delete('/api/v1/artifacts/018f3a9e-0000-7000-8000-000000000404')
          .expect(404);
      });
    });
  });
});
