import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../database/database.service.js';
import {
  FileNotFoundError,
  InvalidPathError,
} from '../../file-storage/file-storage.errors.js';
import type { FileStorageService } from '../../file-storage/file-storage.service.js';
import { TestFixtures } from '../../../test/harness/fixtures.js';
import { ArtifactsService } from './artifacts.service.js';
import type { CreateArtifactDto } from './dto/create-artifact.dto.js';

describe('ArtifactsService', () => {
  let db: DatabaseService;
  let fixtures: TestFixtures;
  let fileStorage: FileStorageService;
  let service: ArtifactsService;

  beforeEach(() => {
    db = new DatabaseService();
    db.connect(':memory:');
    fixtures = new TestFixtures(db);
    fileStorage = {
      write: vi.fn(),
      read: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn(),
    } as unknown as FileStorageService;
    service = new ArtifactsService(db, fileStorage);
  });

  afterEach(() => {
    db.close();
  });

  describe('findAll', () => {
    it('returns an empty paginated collection when no artifacts exist', async () => {
      const result = await service.findAll({});

      expect(result).toEqual({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      });
    });

    it('returns stored artifacts and omits inline content from list items', async () => {
      fixtures.createArtifact({
        title: 'Spec A',
        content: 'Long inline text that should not appear in list',
      });
      fixtures.createArtifact({
        title: 'Spec B',
        content: 'Another long text',
      });

      const result = await service.findAll({});

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).not.toHaveProperty('content');
      expect(result.items[1]).not.toHaveProperty('content');
      expect(result.items[0].title).toBeDefined();
    });

    it('filters artifacts by projectId including "null" for unfiled', async () => {
      const project = fixtures.createProject({ name: 'App Dev' });
      fixtures.createArtifact({
        title: 'Project Artifact',
        project_id: project.id,
      });
      fixtures.createArtifact({
        title: 'Unfiled Artifact',
        project_id: null,
      });

      const projectFiltered = await service.findAll({ projectId: project.id });
      expect(projectFiltered.total).toBe(1);
      expect(projectFiltered.items[0].title).toBe('Project Artifact');

      const unfiledFiltered = await service.findAll({ projectId: 'null' });
      expect(unfiledFiltered.total).toBe(1);
      expect(unfiledFiltered.items[0].title).toBe('Unfiled Artifact');
    });

    it('filters artifacts by chatId including "null" for unfiled', async () => {
      const chat = fixtures.createChat({ title: 'Discussion' });
      fixtures.createArtifact({
        title: 'Chat Artifact',
        chat_id: chat.id,
      });
      fixtures.createArtifact({
        title: 'Independent Artifact',
        chat_id: null,
      });

      const chatFiltered = await service.findAll({ chatId: chat.id });
      expect(chatFiltered.total).toBe(1);
      expect(chatFiltered.items[0].title).toBe('Chat Artifact');

      const independent = await service.findAll({ chatId: 'null' });
      expect(independent.total).toBe(1);
      expect(independent.items[0].title).toBe('Independent Artifact');
    });

    it('filters artifacts by agentId including "null" for unassigned', async () => {
      const agent = fixtures.createAgent({ name: 'Coder' });
      fixtures.createArtifact({
        title: 'Agent Artifact',
        agent_id: agent.id,
      });
      fixtures.createArtifact({
        title: 'User Artifact',
        agent_id: null,
      });

      const agentFiltered = await service.findAll({ agentId: agent.id });
      expect(agentFiltered.total).toBe(1);
      expect(agentFiltered.items[0].title).toBe('Agent Artifact');

      const unassigned = await service.findAll({ agentId: 'null' });
      expect(unassigned.total).toBe(1);
      expect(unassigned.items[0].title).toBe('User Artifact');
    });

    it('filters artifacts by type', async () => {
      fixtures.createArtifact({ title: 'Code Art', type: 'code' });
      fixtures.createArtifact({ title: 'Doc Art', type: 'document' });

      const result = await service.findAll({ type: 'code' });
      expect(result.total).toBe(1);
      expect(result.items[0].title).toBe('Code Art');
    });

    it('filters artifacts by title substring search', async () => {
      fixtures.createArtifact({ title: 'Database Schema Migration' });
      fixtures.createArtifact({ title: 'Frontend UI Mockup' });

      const result = await service.findAll({ search: 'Migration' });
      expect(result.total).toBe(1);
      expect(result.items[0].title).toBe('Database Schema Migration');
    });

    it('escapes % and _ in title search', async () => {
      fixtures.createArtifact({ title: '100%_Coverage' });
      fixtures.createArtifact({ title: '1000 Coverage' });

      const result = await service.findAll({ search: '100%_' });
      expect(result.total).toBe(1);
      expect(result.items[0].title).toBe('100%_Coverage');
    });

    it('supports sorting by allowed sort columns', async () => {
      fixtures.createArtifact({
        title: 'A Alpha',
        version: 1,
        created_at: '2026-09-21T01:00:00.000Z',
      });
      fixtures.createArtifact({
        title: 'B Beta',
        version: 3,
        created_at: '2026-09-21T02:00:00.000Z',
      });

      const sortTitleAsc = await service.findAll({
        sort: 'title',
        order: 'asc',
      });
      expect(sortTitleAsc.items[0].title).toBe('A Alpha');

      const sortVersionDesc = await service.findAll({
        sort: 'version',
        order: 'desc',
      });
      expect(sortVersionDesc.items[0].title).toBe('B Beta');
    });

    it('rejects unrecognised sort column with BadRequestException', async () => {
      await expect(service.findAll({ sort: 'malicious_sql' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findOne', () => {
    it('retrieves an existing artifact by ID, including inline content', async () => {
      const created = fixtures.createArtifact({
        title: 'Spec Document',
        type: 'document',
        content: '# Heading\nParagraph content',
        mime_type: 'text/markdown',
      });

      const retrieved = await service.findOne(created.id);

      expect(retrieved.id).toBe(created.id);
      expect(retrieved.title).toBe('Spec Document');
      expect(retrieved.content).toBe('# Heading\nParagraph content');
      expect(retrieved.hasFile).toBe(false);
      expect(retrieved.version).toBe(1);
    });

    it('retrieves a file artifact, hides file_path, and emits hasFile: true', async () => {
      const created = fixtures.createArtifact({
        title: 'Archive',
        type: 'file',
        content: null,
        file_path: 'artifacts/archive.zip',
        mime_type: 'application/zip',
      });

      const retrieved = await service.findOne(created.id);

      expect(retrieved.id).toBe(created.id);
      expect(retrieved.content).toBeNull();
      expect(retrieved.hasFile).toBe(true);
      expect(retrieved).not.toHaveProperty('file_path');
      expect(retrieved).not.toHaveProperty('filePath');
    });

    it('throws NotFoundException when artifact does not exist', async () => {
      await expect(
        service.findOne('018f3a9e-0000-7000-8000-000000000099'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates an artifact with inline content, version 1, and server timestamps', async () => {
      const dto: CreateArtifactDto = {
        title: 'Architecture Overview',
        type: 'document',
        content: '# Architecture',
        mimeType: 'text/markdown',
      };

      const result = await service.create(dto);

      expect(result.id).toBeDefined();
      expect(result.title).toBe('Architecture Overview');
      expect(result.type).toBe('document');
      expect(result.content).toBe('# Architecture');
      expect(result.hasFile).toBe(false);
      expect(result.version).toBe(1);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBe(result.createdAt);

      const inDb = await service.findOne(result.id);
      expect(inDb.title).toBe('Architecture Overview');
    });

    it('records artifact_created usage event when AnalyticsService is provided', async () => {
      const mockAnalytics = {
        recordArtifactCreated: vi.fn(),
      } as any;

      const artifactServiceWithAnalytics = new ArtifactsService(
        db,
        undefined,
        mockAnalytics,
      );

      const agent = fixtures.createAgent();
      const chat = fixtures.createChat({ agent_id: agent.id });

      const created = await artifactServiceWithAnalytics.create({
        title: 'Tracked Artifact',
        type: 'code',
        content: 'console.log("hello");',
        agentId: agent.id,
        chatId: chat.id,
      });

      expect(mockAnalytics.recordArtifactCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: agent.id,
          chatId: chat.id,
          metadata: {
            artifactId: created.id,
            type: 'code',
          },
        }),
      );
    });

    it('creates an artifact backed by a stored file', async () => {
      const dto: CreateArtifactDto = {
        title: 'Asset Bundle',
        type: 'file',
        filePath: 'artifacts/assets.tar.gz',
        mimeType: 'application/gzip',
      };

      const result = await service.create(dto);

      expect(result.hasFile).toBe(true);
      expect(result.content).toBeNull();
      expect(result).not.toHaveProperty('file_path');
    });

    it('rejects creation when both content and filePath are provided (400)', async () => {
      const dto: CreateArtifactDto = {
        title: 'Conflicting',
        type: 'code',
        content: 'code',
        filePath: 'path/file.ts',
      };

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    });

    it('rejects creation when neither content nor filePath is provided (400)', async () => {
      const dto: CreateArtifactDto = {
        title: 'Empty',
        type: 'code',
      };

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    });

    it('successfully links to existing project, chat, and agent', async () => {
      const project = fixtures.createProject();
      const chat = fixtures.createChat();
      const agent = fixtures.createAgent();

      const result = await service.create({
        title: 'Linked Artifact',
        type: 'document',
        content: 'Notes',
        projectId: project.id,
        chatId: chat.id,
        agentId: agent.id,
      });

      expect(result.projectId).toBe(project.id);
      expect(result.chatId).toBe(chat.id);
      expect(result.agentId).toBe(agent.id);
    });

    it('rejects non-existent projectId with 422 UnprocessableEntityException', async () => {
      await expect(
        service.create({
          title: 'Art',
          type: 'document',
          content: 'text',
          projectId: '018f3a9e-0000-7000-8000-000000000099',
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects non-existent chatId with 422 UnprocessableEntityException', async () => {
      await expect(
        service.create({
          title: 'Art',
          type: 'document',
          content: 'text',
          chatId: '018f3a9e-0000-7000-8000-000000000099',
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects non-existent agentId with 422 UnprocessableEntityException', async () => {
      await expect(
        service.create({
          title: 'Art',
          type: 'document',
          content: 'text',
          agentId: '018f3a9e-0000-7000-8000-000000000099',
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('update', () => {
    it('partially updates fields, increments version and advances updatedAt', async () => {
      const artifact = fixtures.createArtifact({
        title: 'Original Title',
        content: 'Original Content',
        version: 1,
        created_at: '2026-09-21T09:00:00.000Z',
        updated_at: '2026-09-21T09:00:00.000Z',
      });

      const updated = await service.update(artifact.id, {
        title: 'Updated Title',
      });

      expect(updated.title).toBe('Updated Title');
      expect(updated.content).toBe('Original Content');
      expect(updated.version).toBe(2);
      expect(updated.updatedAt > artifact.updated_at).toBe(true);
      expect(updated.createdAt).toBe(artifact.created_at);
    });

    it('leaves version and updatedAt untouched on empty update payload (no-op)', async () => {
      const artifact = fixtures.createArtifact({
        title: 'Original Title',
        version: 1,
        updated_at: '2026-09-21T09:00:00.000Z',
      });

      const result = await service.update(artifact.id, {});

      expect(result.version).toBe(1);
      expect(result.updatedAt).toBe('2026-09-21T09:00:00.000Z');
    });

    it('allows clearing content and setting filePath, and preserves XOR invariant', async () => {
      const artifact = fixtures.createArtifact({
        content: 'Initial inline content',
        file_path: null,
      });

      const updated = await service.update(artifact.id, {
        content: null,
        filePath: 'artifacts/new-file.bin',
      });

      expect(updated.hasFile).toBe(true);
      expect(updated.content).toBeNull();
      expect(updated.version).toBe(2);
    });

    it('preserves old backing file in history when replacing file artifact with inline content, and cleans it up on delete', async () => {
      const artifact = fixtures.createArtifact({
        content: null,
        file_path: 'artifacts/old-stored.bin',
      });

      const updated = await service.update(artifact.id, {
        content: 'Now inline text',
        filePath: null,
      });

      expect(updated.hasFile).toBe(false);
      expect(updated.content).toBe('Now inline text');
      // The file is NOT unlinked immediately because version 1 in artifact_versions still references it
      expect(fileStorage.delete).not.toHaveBeenCalled();

      // Deleting the artifact unlinks the file preserved in version history
      await service.delete(artifact.id);
      expect(fileStorage.delete).toHaveBeenCalledWith(
        'artifacts/old-stored.bin',
      );
    });

    it('rejects update that violates XOR rule by attempting to clear both', async () => {
      const artifact = fixtures.createArtifact({
        content: 'Some content',
        file_path: null,
      });

      await expect(
        service.update(artifact.id, {
          content: null,
          filePath: null,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects update that attempts to set both content and filePath', async () => {
      const artifact = fixtures.createArtifact({
        content: 'Some content',
        file_path: null,
      });

      await expect(
        service.update(artifact.id, {
          content: 'New content',
          filePath: 'artifacts/new.bin',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects update with non-existent parent reference (422)', async () => {
      const artifact = fixtures.createArtifact();

      await expect(
        service.update(artifact.id, {
          projectId: '018f3a9e-0000-7000-8000-000000000099',
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('throws NotFoundException when updating non-existent artifact', async () => {
      await expect(
        service.update('018f3a9e-0000-7000-8000-000000000099', {
          title: 'New',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('deletes an artifact and cleans up its backing file if present', async () => {
      const artifact = fixtures.createArtifact({
        content: null,
        file_path: 'artifacts/to-delete.bin',
      });

      await service.delete(artifact.id);

      await expect(service.findOne(artifact.id)).rejects.toThrow(
        NotFoundException,
      );
      expect(fileStorage.delete).toHaveBeenCalledWith(
        'artifacts/to-delete.bin',
      );
    });

    it('succeeds even if fileStorage.delete rejects (e.g. missing file)', async () => {
      vi.mocked(fileStorage.delete).mockRejectedValueOnce(
        new Error('File not found'),
      );

      const artifact = fixtures.createArtifact({
        content: null,
        file_path: 'artifacts/missing.bin',
      });

      await expect(service.delete(artifact.id)).resolves.not.toThrow();
      await expect(service.findOne(artifact.id)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when deleting non-existent artifact', async () => {
      await expect(
        service.delete('018f3a9e-0000-7000-8000-000000000099'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Cascade behaviour', () => {
    it('preserves artifact and nulls project_id when project is deleted', async () => {
      const project = fixtures.createProject({ name: 'Container Project' });
      const artifact = fixtures.createArtifact({
        title: 'Project Product',
        project_id: project.id,
      });

      db.run('DELETE FROM projects WHERE id = ?', [project.id]);

      const survived = await service.findOne(artifact.id);
      expect(survived.id).toBe(artifact.id);
      expect(survived.projectId).toBeNull();
    });

    it('preserves artifact and nulls chat_id when chat is deleted', async () => {
      const chat = fixtures.createChat({ title: 'Originating Chat' });
      const artifact = fixtures.createArtifact({
        title: 'Chat Output',
        chat_id: chat.id,
      });

      db.run('DELETE FROM chats WHERE id = ?', [chat.id]);

      const survived = await service.findOne(artifact.id);
      expect(survived.id).toBe(artifact.id);
      expect(survived.chatId).toBeNull();
    });

    it('preserves artifact and nulls agent_id when agent is deleted', async () => {
      const agent = fixtures.createAgent({ name: 'Producing Agent' });
      const artifact = fixtures.createArtifact({
        title: 'Agent Output',
        agent_id: agent.id,
      });

      db.run('DELETE FROM agents WHERE id = ?', [agent.id]);

      const survived = await service.findOne(artifact.id);
      expect(survived.id).toBe(artifact.id);
      expect(survived.agentId).toBeNull();
    });
  });

  describe('openContent', () => {
    it('returns inline content descriptor with UTF-8 byte length for inline artifact', async () => {
      const utf8Content = 'Hello 世界 🚀';
      const artifact = fixtures.createArtifact({
        title: 'Unicode Document',
        type: 'document',
        content: utf8Content,
        file_path: null,
        mime_type: 'text/markdown',
      });

      const result = await service.openContent(artifact.id);

      expect(result).toMatchObject({
        kind: 'inline',
        id: artifact.id,
        title: 'Unicode Document',
        mimeType: 'text/markdown',
        content: utf8Content,
        size: Buffer.byteLength(utf8Content, 'utf-8'),
        version: 1,
      });
    });

    it('returns file content descriptor with stat size for backing file artifact', async () => {
      const artifact = fixtures.createArtifact({
        title: 'Stored File',
        type: 'file',
        content: null,
        file_path: 'artifacts/archive.zip',
        mime_type: 'application/zip',
      });

      vi.spyOn(fileStorage, 'stat').mockResolvedValueOnce({
        size: 2048,
        contentType: 'application/zip',
        modifiedAt: new Date(),
        createdAt: new Date(),
      });

      const mockStream = {} as any;
      (fileStorage.createReadStream as any) = vi
        .fn()
        .mockReturnValue(mockStream);

      const result = await service.openContent(artifact.id);

      expect(result).toMatchObject({
        kind: 'file',
        id: artifact.id,
        title: 'Stored File',
        mimeType: 'application/zip',
        filePath: 'artifacts/archive.zip',
        size: 2048,
        version: 1,
      });

      if (result.kind === 'file') {
        const stream = await result.openStream({ start: 0, end: 100 });
        expect(fileStorage.createReadStream).toHaveBeenCalledWith(
          'artifacts/archive.zip',
          { start: 0, end: 100 },
        );
        expect(stream).toBe(mockStream);
      }
    });

    it('throws 404 ARTIFACT_NOT_FOUND when artifact does not exist', async () => {
      await expect(
        service.openContent('018f3a9e-0000-7000-8000-999999999999'),
      ).rejects.toMatchObject({
        status: 404,
        response: {
          code: 'ARTIFACT_NOT_FOUND',
        },
      });
    });

    it('throws 404 ARTIFACT_CONTENT_NOT_FOUND when artifact has neither content nor file', async () => {
      // Row inserted directly to bypass XOR invariant
      const id = '018f3a9e-0000-7000-8000-000000000010';
      db.run(
        `INSERT INTO artifacts (id, title, type, content, file_path, version, created_at, updated_at)
         VALUES (?, 'Empty', 'document', NULL, NULL, 1, '2026-09-21T09:30:52.000Z', '2026-09-21T09:30:52.000Z')`,
        [id],
      );

      await expect(service.openContent(id)).rejects.toMatchObject({
        status: 404,
        response: {
          code: 'ARTIFACT_CONTENT_NOT_FOUND',
        },
      });
    });

    it('throws 404 ARTIFACT_FILE_NOT_FOUND when backing file is missing from storage', async () => {
      const artifact = fixtures.createArtifact({
        title: 'Missing File',
        type: 'file',
        content: null,
        file_path: 'artifacts/deleted.bin',
      });

      vi.spyOn(fileStorage, 'stat').mockRejectedValueOnce(
        new FileNotFoundError('artifacts/deleted.bin'),
      );

      await expect(service.openContent(artifact.id)).rejects.toMatchObject({
        status: 404,
        response: {
          code: 'ARTIFACT_FILE_NOT_FOUND',
        },
      });
    });

    it('propagates InvalidPathError when file_path contains traversal sequences', async () => {
      const artifact = fixtures.createArtifact({
        title: 'Traversal Attempt',
        type: 'file',
        content: null,
        file_path: '../../etc/passwd',
      });

      vi.spyOn(fileStorage, 'stat').mockRejectedValueOnce(
        new InvalidPathError('Traversal detected'),
      );

      await expect(service.openContent(artifact.id)).rejects.toBeInstanceOf(
        InvalidPathError,
      );
    });

    it('throws error when fileStorage is not configured for a file artifact', async () => {
      const unconfiguredService = new ArtifactsService(db, undefined);
      const artifact = fixtures.createArtifact({
        title: 'File Artifact',
        type: 'file',
        content: null,
        file_path: 'artifacts/some.bin',
      });

      await expect(
        unconfiguredService.openContent(artifact.id),
      ).rejects.toThrow('FileStorageService is required');
    });
  });

  describe('uploadContent', () => {
    it('uploads file content, bumps version, and snapshots previous active state', async () => {
      const artifact = fixtures.createArtifact({
        title: 'Draft Document',
        type: 'document',
        content: '# Draft content',
        file_path: null,
        version: 1,
      });

      const fileBuffer = Buffer.from('binary-artifact-bytes');
      vi.mocked(fileStorage.write).mockResolvedValueOnce({
        reference: 'artifacts/stored-file.bin',
        size: fileBuffer.length,
        contentType: 'application/octet-stream',
      });

      const mockMulterFile = {
        buffer: fileBuffer,
        originalname: 'file.bin',
        mimetype: 'application/octet-stream',
        size: fileBuffer.length,
      } as Express.Multer.File;

      const result = await service.uploadContent(artifact.id, mockMulterFile);

      expect(result.version).toBe(2);
      expect(result.hasFile).toBe(true);
      expect(result.content).toBeNull();
      expect(fileStorage.write).toHaveBeenCalledWith(
        'artifacts',
        fileBuffer,
        expect.any(Object),
      );

      // Verify that version 1 was snapshotted into artifact_versions
      const version1 = await service.findOneVersion(artifact.id, 1);
      expect(version1.version).toBe(1);
      expect(version1.title).toBe('Draft Document');
      expect(version1.content).toBe('# Draft content');
      expect(version1.hasFile).toBe(false);
    });

    it('adopts the type detected from the uploaded bytes instead of the declared one', async () => {
      const artifact = fixtures.createArtifact({
        title: 'Sticky mime',
        type: 'document',
        mime_type: 'text/markdown',
        content: '# hello',
        file_path: null,
        version: 1,
      });

      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
      ]);
      vi.mocked(fileStorage.write).mockResolvedValueOnce({
        reference: 'artifacts/stored-png.png',
        size: pngBuffer.length,
        contentType: 'image/png',
      });

      const mockMulterFile = {
        buffer: pngBuffer,
        originalname: 'one.png',
        mimetype: 'text/markdown',
        size: pngBuffer.length,
      } as Express.Multer.File;

      const result = await service.uploadContent(artifact.id, mockMulterFile);

      expect(result.version).toBe(2);
      expect(result.mimeType).toBe('image/png');
      await expect(service.findOne(artifact.id)).resolves.toMatchObject({
        mimeType: 'image/png',
      });
    });

    it('throws NotFoundException when uploading content to a non-existent artifact', async () => {
      const mockMulterFile = {
        buffer: Buffer.from('data'),
        originalname: 'file.bin',
        mimetype: 'application/octet-stream',
        size: 4,
      } as Express.Multer.File;

      await expect(
        service.uploadContent(
          '018f3a9e-0000-7000-8000-000000000099',
          mockMulterFile,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws error when fileStorage is not configured for uploadContent', async () => {
      const unconfiguredService = new ArtifactsService(db, undefined);
      const artifact = fixtures.createArtifact();
      const mockMulterFile = {
        buffer: Buffer.from('data'),
        originalname: 'file.bin',
        mimetype: 'application/octet-stream',
        size: 4,
      } as Express.Multer.File;

      await expect(
        unconfiguredService.uploadContent(artifact.id, mockMulterFile),
      ).rejects.toThrow('FileStorageService is required');
    });
  });

  describe('findAllVersions', () => {
    it('returns a paginated list of historical versions, default sorted by version desc', async () => {
      const artifact = fixtures.createArtifact({ title: 'Multi-version Doc' });
      fixtures.createArtifactVersion({
        artifact_id: artifact.id,
        version: 1,
        title: 'V1 Title',
        content: 'V1 Content',
      });
      fixtures.createArtifactVersion({
        artifact_id: artifact.id,
        version: 2,
        title: 'V2 Title',
        content: 'V2 Content',
      });

      const response = await service.findAllVersions(artifact.id, {});
      expect(response.total).toBe(2);
      expect(response.items).toHaveLength(2);
      expect(response.items[0].version).toBe(2);
      expect(response.items[1].version).toBe(1);
      // Inline content is omitted in collection listings
      expect(response.items[0].content).toBeUndefined();
    });

    it('throws NotFoundException when listing versions of a non-existent artifact', async () => {
      await expect(
        service.findAllVersions('018f3a9e-0000-7000-8000-000000000099', {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOneVersion', () => {
    it('returns metadata and inline content for a specific historical version', async () => {
      const artifact = fixtures.createArtifact();
      fixtures.createArtifactVersion({
        artifact_id: artifact.id,
        version: 1,
        title: 'Past Title',
        content: 'Past inline body',
      });

      const version = await service.findOneVersion(artifact.id, 1);
      expect(version.version).toBe(1);
      expect(version.title).toBe('Past Title');
      expect(version.content).toBe('Past inline body');
    });

    it('throws NotFoundException when artifact or version does not exist', async () => {
      const artifact = fixtures.createArtifact();
      await expect(service.findOneVersion(artifact.id, 999)).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.findOneVersion('018f3a9e-0000-7000-8000-000000000099', 1),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('openVersionContent', () => {
    it('returns an inline content descriptor for an inline historical version', async () => {
      const artifact = fixtures.createArtifact();
      fixtures.createArtifactVersion({
        artifact_id: artifact.id,
        version: 1,
        content: 'Historical inline content',
        file_path: null,
      });

      const descriptor = await service.openVersionContent(artifact.id, 1);
      expect(descriptor.kind).toBe('inline');
      if (descriptor.kind === 'inline') {
        expect(descriptor.content).toBe('Historical inline content');
        expect(descriptor.size).toBe(
          Buffer.byteLength('Historical inline content'),
        );
      }
    });

    it('returns a file content descriptor for a file historical version', async () => {
      const artifact = fixtures.createArtifact();
      fixtures.createArtifactVersion({
        artifact_id: artifact.id,
        version: 1,
        content: null,
        file_path: 'artifacts/historical.bin',
      });

      vi.spyOn(fileStorage, 'stat').mockResolvedValueOnce({
        size: 2048,
        reference: 'artifacts/historical.bin',
        contentType: 'application/octet-stream',
      } as any);

      const descriptor = await service.openVersionContent(artifact.id, 1);
      expect(descriptor.kind).toBe('file');
      if (descriptor.kind === 'file') {
        expect(descriptor.filePath).toBe('artifacts/historical.bin');
        expect(descriptor.size).toBe(2048);
      }
    });

    it('throws 404 ARTIFACT_FILE_NOT_FOUND when historical backing file is missing', async () => {
      const artifact = fixtures.createArtifact();
      fixtures.createArtifactVersion({
        artifact_id: artifact.id,
        version: 1,
        content: null,
        file_path: 'artifacts/missing-hist.bin',
      });

      vi.spyOn(fileStorage, 'stat').mockRejectedValueOnce(
        new FileNotFoundError('artifacts/missing-hist.bin'),
      );

      await expect(
        service.openVersionContent(artifact.id, 1),
      ).rejects.toMatchObject({
        status: 404,
        response: {
          code: 'ARTIFACT_FILE_NOT_FOUND',
        },
      });
    });
  });

  describe('restoreVersion', () => {
    it('rolls forward by snapshotting active version and creating a new version with restored content', async () => {
      const artifact = fixtures.createArtifact({
        title: 'V1 Title',
        content: 'V1 Content',
        version: 1,
      });

      // Update to V2
      await service.update(artifact.id, {
        title: 'V2 Title (Mistake)',
        content: 'V2 Corrupted Content',
      });

      // Active is now V2, V1 is in history
      const activeV2 = await service.findOne(artifact.id);
      expect(activeV2.version).toBe(2);

      // Restore V1
      const restored = await service.restoreVersion(artifact.id, 1);
      expect(restored.version).toBe(3); // Monotonically increases
      expect(restored.title).toBe('V1 Title');
      expect(restored.content).toBe('V1 Content');

      // V2 is now also preserved in history
      const v2History = await service.findOneVersion(artifact.id, 2);
      expect(v2History.version).toBe(2);
      expect(v2History.title).toBe('V2 Title (Mistake)');
    });

    it('throws NotFoundException when restoring a non-existent version', async () => {
      const artifact = fixtures.createArtifact();
      await expect(service.restoreVersion(artifact.id, 99)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('retention ceiling and pruning', () => {
    it('prunes oldest versions beyond 20 and unlinks unreferenced files', async () => {
      const artifact = fixtures.createArtifact({
        title: 'Artifact 0',
        content: 'Content 0',
        version: 21,
      });

      // Create 20 historical versions for this artifact
      for (let i = 1; i <= 20; i++) {
        fixtures.createArtifactVersion({
          artifact_id: artifact.id,
          version: i,
          title: `Version ${i}`,
          content: `Content ${i}`,
          file_path: i === 1 ? 'artifacts/unshared-old-file.bin' : null,
        });
      }

      // Now we have 20 versions in history. Adding one more update snapshots active version
      // and triggers pruning (excess = 21 - 20 = 1, version 1 pruned)
      await service.update(artifact.id, {
        title: 'Update Triggering Prune',
      });

      const versionsAfter = await service.findAllVersions(artifact.id, {
        limit: 100,
      });
      expect(versionsAfter.total).toBe(20);
      // Version 1 was pruned!
      expect(versionsAfter.items.some((v) => v.version === 1)).toBe(false);
      // File belonging to version 1 was unlinked
      expect(fileStorage.delete).toHaveBeenCalledWith(
        'artifacts/unshared-old-file.bin',
      );
    });
  });
});
