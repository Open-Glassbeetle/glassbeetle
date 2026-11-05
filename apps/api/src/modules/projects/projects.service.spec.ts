import { BadRequestException, NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../database/database.service.js';
import type { FileStorageService } from '../../file-storage/file-storage.service.js';
import { TestFixtures } from '../../../test/harness/fixtures.js';
import { ProjectsService } from './projects.service.js';
import type { CreateProjectDto } from './dto/create-project.dto.js';

describe('ProjectsService', () => {
  let db: DatabaseService;
  let fixtures: TestFixtures;
  let fileStorage: FileStorageService;
  let service: ProjectsService;

  beforeEach(() => {
    db = new DatabaseService();
    db.connect(':memory:');
    fixtures = new TestFixtures(db);
    fileStorage = {
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as FileStorageService;
    service = new ProjectsService(db, fileStorage);
  });

  afterEach(() => {
    db.close();
  });

  describe('findAll', () => {
    it('returns an empty paginated collection when no projects exist', async () => {
      const result = await service.findAll({});

      expect(result).toEqual({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      });
    });

    it('returns stored projects with default pagination limit and offset', async () => {
      fixtures.createProject({ name: 'Project A' });
      fixtures.createProject({ name: 'Project B' });

      const result = await service.findAll({});

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
    });

    it('filters projects by name substring search', async () => {
      fixtures.createProject({ name: 'Alpha Compiler' });
      fixtures.createProject({ name: 'Beta Runtime' });

      const result = await service.findAll({ name: 'Compiler' });

      expect(result.total).toBe(1);
      expect(result.items[0].name).toBe('Alpha Compiler');
    });

    it('filters projects using the search alias', async () => {
      fixtures.createProject({ name: 'Alpha Compiler' });
      fixtures.createProject({ name: 'Beta Runtime' });

      const result = await service.findAll({ search: 'Runtime' });

      expect(result.total).toBe(1);
      expect(result.items[0].name).toBe('Beta Runtime');
    });

    it('escapes % and _ in the search term so they are treated literally', async () => {
      fixtures.createProject({ name: '100% Complete' });
      fixtures.createProject({ name: '1000 Total' });
      fixtures.createProject({ name: 'A_B' });
      fixtures.createProject({ name: 'AXB' });

      const percentResult = await service.findAll({ name: '%' });
      expect(percentResult.total).toBe(1);
      expect(percentResult.items[0].name).toBe('100% Complete');

      const underscoreResult = await service.findAll({ name: '_' });
      expect(underscoreResult.total).toBe(1);
      expect(underscoreResult.items[0].name).toBe('A_B');
    });

    it('supports custom limit and offset pagination boundaries', async () => {
      fixtures.createProject({ name: 'P1' });
      fixtures.createProject({ name: 'P2' });
      fixtures.createProject({ name: 'P3' });

      const page1 = await service.findAll({
        limit: 2,
        offset: 0,
        sort: 'name',
        order: 'asc',
      });
      expect(page1.total).toBe(3);
      expect(page1.items).toHaveLength(2);
      expect(page1.items[0].name).toBe('P1');
      expect(page1.items[1].name).toBe('P2');

      const page2 = await service.findAll({
        limit: 2,
        offset: 2,
        sort: 'name',
        order: 'asc',
      });
      expect(page2.total).toBe(3);
      expect(page2.items).toHaveLength(1);
      expect(page2.items[0].name).toBe('P3');
    });

    it('sorts projects by name and timestamps', async () => {
      fixtures.createProject({ name: 'Zeta' });
      fixtures.createProject({ name: 'Alpha' });

      const asc = await service.findAll({ sort: 'name', order: 'asc' });
      expect(asc.items[0].name).toBe('Alpha');
      expect(asc.items[1].name).toBe('Zeta');

      const desc = await service.findAll({ sort: 'name', order: 'desc' });
      expect(desc.items[0].name).toBe('Zeta');
      expect(desc.items[1].name).toBe('Alpha');
    });

    it('throws BadRequestException when sorting by an invalid column', async () => {
      await expect(
        service.findAll({ sort: 'unsupportedColumn' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('includes chatCount and artifactCount aggregates for each project', async () => {
      const p1 = fixtures.createProject({ name: 'Active Project' });
      const p2 = fixtures.createProject({ name: 'Empty Project' });

      fixtures.createChat({ project_id: p1.id });
      fixtures.createChat({ project_id: p1.id });
      fixtures.createArtifact({ project_id: p1.id });

      const result = await service.findAll({ sort: 'name', order: 'asc' });
      expect(result.items).toHaveLength(2);

      const active = result.items.find((p) => p.id === p1.id);
      expect(active?.chatCount).toBe(2);
      expect(active?.artifactCount).toBe(1);

      const empty = result.items.find((p) => p.id === p2.id);
      expect(empty?.chatCount).toBe(0);
      expect(empty?.artifactCount).toBe(0);
    });
  });

  describe('findById and findOne', () => {
    it('returns a project by ID with its chat and artifact counts', async () => {
      const project = fixtures.createProject({
        name: 'My Project',
        description: 'Details',
      });
      fixtures.createChat({ project_id: project.id });
      fixtures.createArtifact({ project_id: project.id });
      fixtures.createArtifact({ project_id: project.id });

      const found = await service.findOne(project.id);

      expect(found.id).toBe(project.id);
      expect(found.name).toBe('My Project');
      expect(found.description).toBe('Details');
      expect(found.hasImage).toBe(false);
      expect(found.chatCount).toBe(1);
      expect(found.artifactCount).toBe(2);
      expect(found.createdAt).toBe(project.created_at);
      expect(found.updatedAt).toBe(project.updated_at);
    });

    it('findById returns null for unknown ID', async () => {
      const result = await service.findById('non-existent-id');
      expect(result).toBeNull();
    });

    it('findOne throws NotFoundException (404) for unknown ID', async () => {
      await expect(service.findOne('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );

      try {
        await service.findOne('018f3a9e-0000-7000-8000-000000000404');
      } catch (err: any) {
        expect(err).toBeInstanceOf(NotFoundException);
        expect(err.getResponse()).toMatchObject({
          code: 'PROJECT_NOT_FOUND',
        });
      }
    });
  });

  describe('create', () => {
    it('creates a new project with server-generated ID and timestamps', async () => {
      const dto: CreateProjectDto = {
        name: 'New Project',
        description: 'Initial description',
      };

      const created = await service.create(dto);

      expect(created.id).toBeDefined();
      expect(created.name).toBe('New Project');
      expect(created.description).toBe('Initial description');
      expect(created.hasImage).toBe(false);
      expect(created.chatCount).toBe(0);
      expect(created.artifactCount).toBe(0);
      expect(created.createdAt).toBeDefined();
      expect(created.updatedAt).toBe(created.createdAt);

      const inDb = db.get<{ name: string; description: string; image_path: string | null }>(
        'SELECT name, description, image_path FROM projects WHERE id = ?',
        [created.id],
      );
      expect(inDb?.name).toBe('New Project');
      expect(inDb?.description).toBe('Initial description');
      expect(inDb?.image_path).toBeNull();
    });
  });

  describe('update', () => {
    it('partially updates only the supplied fields and advances updatedAt', async () => {
      const project = fixtures.createProject({
        name: 'Original Name',
        description: 'Original Description',
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
      });

      const updated = await service.update(project.id, {
        name: 'Updated Name',
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.description).toBe('Original Description');
      expect(updated.createdAt).toBe('2026-09-01T00:00:00.000Z');
      expect(updated.updatedAt).not.toBe('2026-09-01T00:00:00.000Z');
    });

    it('setting description to null clears it', async () => {
      const project = fixtures.createProject({
        name: 'Name',
        description: 'To be cleared',
      });

      const updated = await service.update(project.id, {
        description: null,
      });

      expect(updated.name).toBe('Name');
      expect(updated.description).toBeNull();
    });

    it('empty update payload does not bump updatedAt', async () => {
      const project = fixtures.createProject({
        name: 'Name',
        description: 'Desc',
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
      });

      const updated = await service.update(project.id, {});

      expect(updated.updatedAt).toBe('2026-09-01T00:00:00.000Z');
    });

    it('throws NotFoundException for non-existent project', async () => {
      await expect(
        service.update('018f3a9e-0000-7000-8000-000000000404', {
          name: 'Non Existent',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('deletes an existing project', async () => {
      const project = fixtures.createProject({ name: 'To Delete' });

      await service.delete(project.id);

      const inDb = db.get('SELECT * FROM projects WHERE id = ?', [project.id]);
      expect(inDb).toBeUndefined();
    });

    it('throws NotFoundException when deleting unknown ID', async () => {
      await expect(
        service.delete('018f3a9e-0000-7000-8000-000000000404'),
      ).rejects.toThrow(NotFoundException);
    });

    it('unlinks image file via FileStorageService when project has an image', async () => {
      const imagePath = 'pictures/project-icon.png';
      const project = fixtures.createProject({
        name: 'Project with Image',
        image_path: imagePath,
      });

      await service.delete(project.id);

      expect(fileStorage.delete).toHaveBeenCalledWith(imagePath);
      const inDb = db.get('SELECT * FROM projects WHERE id = ?', [project.id]);
      expect(inDb).toBeUndefined();
    });

    it('logs warning and does not fail request if FileStorageService.delete fails', async () => {
      const faultyStorage = {
        delete: vi.fn().mockRejectedValue(new Error('Disk read-only')),
      } as unknown as FileStorageService;

      const serviceWithFaultyStorage = new ProjectsService(db, faultyStorage);
      const project = fixtures.createProject({
        name: 'Project with Erroring Image',
        image_path: 'pictures/broken.png',
      });

      await expect(
        serviceWithFaultyStorage.delete(project.id),
      ).resolves.toBeUndefined();

      const inDb = db.get('SELECT * FROM projects WHERE id = ?', [project.id]);
      expect(inDb).toBeUndefined();
    });

    it('deleting a project leaves its chats and artifacts intact with project_id set to null', async () => {
      const project = fixtures.createProject({ name: 'Container' });
      const chat = fixtures.createChat({ project_id: project.id });
      const artifact = fixtures.createArtifact({ project_id: project.id });

      await service.delete(project.id);

      // Project row is gone
      const projectRow = db.get('SELECT * FROM projects WHERE id = ?', [
        project.id,
      ]);
      expect(projectRow).toBeUndefined();

      // Referencing chat survived with project_id = null
      const chatRow = db.get<{ id: string; project_id: string | null }>(
        'SELECT id, project_id FROM chats WHERE id = ?',
        [chat.id],
      );
      expect(chatRow).toBeDefined();
      expect(chatRow?.project_id).toBeNull();

      // Referencing artifact survived with project_id = null
      const artifactRow = db.get<{ id: string; project_id: string | null }>(
        'SELECT id, project_id FROM artifacts WHERE id = ?',
        [artifact.id],
      );
      expect(artifactRow).toBeDefined();
      expect(artifactRow?.project_id).toBeNull();
    });
  });
});
