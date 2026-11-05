import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FileStorageService } from '../src/file-storage/file-storage.service.js';
import {
  MAX_PROJECT_DESCRIPTION_LENGTH,
  MAX_PROJECT_NAME_LENGTH,
} from '../src/modules/projects/dto/create-project.dto.js';
import { createTestApp, type TestApp } from './harness/index.js';

describe('Projects Endpoints (e2e)', () => {
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

  describe('GET /api/v1/projects', () => {
    it('returns 200 with an empty paginated collection when there are none', async () => {
      const res = await testApp.request().get('/api/v1/projects').expect(200);

      expect(res.body).toEqual({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      });
    });

    it('returns a paginated list of created projects with hasImage, chatCount, artifactCount', async () => {
      const p1 = testApp.fixtures.createProject({
        name: 'Project Alpha',
        description: 'First project',
      });
      const p2 = testApp.fixtures.createProject({
        name: 'Project Beta',
        image_path: 'pictures/sample.png',
      });

      testApp.fixtures.createChat({ project_id: p1.id });
      testApp.fixtures.createArtifact({ project_id: p1.id });

      const res = await testApp.request().get('/api/v1/projects').expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.limit).toBe(50);
      expect(res.body.offset).toBe(0);

      const alpha = res.body.items.find((p: any) => p.id === p1.id);
      expect(alpha).toMatchObject({
        id: p1.id,
        name: 'Project Alpha',
        description: 'First project',
        hasImage: false,
        chatCount: 1,
        artifactCount: 1,
      });
      // Ensure image_path is never exposed verbatim
      expect(alpha.image_path).toBeUndefined();
      expect(alpha.imagePath).toBeUndefined();

      const beta = res.body.items.find((p: any) => p.id === p2.id);
      expect(beta).toMatchObject({
        id: p2.id,
        name: 'Project Beta',
        hasImage: true,
        chatCount: 0,
        artifactCount: 0,
      });
      expect(beta.image_path).toBeUndefined();
    });

    it('supports pagination query parameters (limit and offset)', async () => {
      testApp.fixtures.createProject({ name: 'Project 1' });
      testApp.fixtures.createProject({ name: 'Project 2' });
      testApp.fixtures.createProject({ name: 'Project 3' });

      const page1 = await testApp
        .request()
        .get('/api/v1/projects?limit=2&offset=0&sort=name&order=asc')
        .expect(200);

      expect(page1.body.total).toBe(3);
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.items[0].name).toBe('Project 1');
      expect(page1.body.items[1].name).toBe('Project 2');

      const page2 = await testApp
        .request()
        .get('/api/v1/projects?limit=2&offset=2&sort=name&order=asc')
        .expect(200);

      expect(page2.body.total).toBe(3);
      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.items[0].name).toBe('Project 3');
    });

    it('supports sorting query parameters', async () => {
      testApp.fixtures.createProject({ name: 'Alpha' });
      testApp.fixtures.createProject({ name: 'Beta' });

      const asc = await testApp
        .request()
        .get('/api/v1/projects?sort=name&order=asc')
        .expect(200);
      expect(asc.body.items[0].name).toBe('Alpha');
      expect(asc.body.items[1].name).toBe('Beta');

      const desc = await testApp
        .request()
        .get('/api/v1/projects?sort=name&order=desc')
        .expect(200);
      expect(desc.body.items[0].name).toBe('Beta');
      expect(desc.body.items[1].name).toBe('Alpha');
    });

    it('supports filtering by name substring search including % and _', async () => {
      testApp.fixtures.createProject({ name: 'Special 100% Core' });
      testApp.fixtures.createProject({ name: 'Standard Core' });
      testApp.fixtures.createProject({ name: 'A_B' });
      testApp.fixtures.createProject({ name: 'AXB' });

      const percentRes = await testApp
        .request()
        .get('/api/v1/projects?name=%')
        .expect(200);
      expect(percentRes.body.total).toBe(1);
      expect(percentRes.body.items[0].name).toBe('Special 100% Core');

      const underscoreRes = await testApp
        .request()
        .get('/api/v1/projects?name=_')
        .expect(200);
      expect(underscoreRes.body.total).toBe(1);
      expect(underscoreRes.body.items[0].name).toBe('A_B');
    });

    it('rejects invalid sort column with 400 Bad Request', async () => {
      const res = await testApp
        .request()
        .get('/api/v1/projects?sort=maliciousColumn')
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('rejects invalid pagination bounds with 400 Bad Request', async () => {
      await testApp.request().get('/api/v1/projects?limit=0').expect(400);
      await testApp.request().get('/api/v1/projects?limit=101').expect(400);
      await testApp.request().get('/api/v1/projects?offset=-1').expect(400);
    });
  });

  describe('GET /api/v1/projects/:projectId', () => {
    it('returns a project by ID with 200 OK', async () => {
      const project = testApp.fixtures.createProject({
        name: 'Single Project',
        description: 'Single Description',
      });
      testApp.fixtures.createChat({ project_id: project.id });
      testApp.fixtures.createArtifact({ project_id: project.id });
      testApp.fixtures.createArtifact({ project_id: project.id });

      const res = await testApp
        .request()
        .get(`/api/v1/projects/${project.id}`)
        .expect(200);

      expect(res.body).toMatchObject({
        id: project.id,
        name: 'Single Project',
        description: 'Single Description',
        hasImage: false,
        chatCount: 1,
        artifactCount: 2,
        createdAt: project.created_at,
        updatedAt: project.updated_at,
      });
      expect(res.body.image_path).toBeUndefined();
      expect(res.body.imagePath).toBeUndefined();
    });

    it('returns 404 for unknown project ID', async () => {
      const res = await testApp
        .request()
        .get('/api/v1/projects/018f3a9e-0000-7000-8000-000000000404')
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('PROJECT_NOT_FOUND');
    });

    it('returns 404 for non-existent non-uuid path parameter', async () => {
      const res = await testApp
        .request()
        .get('/api/v1/projects/unknown-project')
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('PROJECT_NOT_FOUND');
    });
  });

  describe('POST /api/v1/projects', () => {
    it('creates a project with name and returns 201 with generated id, timestamps and Location header', async () => {
      const payload = {
        name: 'Created Project',
        description: 'Created description',
      };

      const res = await testApp
        .request()
        .post('/api/v1/projects')
        .send(payload)
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Created Project');
      expect(res.body.description).toBe('Created description');
      expect(res.body.hasImage).toBe(false);
      expect(res.body.chatCount).toBe(0);
      expect(res.body.artifactCount).toBe(0);
      expect(res.body.createdAt).toBeDefined();
      expect(res.body.updatedAt).toBe(res.body.createdAt);
      expect(res.body.image_path).toBeUndefined();

      expect(res.headers.location).toBe(`/api/v1/projects/${res.body.id}`);

      // Verify persistence in SQLite
      const inDb = testApp.db.get<{
        id: string;
        name: string;
        description: string;
        image_path: string | null;
      }>('SELECT * FROM projects WHERE id = ?', [res.body.id]);
      expect(inDb).toBeDefined();
      expect(inDb?.name).toBe('Created Project');
      expect(inDb?.image_path).toBeNull();
    });

    it('returns 400 when creating without a name', async () => {
      const res = await testApp
        .request()
        .post('/api/v1/projects')
        .send({ description: 'No name provided' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('returns 400 when name is empty string or only whitespace', async () => {
      await testApp
        .request()
        .post('/api/v1/projects')
        .send({ name: '' })
        .expect(400);

      await testApp
        .request()
        .post('/api/v1/projects')
        .send({ name: '   ' })
        .expect(400);
    });

    it('returns 400 when name exceeds maximum length', async () => {
      await testApp
        .request()
        .post('/api/v1/projects')
        .send({ name: 'a'.repeat(MAX_PROJECT_NAME_LENGTH + 1) })
        .expect(400);
    });

    it('returns 400 when description exceeds maximum length', async () => {
      await testApp
        .request()
        .post('/api/v1/projects')
        .send({
          name: 'Valid Name',
          description: 'a'.repeat(MAX_PROJECT_DESCRIPTION_LENGTH + 1),
        })
        .expect(400);
    });

    it('rejects client-supplied id, createdAt, updatedAt, image, image_path or hasImage', async () => {
      for (const field of [
        'id',
        'createdAt',
        'updatedAt',
        'image',
        'image_path',
        'hasImage',
      ]) {
        const res = await testApp
          .request()
          .post('/api/v1/projects')
          .send({ name: 'Project', [field]: 'forbidden' })
          .expect(400);

        expect(res.body.statusCode).toBe(400);
      }
    });
  });

  describe('PATCH /api/v1/projects/:projectId', () => {
    it('partially updates only the supplied fields; updated_at advances, created_at does not', async () => {
      const project = testApp.fixtures.createProject({
        name: 'Original Name',
        description: 'Original Description',
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
      });

      const res = await testApp
        .request()
        .patch(`/api/v1/projects/${project.id}`)
        .send({ name: 'New Name' })
        .expect(200);

      expect(res.body.name).toBe('New Name');
      expect(res.body.description).toBe('Original Description');
      expect(res.body.createdAt).toBe('2026-09-01T00:00:00.000Z');
      expect(res.body.updatedAt).not.toBe('2026-09-01T00:00:00.000Z');
    });

    it('setting name to null returns 400 Bad Request', async () => {
      const project = testApp.fixtures.createProject({ name: 'Valid Project' });

      const res = await testApp
        .request()
        .patch(`/api/v1/projects/${project.id}`)
        .send({ name: null })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('setting description to null clears it', async () => {
      const project = testApp.fixtures.createProject({
        name: 'Project',
        description: 'To be cleared',
      });

      const res = await testApp
        .request()
        .patch(`/api/v1/projects/${project.id}`)
        .send({ description: null })
        .expect(200);

      expect(res.body.name).toBe('Project');
      expect(res.body.description).toBeNull();

      const inDb = testApp.db.get<{ description: string | null }>(
        'SELECT description FROM projects WHERE id = ?',
        [project.id],
      );
      expect(inDb?.description).toBeNull();
    });

    it('empty update payload does not bump updatedAt', async () => {
      const project = testApp.fixtures.createProject({
        name: 'Project',
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
      });

      const res = await testApp
        .request()
        .patch(`/api/v1/projects/${project.id}`)
        .send({})
        .expect(200);

      expect(res.body.updatedAt).toBe('2026-09-01T00:00:00.000Z');
    });

    it('returns 404 when updating non-existent project ID', async () => {
      const res = await testApp
        .request()
        .patch('/api/v1/projects/018f3a9e-0000-7000-8000-000000000404')
        .send({ name: 'Doesn Not Exist' })
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('PROJECT_NOT_FOUND');
    });
  });

  describe('DELETE /api/v1/projects/:projectId', () => {
    it('deletes an existing project and returns 204 No Content', async () => {
      const project = testApp.fixtures.createProject({ name: 'To Delete' });

      await testApp
        .request()
        .delete(`/api/v1/projects/${project.id}`)
        .expect(204);

      // Verify row is gone
      await testApp
        .request()
        .get(`/api/v1/projects/${project.id}`)
        .expect(404);
    });

    it('returns 404 when deleting unknown project ID', async () => {
      const res = await testApp
        .request()
        .delete('/api/v1/projects/018f3a9e-0000-7000-8000-000000000404')
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('PROJECT_NOT_FOUND');
    });

    it('asserts ON DELETE SET NULL cascade: deleting project leaves chats and artifacts intact with null projectId', async () => {
      const project = testApp.fixtures.createProject({ name: 'Main Workspace' });
      const chat = testApp.fixtures.createChat({
        project_id: project.id,
        title: 'Project Chat',
      });
      const artifact = testApp.fixtures.createArtifact({
        project_id: project.id,
        title: 'Project Architecture Spec',
      });

      await testApp
        .request()
        .delete(`/api/v1/projects/${project.id}`)
        .expect(204);

      // Project row is deleted
      const projectRow = testApp.db.get(
        'SELECT * FROM projects WHERE id = ?',
        [project.id],
      );
      expect(projectRow).toBeUndefined();

      // Referencing chat survived with null project_id
      const chatRow = testApp.db.get<{
        id: string;
        title: string;
        project_id: string | null;
      }>('SELECT id, title, project_id FROM chats WHERE id = ?', [chat.id]);
      expect(chatRow).toBeDefined();
      expect(chatRow?.title).toBe('Project Chat');
      expect(chatRow?.project_id).toBeNull();

      // Referencing artifact survived with null project_id
      const artifactRow = testApp.db.get<{
        id: string;
        title: string;
        project_id: string | null;
      }>('SELECT id, title, project_id FROM artifacts WHERE id = ?', [
        artifact.id,
      ]);
      expect(artifactRow).toBeDefined();
      expect(artifactRow?.title).toBe('Project Architecture Spec');
      expect(artifactRow?.project_id).toBeNull();
    });

    it('deletes a project with an image and asserts the image file is removed from storage', async () => {
      const fileStorage = testApp.app.get(FileStorageService);
      // Valid PNG signature
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      ]);

      const stored = await fileStorage.write('pictures', pngBuffer);
      expect(await fileStorage.exists(stored.reference)).toBe(true);

      const project = testApp.fixtures.createProject({
        name: 'Project with Icon',
        image_path: stored.reference,
      });

      await testApp
        .request()
        .delete(`/api/v1/projects/${project.id}`)
        .expect(204);

      // Assert image file is removed from disk
      expect(await fileStorage.exists(stored.reference)).toBe(false);
    });
  });
});

