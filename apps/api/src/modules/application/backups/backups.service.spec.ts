import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import * as tar from 'tar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '../../../common/persistence/identifiers.js';
import { nowIso } from '../../../common/persistence/timestamps.js';
import { AppConfigService } from '../../../config/app-config.service.js';
import { DatabaseService } from '../../../database/database.service.js';
import { FileStorageService } from '../../../file-storage/file-storage.service.js';
import { TestFixtures } from '../../../../test/harness/fixtures.js';
import { BackupsService } from './backups.service.js';
import { BackupManifest } from './backups.types.js';

describe('BackupsService', () => {
  let tempBaseDir: string;
  let testDataDir: string;
  let testStorageDir: string;
  let testBackupTargetDir: string;
  let dbService: DatabaseService;
  let fileStorageService: FileStorageService;
  let backupsService: BackupsService;
  let fixtures: TestFixtures;

  beforeEach(async () => {
    tempBaseDir = path.join(os.tmpdir(), `glassbeetle-backups-test-${newId()}`);
    testDataDir = path.join(tempBaseDir, 'data');
    testStorageDir = path.join(testDataDir, 'storage');
    testBackupTargetDir = path.join(tempBaseDir, 'custom-backups');

    fs.mkdirSync(testDataDir, { recursive: true });
    fs.mkdirSync(testStorageDir, { recursive: true });
    fs.mkdirSync(testBackupTargetDir, { recursive: true });

    const mockAppConfig = {
      dataDir: testDataDir,
      databasePath: path.join(testDataDir, 'test.db'),
    } as AppConfigService;

    dbService = new DatabaseService(mockAppConfig);
    dbService.connect(path.join(testDataDir, 'test.db'));

    fileStorageService = new FileStorageService(mockAppConfig, testStorageDir);
    await fileStorageService.onModuleInit();

    backupsService = new BackupsService(
      dbService,
      fileStorageService,
      mockAppConfig,
    );

    fixtures = new TestFixtures(dbService);
  });

  afterEach(async () => {
    dbService.close();
    try {
      if (fs.existsSync(tempBaseDir)) {
        await fs.promises.rm(tempBaseDir, { recursive: true, force: true });
      }
    } catch {}
    vi.restoreAllMocks();
  });

  it('creates a backup against a seeded database and asserts archive exists, is recorded, and contains all three components', async () => {
    // 1. Seed database
    const prompt = fixtures.createSystemPrompt({ name: 'Backup Test Prompt' });
    const provider = fixtures.createProvider({ name: 'Anthropic Test' });
    const model = fixtures.createModel({
      provider_id: provider.id,
      display_name: 'Claude 3.5 Sonnet',
    });
    const agent = fixtures.createAgent({
      name: 'Test Agent',
      system_prompt_id: prompt.id,
      model_id: model.id,
    });
    const chat = fixtures.createChat({ agent_id: agent.id, title: 'Chat 1' });
    fixtures.createMessage({ chat_id: chat.id, content: 'Hello Glassbeetle!' });

    // 2. Seed file storage
    const avatarContent = Buffer.from('fake image content avatar');
    const avatarResult = await fileStorageService.write(
      'pictures',
      avatarContent,
      {
        declaredMimeType: 'image/png',
      },
    );

    const artifactContent = Buffer.from('console.log("hello world");');
    const artifactResult = await fileStorageService.write(
      'artifacts',
      artifactContent,
      {
        declaredMimeType: 'text/plain',
      },
    );

    // 3. Create backup
    const result = await backupsService.createBackup({
      trigger: 'manual',
      label: 'Full Test Backup',
      note: 'Comprehensive test archive verification',
    });

    // 4. Assert response shape
    expect(result.id).toBeDefined();
    expect(result.trigger).toBe('manual');
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.createdAt).toBeDefined();

    // 5. Assert row recorded in backups table
    const backupRow = dbService.get<{
      id: string;
      file_path: string;
      size_bytes: number;
      trigger: string;
      created_at: string;
    }>('SELECT * FROM backups WHERE id = ?', [result.id]);

    expect(backupRow).toBeDefined();
    expect(backupRow?.id).toBe(result.id);
    expect(backupRow?.trigger).toBe('manual');
    expect(backupRow?.size_bytes).toBe(result.sizeBytes);

    const archivePath = path.join(testDataDir, 'backups', backupRow!.file_path);
    expect(fs.existsSync(archivePath)).toBe(true);

    // Assert size_bytes matches actual file on disk
    const diskStat = await fs.promises.stat(archivePath);
    expect(diskStat.size).toBe(result.sizeBytes);

    // 6. Inspect archive contents
    const extractDir = path.join(tempBaseDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });

    await tar.x({
      file: archivePath,
      cwd: extractDir,
    });

    expect(fs.existsSync(path.join(extractDir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(extractDir, 'database.sqlite'))).toBe(true);
    expect(fs.existsSync(path.join(extractDir, 'files'))).toBe(true);

    // 7. Verify manifest.json
    const manifestRaw = await fs.promises.readFile(
      path.join(extractDir, 'manifest.json'),
      'utf8',
    );
    const manifest: BackupManifest = JSON.parse(manifestRaw);

    expect(manifest.formatVersion).toBe(1);
    expect(manifest.appVersion).toBe('0.1.0');
    expect(manifest.createdAt).toBe(result.createdAt);
    expect(manifest.databaseSchemaVersion).toBeDefined();
    expect(manifest.label).toBe('Full Test Backup');
    expect(manifest.note).toBe('Comprehensive test archive verification');
    expect(manifest.fileInventory).toBeInstanceOf(Array);
    expect(manifest.fileInventory.length).toBe(2);

    const relativeAvatarPath = `files/${avatarResult.reference}`;
    const avatarInventory = manifest.fileInventory.find(
      (f) => f.path === relativeAvatarPath,
    );
    expect(avatarInventory).toBeDefined();
    expect(avatarInventory?.sizeBytes).toBe(avatarContent.length);
    expect(avatarInventory?.sha256).toBe(
      createHash('sha256').update(avatarContent).digest('hex'),
    );

    // 8. Extract database snapshot and assert it opens and contains the seeded rows
    const snapshotDb = new Database(path.join(extractDir, 'database.sqlite'));
    try {
      const snapPrompt = snapshotDb
        .prepare('SELECT * FROM system_prompts WHERE id = ?')
        .get(prompt.id) as { name: string };
      expect(snapPrompt?.name).toBe('Backup Test Prompt');

      const snapAgent = snapshotDb
        .prepare('SELECT * FROM agents WHERE id = ?')
        .get(agent.id) as { name: string };
      expect(snapAgent?.name).toBe('Test Agent');

      const snapChat = snapshotDb
        .prepare('SELECT * FROM chats WHERE id = ?')
        .get(chat.id) as { title: string };
      expect(snapChat?.title).toBe('Chat 1');

      const snapMessage = snapshotDb
        .prepare('SELECT * FROM messages WHERE chat_id = ?')
        .get(chat.id) as { content: string };
      expect(snapMessage?.content).toBe('Hello Glassbeetle!');
    } finally {
      snapshotDb.close();
    }

    // 9. Assert file storage contents intact in files/
    const extractedAvatar = await fs.promises.readFile(
      path.join(extractDir, 'files', avatarResult.reference),
    );
    expect(extractedAvatar).toEqual(avatarContent);

    const extractedArtifact = await fs.promises.readFile(
      path.join(extractDir, 'files', artifactResult.reference),
    );
    expect(extractedArtifact).toEqual(artifactContent);
  });

  describe('file permissions', () => {
    // POSIX modes; Windows does not report them.
    const posixIt = process.platform === 'win32' ? it.skip : it;

    posixIt(
      'writes the archive and the default backups directory owner-only',
      async () => {
        const result = await backupsService.createBackup();

        const defaultBackupDir = path.join(testDataDir, 'backups');
        const archivePath = path.join(
          defaultBackupDir,
          `backup-${result.id}.tar.gz`,
        );
        expect(fs.statSync(archivePath).mode & 0o777).toBe(0o600);
        expect(fs.statSync(defaultBackupDir).mode & 0o777).toBe(0o700);
      },
    );

    posixIt(
      'writes the archive owner-only in a configured target directory',
      async () => {
        dbService.run(
          'UPDATE backup_policy SET target_directory = ?, updated_at = ? WHERE id = 1',
          [testBackupTargetDir, nowIso()],
        );

        const result = await backupsService.createBackup();

        const archivePath = path.join(
          testBackupTargetDir,
          `backup-${result.id}.tar.gz`,
        );
        expect(fs.statSync(archivePath).mode & 0o777).toBe(0o600);
      },
    );

    posixIt(
      'stages the snapshot in an owner-only directory and removes it afterwards',
      async () => {
        const originalWriteFile = fs.promises.writeFile.bind(fs.promises);
        let stagingDir: string | undefined;
        let stagingMode: number | undefined;
        vi.spyOn(fs.promises, 'writeFile').mockImplementation(
          async (file, ...rest) => {
            if (
              typeof file === 'string' &&
              path.basename(file) === 'manifest.json'
            ) {
              stagingDir = path.dirname(file);
              stagingMode = fs.statSync(stagingDir).mode & 0o777;
            }
            return originalWriteFile(file, ...rest);
          },
        );

        await backupsService.createBackup();

        expect(stagingDir).toBeDefined();
        expect(path.dirname(stagingDir!)).toBe(path.resolve(os.tmpdir()));
        expect(stagingMode).toBe(0o700);
        expect(fs.existsSync(stagingDir!)).toBe(false);
      },
    );
  });

  it('uses target_directory from backup_policy when configured', async () => {
    // Configure target_directory in backup_policy table
    dbService.run(
      'UPDATE backup_policy SET target_directory = ?, updated_at = ? WHERE id = 1',
      [testBackupTargetDir, nowIso()],
    );

    const result = await backupsService.createBackup({ trigger: 'scheduled' });
    expect(result.trigger).toBe('scheduled');

    const backupRow = dbService.get<{ file_path: string }>(
      'SELECT file_path FROM backups WHERE id = ?',
      [result.id],
    );
    expect(backupRow?.file_path).toBe(`backup-${result.id}.tar.gz`);
    expect(path.isAbsolute(backupRow!.file_path)).toBe(false);
    expect(backupRow!.file_path).not.toMatch(/[\\/]/);
    expect(
      fs.existsSync(path.join(testBackupTargetDir, backupRow!.file_path)),
    ).toBe(true);
  });

  it('stores only the archive filename in file_path', async () => {
    const result = await backupsService.createBackup();
    const row = dbService.get<{ file_path: string }>(
      'SELECT file_path FROM backups WHERE id = ?',
      [result.id],
    );

    expect(row?.file_path).toBe(`backup-${result.id}.tar.gz`);
    expect(path.isAbsolute(row!.file_path)).toBe(false);
    expect(row!.file_path).not.toMatch(/[\\/]/);
  });

  it('resolves legacy absolute file_path values against the target directory', async () => {
    const id = '018f3a9e-0000-7000-8000-000000000123';
    const legacyPath = path.join(testBackupTargetDir, `backup-${id}.tar.gz`);
    fs.writeFileSync(legacyPath, 'legacy archive bytes');

    dbService.run(
      'UPDATE backup_policy SET target_directory = ?, updated_at = ? WHERE id = 1',
      [testBackupTargetDir, nowIso()],
    );
    dbService.run(
      `INSERT INTO backups (id, file_path, size_bytes, trigger, created_at)
       VALUES (?, ?, ?, 'manual', ?)`,
      [id, legacyPath, 20, nowIso()],
    );

    const found = await backupsService.findOne(id);
    expect(found.hasArchive).toBe(true);
    expect(found.isAvailable).toBe(true);

    await backupsService.deleteBackup(id);
    expect(fs.existsSync(legacyPath)).toBe(false);
  });

  it('resolves a backup through the storage root after that root moves to a different mount', async () => {
    const result = await backupsService.createBackup();
    const row = dbService.get<{ file_path: string }>(
      'SELECT file_path FROM backups WHERE id = ?',
      [result.id],
    );

    // The stored reference is relative, not the absolute path of the machine
    // that produced the archive.
    expect(path.isAbsolute(row!.file_path)).toBe(false);

    // Simulate moving the storage root to a different mount: keep the backup
    // under its backups bucket there, remove the original, and point a fresh
    // service instance (with a fresh FileStorageService root) at the new mount.
    const movedRoot = path.join(tempBaseDir, 'moved-mount');
    const movedStorageRoot = path.join(movedRoot, 'storage');
    const movedBackupDir = path.join(movedStorageRoot, 'backups');
    fs.mkdirSync(movedBackupDir, { recursive: true });
    fs.copyFileSync(
      path.join(testDataDir, 'backups', row!.file_path),
      path.join(movedBackupDir, row!.file_path),
    );
    fs.unlinkSync(path.join(testDataDir, 'backups', row!.file_path));

    dbService.run(
      'UPDATE backup_policy SET target_directory = ?, updated_at = ? WHERE id = 1',
      [movedBackupDir, nowIso()],
    );

    const movedConfig = {
      dataDir: movedRoot,
      databasePath: path.join(movedRoot, 'test.db'),
    } as AppConfigService;
    const movedStorageService = new FileStorageService(movedConfig);
    await movedStorageService.onModuleInit();
    const movedBackupsService = new BackupsService(
      dbService,
      movedStorageService,
      movedConfig,
    );

    expect(movedStorageService.storageRoot).toBe(movedStorageRoot);

    const found = await movedBackupsService.findOne(result.id);
    expect(found.hasArchive).toBe(true);
    expect(found.isAvailable).toBe(true);
  });

  it('serialises backups and throws 409 Conflict when a backup is already in progress', async () => {
    // Simulate active backup by setting flag
    (backupsService as any).isBackupInProgress = true;

    await expect(backupsService.createBackup()).rejects.toThrow(
      ConflictException,
    );

    // Reset flag and verify it succeeds
    (backupsService as any).isBackupInProgress = false;
    const result = await backupsService.createBackup();
    expect(result).toBeDefined();
  });

  it('creates a backup while concurrent database writes are happening, ensuring a valid openable snapshot', async () => {
    fixtures.createSystemPrompt({ name: 'Base Prompt' });

    // Simulate concurrent database writes during VACUUM INTO / execution
    const writePromises = Array.from({ length: 5 }, (_, i) => {
      return Promise.resolve().then(() => {
        fixtures.createSystemPrompt({ name: `Concurrent Prompt ${i}` });
      });
    });

    const [backupResult] = await Promise.all([
      backupsService.createBackup(),
      ...writePromises,
    ]);

    expect(backupResult).toBeDefined();

    const backupRow = dbService.get<{ file_path: string }>(
      'SELECT file_path FROM backups WHERE id = ?',
      [backupResult.id],
    );

    const extractDir = path.join(tempBaseDir, 'concurrent-extracted');
    fs.mkdirSync(extractDir, { recursive: true });

    await tar.x({
      file: path.join(testDataDir, 'backups', backupRow!.file_path),
      cwd: extractDir,
    });

    const snapshotDb = new Database(path.join(extractDir, 'database.sqlite'));
    try {
      const basePrompt = snapshotDb
        .prepare('SELECT * FROM system_prompts WHERE name = ?')
        .get('Base Prompt');
      expect(basePrompt).toBeDefined();
    } finally {
      snapshotDb.close();
    }
  });

  it('succeeds when a file in storage is deleted concurrently while copying the storage tree', async () => {
    const picturesDir = path.join(testStorageDir, 'pictures');
    fs.mkdirSync(picturesDir, { recursive: true });
    const ephemeralFile = path.join(picturesDir, 'ephemeral.png');
    fs.writeFileSync(ephemeralFile, 'ephemeral content');

    const originalCopyFile = fs.promises.copyFile.bind(fs.promises);
    vi.spyOn(fs.promises, 'copyFile').mockImplementation(
      async (src, dst, ...rest) => {
        if (
          typeof src === 'string' &&
          src.endsWith('ephemeral.png') &&
          fs.existsSync(src)
        ) {
          fs.unlinkSync(src);
        }
        return originalCopyFile(src, dst, ...rest);
      },
    );

    const result = await backupsService.createBackup();
    expect(result).toBeDefined();
    expect(result.hasArchive).toBe(true);
  });

  it('simulates a failure mid-creation; asserts no partial archive remains and no row was recorded', async () => {
    const writeSpy = vi
      .spyOn(fs.promises, 'writeFile')
      .mockRejectedValueOnce(
        new Error('Simulated I/O disk failure during manifest writing'),
      );

    await expect(backupsService.createBackup()).rejects.toThrow(
      InternalServerErrorException,
    );

    // Assert no row was recorded
    const rows = dbService.all('SELECT * FROM backups');
    expect(rows).toEqual([]);

    // Assert no partial or final archives exist in target dir
    const defaultBackupDir = path.join(testDataDir, 'backups');
    if (fs.existsSync(defaultBackupDir)) {
      const files = fs.readdirSync(defaultBackupDir);
      expect(
        files.filter((f) => f.endsWith('.tar.gz') || f.endsWith('.tmp')),
      ).toEqual([]);
    }

    writeSpy.mockRestore();
  });

  it('throws BadRequestException when target directory does not exist or is unwritable', async () => {
    const invalidDir = path.join(tempBaseDir, 'non-existent-directory-12345');
    dbService.run(
      'UPDATE backup_policy SET target_directory = ?, updated_at = ? WHERE id = 1',
      [invalidDir, nowIso()],
    );

    await expect(backupsService.createBackup()).rejects.toThrow(
      BadRequestException,
    );

    // Also test unwritable directory
    const readOnlyDir = path.join(tempBaseDir, 'read-only-dir');
    fs.mkdirSync(readOnlyDir, { recursive: true });
    // On POSIX platforms, test permissions
    if (process.platform !== 'win32') {
      fs.chmodSync(readOnlyDir, 0o444);
      dbService.run(
        'UPDATE backup_policy SET target_directory = ?, updated_at = ? WHERE id = 1',
        [readOnlyDir, nowIso()],
      );

      await expect(backupsService.createBackup()).rejects.toThrow(
        BadRequestException,
      );

      fs.chmodSync(readOnlyDir, 0o755);
    }
  });

  it('detects insufficient disk space and throws 507 Insufficient Storage', async () => {
    if (typeof fs.statfsSync === 'function') {
      const statfsSpy = vi.spyOn(fs, 'statfsSync').mockReturnValue({
        bavail: 0,
        bsize: 4096,
        blocks: 1000,
        bfree: 0,
        type: 0,
        ffree: 0,
        files: 0,
      } as any);

      await expect(backupsService.createBackup()).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(HttpException);
          expect((err as HttpException).getStatus()).toBe(
            HttpStatus.INSUFFICIENT_STORAGE,
          );
          return true;
        },
      );

      statfsSpy.mockRestore();
    }
  });

  it('never leaks provider credentials into log output during backup operations', async () => {
    const rawSecretApiKey = 'sk-ant-api03-super-secret-production-token-12345';
    fixtures.createCredential(undefined, {
      masked_preview: 'sk-ant-…12345',
      encrypted_value: Buffer.from(rawSecretApiKey),
    });

    const logs: string[] = [];
    const logSpy = vi
      .spyOn((backupsService as any).logger, 'log')
      .mockImplementation((msg: string) => logs.push(msg));
    const errorSpy = vi
      .spyOn((backupsService as any).logger, 'error')
      .mockImplementation((msg: string) => logs.push(msg));
    const warnSpy = vi
      .spyOn((backupsService as any).logger, 'warn')
      .mockImplementation((msg: string) => logs.push(msg));

    await backupsService.createBackup();

    for (const log of logs) {
      expect(log).not.toContain(rawSecretApiKey);
      expect(log).not.toContain('encrypted_value');
    }

    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  describe('findAll', () => {
    it('returns empty collection with total 0 when no backups exist', async () => {
      const result = await backupsService.findAll();
      expect(result).toEqual({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      });
    });

    it('returns backups sorted newest first by default, with pagination and trigger filter', async () => {
      dbService.run(
        'UPDATE backup_policy SET target_directory = ?, updated_at = ? WHERE id = 1',
        [testBackupTargetDir, nowIso()],
      );

      // Seed 3 backups with distinct timestamps
      const fakeArchive = path.join(testBackupTargetDir, 'dummy.tar.gz');
      fs.writeFileSync(fakeArchive, 'dummy bytes');

      dbService.run(
        `INSERT INTO backups (id, file_path, size_bytes, trigger, created_at)
         VALUES
         ('018f3a9e-0000-7000-8000-000000000001', ?, 100, 'manual', '2026-11-10T10:00:00.000Z'),
         ('018f3a9e-0000-7000-8000-000000000002', ?, 200, 'scheduled', '2026-11-12T10:00:00.000Z'),
         ('018f3a9e-0000-7000-8000-000000000003', ?, 300, 'manual', '2026-11-15T10:00:00.000Z')`,
        [fakeArchive, fakeArchive, fakeArchive],
      );

      // Default findAll should sort newest first (2026-11-15 first)
      const listDefault = await backupsService.findAll();
      expect(listDefault.total).toBe(3);
      expect(listDefault.items).toHaveLength(3);
      expect(listDefault.items[0].id).toBe(
        '018f3a9e-0000-7000-8000-000000000003',
      );
      expect(listDefault.items[1].id).toBe(
        '018f3a9e-0000-7000-8000-000000000002',
      );
      expect(listDefault.items[2].id).toBe(
        '018f3a9e-0000-7000-8000-000000000001',
      );

      // Assert no item exposes file_path
      for (const item of listDefault.items) {
        expect((item as any).file_path).toBeUndefined();
        expect((item as any).filePath).toBeUndefined();
        expect(item.hasArchive).toBe(true);
      }

      // Test trigger filter: 'manual'
      const manualOnly = await backupsService.findAll({
        trigger: 'manual',
      } as any);
      expect(manualOnly.total).toBe(2);
      expect(manualOnly.items.every((i) => i.trigger === 'manual')).toBe(true);

      // Test trigger filter: 'scheduled'
      const scheduledOnly = await backupsService.findAll({
        trigger: 'scheduled',
      } as any);
      expect(scheduledOnly.total).toBe(1);
      expect(scheduledOnly.items[0].id).toBe(
        '018f3a9e-0000-7000-8000-000000000002',
      );

      // Test pagination: limit 1, offset 1
      const paginated = await backupsService.findAll({
        limit: 1,
        offset: 1,
      } as any);
      expect(paginated.total).toBe(3);
      expect(paginated.limit).toBe(1);
      expect(paginated.offset).toBe(1);
      expect(paginated.items).toHaveLength(1);
      expect(paginated.items[0].id).toBe(
        '018f3a9e-0000-7000-8000-000000000002',
      );

      // Test invalid trigger filter throws BadRequestException
      await expect(
        backupsService.findAll({ trigger: 'invalid_trigger' as any } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne & findById', () => {
    it('returns backup metadata and reports archive presence', async () => {
      const backupResult = await backupsService.createBackup({
        trigger: 'manual',
        label: 'Retrieve Test',
      });

      const retrieved = await backupsService.findOne(backupResult.id);
      expect(retrieved).toMatchObject({
        id: backupResult.id,
        trigger: 'manual',
        sizeBytes: backupResult.sizeBytes,
        createdAt: backupResult.createdAt,
        hasArchive: true,
        isAvailable: true,
      });
      expect((retrieved as any).file_path).toBeUndefined();
      expect((retrieved as any).filePath).toBeUndefined();
    });

    it('reports hasArchive: false when the archive file is removed externally', async () => {
      const backupResult = await backupsService.createBackup();
      const row = dbService.get<{ file_path: string }>(
        'SELECT file_path FROM backups WHERE id = ?',
        [backupResult.id],
      );

      // Remove archive file on disk externally
      fs.unlinkSync(path.join(testDataDir, 'backups', row!.file_path));

      const retrieved = await backupsService.findOne(backupResult.id);
      expect(retrieved.id).toBe(backupResult.id);
      expect(retrieved.hasArchive).toBe(false);
      expect(retrieved.isAvailable).toBe(false);
    });

    it('throws NotFoundException (404) when retrieving unknown ID', async () => {
      await expect(
        backupsService.findOne('018f3a9e-0000-7000-8000-000000000999'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns null from findById when unknown ID is queried', async () => {
      const found = await backupsService.findById(
        '018f3a9e-0000-7000-8000-000000000999',
      );
      expect(found).toBeNull();
    });
  });

  describe('deleteBackup', () => {
    it('removes both the database row and the archive file from disk', async () => {
      const backupResult = await backupsService.createBackup();
      const row = dbService.get<{ file_path: string }>(
        'SELECT file_path FROM backups WHERE id = ?',
        [backupResult.id],
      );
      const archivePath = path.join(testDataDir, 'backups', row!.file_path);
      expect(fs.existsSync(archivePath)).toBe(true);

      await backupsService.deleteBackup(backupResult.id);

      // Verify row is deleted
      const checkRow = dbService.get('SELECT * FROM backups WHERE id = ?', [
        backupResult.id,
      ]);
      expect(checkRow).toBeUndefined();

      // Verify file is unlinked from disk
      expect(fs.existsSync(archivePath)).toBe(false);
    });

    it('succeeds and removes database row when archive file is already missing on disk', async () => {
      const backupResult = await backupsService.createBackup();
      const row = dbService.get<{ file_path: string }>(
        'SELECT file_path FROM backups WHERE id = ?',
        [backupResult.id],
      );

      // Manually delete file before calling deleteBackup
      const archivePath = path.join(testDataDir, 'backups', row!.file_path);
      fs.unlinkSync(archivePath);
      expect(fs.existsSync(archivePath)).toBe(false);

      await backupsService.deleteBackup(backupResult.id);

      // Verify row was removed cleanly
      const checkRow = dbService.get('SELECT * FROM backups WHERE id = ?', [
        backupResult.id,
      ]);
      expect(checkRow).toBeUndefined();
    });

    it('throws NotFoundException (404) when deleting unknown backup ID', async () => {
      await expect(
        backupsService.deleteBackup('018f3a9e-0000-7000-8000-000000000999'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getBackupArchive & resolveAndValidateArchivePath', () => {
    it('returns stream info with accurate size and readable stream of archive bytes', async () => {
      const backup = await backupsService.createBackup({
        trigger: 'manual',
        label: 'Download Test',
      });

      const archiveInfo = await backupsService.getBackupArchive(backup.id);
      expect(archiveInfo.id).toBe(backup.id);
      expect(archiveInfo.createdAt).toBe(backup.createdAt);
      expect(archiveInfo.sizeBytes).toBe(backup.sizeBytes);
      expect(typeof archiveInfo.openStream).toBe('function');

      const stream = archiveInfo.openStream();
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on('end', () => resolve());
        stream.on('error', reject);
      });

      const streamedBuffer = Buffer.concat(chunks);
      expect(streamedBuffer.length).toBe(backup.sizeBytes);

      const row = dbService.get<{ file_path: string }>(
        'SELECT file_path FROM backups WHERE id = ?',
        [backup.id],
      );
      const actualFileBytes = fs.readFileSync(
        path.join(testDataDir, 'backups', row!.file_path),
      );
      expect(streamedBuffer).toEqual(actualFileBytes);
    });

    it('supports scoped byte range in openStream', async () => {
      const backup = await backupsService.createBackup();
      const archiveInfo = await backupsService.getBackupArchive(backup.id);

      const stream = archiveInfo.openStream({ start: 0, end: 15 });
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on('end', () => resolve());
        stream.on('error', reject);
      });

      const streamedBuffer = Buffer.concat(chunks);
      expect(streamedBuffer.length).toBe(16);

      const row = dbService.get<{ file_path: string }>(
        'SELECT file_path FROM backups WHERE id = ?',
        [backup.id],
      );
      const actualFileBytes = fs.readFileSync(
        path.join(testDataDir, 'backups', row!.file_path),
      );
      expect(streamedBuffer).toEqual(actualFileBytes.subarray(0, 16));
    });

    it('throws NotFoundException (404) for unknown backup ID', async () => {
      await expect(
        backupsService.getBackupArchive('018f3a9e-0000-7000-8000-000000000999'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws GoneException (410) when row exists but archive file was deleted', async () => {
      const backup = await backupsService.createBackup();
      const row = dbService.get<{ file_path: string }>(
        'SELECT file_path FROM backups WHERE id = ?',
        [backup.id],
      );

      fs.unlinkSync(path.join(testDataDir, 'backups', row!.file_path));

      await expect(backupsService.getBackupArchive(backup.id)).rejects.toThrow(
        GoneException,
      );
    });

    it('rejects a database row whose file_path points outside the backup directory (absolute path)', async () => {
      const outsideId = '018f3a9e-0000-7000-8000-000000000888';
      const outsideFile = path.join(tempBaseDir, 'outside.tar.gz');
      fs.writeFileSync(outsideFile, 'secret outside archive');

      dbService.run(
        `INSERT INTO backups (id, file_path, size_bytes, trigger, created_at)
         VALUES (?, ?, 20, 'manual', ?)`,
        [outsideId, outsideFile, nowIso()],
      );

      await expect(
        backupsService.getBackupArchive(outsideId),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(BadRequestException);
        const res = (err as BadRequestException).getResponse();
        // Assert no absolute filesystem path appears in error response
        const resStr = JSON.stringify(res);
        expect(resStr).not.toContain(tempBaseDir);
        expect(resStr).not.toContain(outsideFile);
        expect((res as any).code).toBe('INVALID_BACKUP_PATH');
        return true;
      });
    });

    it('rejects a database row whose file_path contains directory traversal (relative ../)', async () => {
      const traversalId = '018f3a9e-0000-7000-8000-000000000777';
      dbService.run(
        `INSERT INTO backups (id, file_path, size_bytes, trigger, created_at)
         VALUES (?, '../../outside.tar.gz', 20, 'manual', ?)`,
        [traversalId, nowIso()],
      );

      await expect(
        backupsService.getBackupArchive(traversalId),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(BadRequestException);
        const res = (err as BadRequestException).getResponse();
        expect(JSON.stringify(res)).not.toContain('..');
        expect((res as any).code).toBe('INVALID_BACKUP_PATH');
        return true;
      });
    });

    it('rejects a database row whose file_path contains illegal null bytes', () => {
      expect(() =>
        backupsService.resolveAndValidateArchivePath({
          id: 'null-test',
          file_path: 'backup\0null.tar.gz',
          size_bytes: 10,
          trigger: 'manual',
          created_at: nowIso(),
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('restoreBackup', () => {
    async function createCustomArchive(
      archiveFile: string,
      files: Record<string, string | Buffer>,
    ) {
      const tmpStaging = fs.mkdtempSync(
        path.join(os.tmpdir(), 'test-craft-archive-'),
      );
      const fileNames = Object.keys(files);
      for (const name of fileNames) {
        const full = path.join(tmpStaging, name);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, files[name]);
      }
      await tar.create(
        { gzip: true, file: archiveFile, cwd: tmpStaging },
        fileNames,
      );
      await fs.promises.rm(tmpStaging, { recursive: true, force: true });
    }

    function createTraversalArchive(
      archiveFile: string,
      traversalEntryName: string,
    ) {
      const header = Buffer.alloc(512);
      header.write(traversalEntryName, 0, 100, 'utf8');
      header.write('0000644\0', 100, 8, 'utf8');
      header.write('0000000\0', 108, 8, 'utf8');
      header.write('0000000\0', 116, 8, 'utf8');
      const content = Buffer.from('malicious payload');
      const sizeOctal = content.length.toString(8).padStart(11, '0') + ' ';
      header.write(sizeOctal, 124, 12, 'utf8');
      const mtimeOctal =
        Math.floor(Date.now() / 1000)
          .toString(8)
          .padStart(11, '0') + ' ';
      header.write(mtimeOctal, 136, 12, 'utf8');
      header.write('        ', 148, 8, 'utf8');
      header.write('0', 156, 1, 'utf8');
      header.write('ustar\0', 257, 6, 'utf8');
      header.write('00', 263, 2, 'utf8');

      let sum = 0;
      for (let i = 0; i < 512; i++) {
        sum += header[i];
      }
      const chksumOctal = sum.toString(8).padStart(6, '0') + '\0 ';
      header.write(chksumOctal, 148, 8, 'utf8');

      const padLen = (512 - (content.length % 512)) % 512;
      const padding = Buffer.alloc(padLen);
      const endOfArchive = Buffer.alloc(1024);

      const tarBuf = Buffer.concat([header, content, padding, endOfArchive]);
      const gz = zlib.gzipSync(tarBuf);
      fs.writeFileSync(archiveFile, gz);
    }

    it('restores a valid backup and asserts database records and storage files match the archive snapshot', async () => {
      // 1. Seed initial data
      const prompt = fixtures.createSystemPrompt({
        name: 'Prompt Before Backup',
      });
      const provider = fixtures.createProvider({ name: 'Anthropic Before' });
      const model = fixtures.createModel({
        provider_id: provider.id,
        display_name: 'Claude 3.5 Sonnet',
      });
      const agent = fixtures.createAgent({
        name: 'Agent In Backup',
        system_prompt_id: prompt.id,
        model_id: model.id,
      });
      const chat = fixtures.createChat({
        agent_id: agent.id,
        title: 'Chat In Backup',
      });
      fixtures.createMessage({
        chat_id: chat.id,
        content: 'Message in backup',
      });

      // Seed file storage
      const avatarContent = Buffer.from('original avatar bytes');
      const avatarResult = await fileStorageService.write(
        'pictures',
        avatarContent,
        {
          declaredMimeType: 'image/png',
        },
      );

      // 2. Create the backup
      const backup = await backupsService.createBackup({
        trigger: 'manual',
        label: 'Golden Backup',
      });

      // 3. Mutate the active application state (add new data and files)
      const afterPrompt = fixtures.createSystemPrompt({
        name: 'Prompt Created After',
      });
      const afterAgent = fixtures.createAgent({
        name: 'Agent Created After',
        system_prompt_id: afterPrompt.id,
        model_id: model.id,
      });
      const afterFile = await fileStorageService.write(
        'pictures',
        Buffer.from('new picture after backup'),
        { declaredMimeType: 'image/png' },
      );

      // Verify mutated state exists before restore
      expect(
        dbService.get('SELECT id FROM agents WHERE id = ?', [afterAgent.id]),
      ).toBeDefined();
      expect(
        fs.existsSync(path.join(testStorageDir, afterFile.reference)),
      ).toBe(true);

      // 4. Perform restore
      const outcome = await backupsService.restoreBackup(backup.id, {
        confirm: 'true',
      });

      // Assert outcome response
      expect(outcome.backupId).toBe(backup.id);
      expect(outcome.databaseRestored).toBe(true);
      expect(outcome.filesRestored).toBe(1);
      expect(outcome.requiresRestart).toBe(true);
      expect(outcome.credentials.hasCredentials).toBe(false);

      // 5. Assert database records match the restored snapshot
      expect(
        dbService.get('SELECT id, name FROM agents WHERE id = ?', [agent.id]),
      ).toEqual({
        id: agent.id,
        name: 'Agent In Backup',
      });
      expect(
        dbService.get('SELECT id FROM chats WHERE id = ?', [chat.id]),
      ).toBeDefined();

      // Assert data created AFTER the backup has been destroyed
      expect(
        dbService.get('SELECT id FROM agents WHERE id = ?', [afterAgent.id]),
      ).toBeUndefined();

      // 6. Assert file storage matches restored snapshot
      expect(
        fs.existsSync(path.join(testStorageDir, avatarResult.reference)),
      ).toBe(true);
      const readAvatar = fs.readFileSync(
        path.join(testStorageDir, avatarResult.reference),
      );
      expect(readAvatar).toEqual(avatarContent);

      // Assert files created after backup are gone
      expect(
        fs.existsSync(path.join(testStorageDir, afterFile.reference)),
      ).toBe(false);

      // 7. Assert application remains fully functional and queryable
      expect(dbService.isOpen).toBe(true);
      const newPrompt = fixtures.createSystemPrompt({
        name: 'Post-Restore Prompt',
      });
      expect(
        dbService.get('SELECT name FROM system_prompts WHERE id = ?', [
          newPrompt.id,
        ]),
      ).toEqual({ name: 'Post-Restore Prompt' });
    });

    it('refuses restore without explicit confirmation and leaves application state untouched', async () => {
      const prompt = fixtures.createSystemPrompt({
        name: 'Unconfirmed Prompt',
      });
      const backup = await backupsService.createBackup({ trigger: 'manual' });

      // Call without confirm
      await expect(backupsService.restoreBackup(backup.id, {})).rejects.toThrow(
        BadRequestException,
      );

      // Call with confirm='false'
      await expect(
        backupsService.restoreBackup(backup.id, { confirm: 'false' }),
      ).rejects.toThrow(BadRequestException);

      // Assert state untouched
      expect(
        dbService.get('SELECT name FROM system_prompts WHERE id = ?', [
          prompt.id,
        ]),
      ).toBeDefined();
    });

    it('returns 404 NotFoundException when backup row does not exist', async () => {
      await expect(
        backupsService.restoreBackup('018f3a9e-0000-7000-8000-000000000999', {
          confirm: 'true',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns 404 NotFoundException when backup row exists but physical archive is missing', async () => {
      const backup = await backupsService.createBackup({ trigger: 'manual' });
      const row = dbService.get<{ file_path: string }>(
        'SELECT file_path FROM backups WHERE id = ?',
        [backup.id],
      );
      const targetDir = (backupsService as any).resolveTargetDirectory();
      const archivePath = path.join(targetDir, row!.file_path);
      fs.unlinkSync(archivePath);

      await expect(
        backupsService.restoreBackup(backup.id, { confirm: 'true' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses archive with newer or incompatible schema version with 409 Conflict, leaving state untouched', async () => {
      const prompt = fixtures.createSystemPrompt({
        name: 'Schema Test Prompt',
      });
      const id = newId();
      const targetDir = (backupsService as any).resolveTargetDirectory();
      const archiveFile = path.join(targetDir, `backup-${id}.tar.gz`);

      const dbSnapshotPath = path.join(tempBaseDir, 'test-incompat-db.sqlite');
      dbService.db.prepare('VACUUM INTO ?').run(dbSnapshotPath);

      const manifest: BackupManifest = {
        formatVersion: 1,
        createdAt: nowIso(),
        appVersion: '0.1.0',
        databaseSchemaVersion: '999_future_migration',
        fileInventory: [],
      };

      await createCustomArchive(archiveFile, {
        'manifest.json': JSON.stringify(manifest),
        'database.sqlite': fs.readFileSync(dbSnapshotPath),
      });

      dbService.run(
        `INSERT INTO backups (id, file_path, size_bytes, trigger, created_at)
         VALUES (?, ?, 100, 'manual', ?)`,
        [id, `backup-${id}.tar.gz`, nowIso()],
      );

      await expect(
        backupsService.restoreBackup(id, { confirm: 'true' }),
      ).rejects.toThrow(ConflictException);

      // Assert application state untouched
      expect(
        dbService.get('SELECT name FROM system_prompts WHERE id = ?', [
          prompt.id,
        ]),
      ).toBeDefined();
    });

    it('refuses corrupt archive with 422 Unprocessable Entity, leaving state untouched', async () => {
      const prompt = fixtures.createSystemPrompt({
        name: 'Corrupt Test Prompt',
      });
      const id = newId();
      const targetDir = (backupsService as any).resolveTargetDirectory();
      const archiveFile = path.join(targetDir, `backup-${id}.tar.gz`);

      // Write random garbage bytes
      fs.writeFileSync(
        archiveFile,
        Buffer.from('not a valid gzip tar archive at all'),
      );

      dbService.run(
        `INSERT INTO backups (id, file_path, size_bytes, trigger, created_at)
         VALUES (?, ?, 100, 'manual', ?)`,
        [id, `backup-${id}.tar.gz`, nowIso()],
      );

      await expect(
        backupsService.restoreBackup(id, { confirm: 'true' }),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(
        dbService.get('SELECT name FROM system_prompts WHERE id = ?', [
          prompt.id,
        ]),
      ).toBeDefined();
    });

    it('refuses archive with path traversal entry (../evil.txt) with 422, and never writes outside storage', async () => {
      const prompt = fixtures.createSystemPrompt({
        name: 'Traversal Test Prompt',
      });
      const id = newId();
      const targetDir = (backupsService as any).resolveTargetDirectory();
      const archiveFile = path.join(targetDir, `backup-${id}.tar.gz`);

      const escapedFile = path.join(tempBaseDir, 'evil.txt');
      if (fs.existsSync(escapedFile)) {
        fs.unlinkSync(escapedFile);
      }

      createTraversalArchive(archiveFile, '../evil.txt');

      dbService.run(
        `INSERT INTO backups (id, file_path, size_bytes, trigger, created_at)
         VALUES (?, ?, 100, 'manual', ?)`,
        [id, `backup-${id}.tar.gz`, nowIso()],
      );

      await expect(
        backupsService.restoreBackup(id, { confirm: 'true' }),
      ).rejects.toThrow(UnprocessableEntityException);

      // Assert traversal did NOT create file outside
      expect(fs.existsSync(escapedFile)).toBe(false);

      // Assert state untouched
      expect(
        dbService.get('SELECT name FROM system_prompts WHERE id = ?', [
          prompt.id,
        ]),
      ).toBeDefined();
    });

    it('refuses archive with missing manifest.json with 422 Unprocessable Entity', async () => {
      const id = newId();
      const targetDir = (backupsService as any).resolveTargetDirectory();
      const archiveFile = path.join(targetDir, `backup-${id}.tar.gz`);

      const dbSnapshotPath = path.join(tempBaseDir, 'no-manifest-db.sqlite');
      dbService.db.prepare('VACUUM INTO ?').run(dbSnapshotPath);

      await createCustomArchive(archiveFile, {
        'database.sqlite': fs.readFileSync(dbSnapshotPath),
      });

      dbService.run(
        `INSERT INTO backups (id, file_path, size_bytes, trigger, created_at)
         VALUES (?, ?, 100, 'manual', ?)`,
        [id, `backup-${id}.tar.gz`, nowIso()],
      );

      await expect(
        backupsService.restoreBackup(id, { confirm: 'true' }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('refuses archive whose database fails integrity_check with 422 Unprocessable Entity', async () => {
      const id = newId();
      const targetDir = (backupsService as any).resolveTargetDirectory();
      const archiveFile = path.join(targetDir, `backup-${id}.tar.gz`);

      const currentSchema = (backupsService as any).getDatabaseSchemaVersion();
      const manifest: BackupManifest = {
        formatVersion: 1,
        createdAt: nowIso(),
        appVersion: '0.1.0',
        databaseSchemaVersion: currentSchema,
        fileInventory: [],
      };

      await createCustomArchive(archiveFile, {
        'manifest.json': JSON.stringify(manifest),
        'database.sqlite': Buffer.from('SQLite format 3\0corrupted data here'),
      });

      dbService.run(
        `INSERT INTO backups (id, file_path, size_bytes, trigger, created_at)
         VALUES (?, ?, 100, 'manual', ?)`,
        [id, `backup-${id}.tar.gz`, nowIso()],
      );

      await expect(
        backupsService.restoreBackup(id, { confirm: 'true' }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('refuses archive with missing core database tables with 422 Unprocessable Entity', async () => {
      const id = newId();
      const targetDir = (backupsService as any).resolveTargetDirectory();
      const archiveFile = path.join(targetDir, `backup-${id}.tar.gz`);

      // Create a valid SQLite db with an unrelated table
      const emptyDbPath = path.join(tempBaseDir, 'unrelated.sqlite');
      const emptyDb = new Database(emptyDbPath);
      emptyDb.exec('CREATE TABLE some_random_table (id TEXT PRIMARY KEY);');
      emptyDb.close();

      const currentSchema = (backupsService as any).getDatabaseSchemaVersion();
      const manifest: BackupManifest = {
        formatVersion: 1,
        createdAt: nowIso(),
        appVersion: '0.1.0',
        databaseSchemaVersion: currentSchema,
        fileInventory: [],
      };

      await createCustomArchive(archiveFile, {
        'manifest.json': JSON.stringify(manifest),
        'database.sqlite': fs.readFileSync(emptyDbPath),
      });

      dbService.run(
        `INSERT INTO backups (id, file_path, size_bytes, trigger, created_at)
         VALUES (?, ?, 100, 'manual', ?)`,
        [id, `backup-${id}.tar.gz`, nowIso()],
      );

      await expect(
        backupsService.restoreBackup(id, { confirm: 'true' }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('refuses archive with mismatched inventory file checksum with 422 Unprocessable Entity', async () => {
      const id = newId();
      const targetDir = (backupsService as any).resolveTargetDirectory();
      const archiveFile = path.join(targetDir, `backup-${id}.tar.gz`);

      const dbSnapshotPath = path.join(tempBaseDir, 'checksum-test-db.sqlite');
      dbService.db.prepare('VACUUM INTO ?').run(dbSnapshotPath);

      const currentSchema = (backupsService as any).getDatabaseSchemaVersion();
      const manifest: BackupManifest = {
        formatVersion: 1,
        createdAt: nowIso(),
        appVersion: '0.1.0',
        databaseSchemaVersion: currentSchema,
        fileInventory: [
          {
            path: 'files/test.txt',
            sizeBytes: 11,
            sha256:
              'deadbeef00000000000000000000000000000000000000000000000000000000',
          },
        ],
      };

      await createCustomArchive(archiveFile, {
        'manifest.json': JSON.stringify(manifest),
        'database.sqlite': fs.readFileSync(dbSnapshotPath),
        'files/test.txt': Buffer.from('hello world'),
      });

      dbService.run(
        `INSERT INTO backups (id, file_path, size_bytes, trigger, created_at)
         VALUES (?, ?, 100, 'manual', ?)`,
        [id, `backup-${id}.tar.gz`, nowIso()],
      );

      await expect(
        backupsService.restoreBackup(id, { confirm: 'true' }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('rolls back and leaves pre-restore state intact on simulated failure after validation', async () => {
      const originalPrompt = fixtures.createSystemPrompt({
        name: 'Original Pre-Restore Prompt',
      });
      const backup = await backupsService.createBackup({ trigger: 'manual' });

      // Add data after backup
      const mutatedPrompt = fixtures.createSystemPrompt({
        name: 'Mutated State Prompt',
      });

      await expect(
        backupsService.restoreBackup(backup.id, {
          confirm: 'true',
          _simulateFailureAt: 'after-validation',
        }),
      ).rejects.toThrow(InternalServerErrorException);

      // Assert pre-restore state remained completely intact
      expect(
        dbService.get('SELECT name FROM system_prompts WHERE id = ?', [
          mutatedPrompt.id,
        ]),
      ).toBeDefined();
      expect(
        dbService.get('SELECT name FROM system_prompts WHERE id = ?', [
          originalPrompt.id,
        ]),
      ).toBeDefined();
      expect(dbService.isOpen).toBe(true);
    });

    it('rolls back database and leaves pre-restore state intact on simulated failure mid-database-replacement', async () => {
      const originalPrompt = fixtures.createSystemPrompt({
        name: 'Original Pre-Restore Prompt',
      });
      const backup = await backupsService.createBackup({ trigger: 'manual' });

      // Mutate state
      const mutatedPrompt = fixtures.createSystemPrompt({
        name: 'Mutated State Prompt',
      });

      await expect(
        backupsService.restoreBackup(backup.id, {
          confirm: 'true',
          _simulateFailureAt: 'mid-database-replacement',
        }),
      ).rejects.toThrow(InternalServerErrorException);

      // Assert rollback reconnected and restored the mutated active state
      expect(dbService.isOpen).toBe(true);
      expect(
        dbService.get('SELECT name FROM system_prompts WHERE id = ?', [
          mutatedPrompt.id,
        ]),
      ).toBeDefined();
      expect(
        dbService.get('SELECT name FROM system_prompts WHERE id = ?', [
          originalPrompt.id,
        ]),
      ).toBeDefined();
    });

    it('rolls back database and file storage to pre-restore state on simulated failure mid-file-replacement', async () => {
      const originalPrompt = fixtures.createSystemPrompt({
        name: 'Original Pre-Restore Prompt',
      });
      const backup = await backupsService.createBackup({ trigger: 'manual' });

      // Mutate database and storage state
      const mutatedPrompt = fixtures.createSystemPrompt({
        name: 'Mutated State Prompt',
      });
      const mutatedFile = await fileStorageService.write(
        'pictures',
        Buffer.from('mutated file content'),
        { declaredMimeType: 'image/png' },
      );

      await expect(
        backupsService.restoreBackup(backup.id, {
          confirm: 'true',
          _simulateFailureAt: 'mid-file-replacement',
        }),
      ).rejects.toThrow(InternalServerErrorException);

      // Assert rollback restored database
      expect(dbService.isOpen).toBe(true);
      expect(
        dbService.get('SELECT name FROM system_prompts WHERE id = ?', [
          mutatedPrompt.id,
        ]),
      ).toBeDefined();
      expect(
        dbService.get('SELECT name FROM system_prompts WHERE id = ?', [
          originalPrompt.id,
        ]),
      ).toBeDefined();

      // Assert rollback restored file storage
      expect(
        fs.existsSync(path.join(testStorageDir, mutatedFile.reference)),
      ).toBe(true);
    });

    it('reports credential situation when provider credentials cannot be decrypted', async () => {
      // Mock an encryption service that throws DecryptionError on decrypt
      const mockEncryptionService = {
        decrypt: vi.fn().mockImplementation(() => {
          throw new Error('Decryption failed: bad master key');
        }),
      } as any;

      const mockConfigWithDir = {
        dataDir: testDataDir,
        databasePath: path.join(testDataDir, 'test.db'),
      } as AppConfigService;

      const serviceWithMockCrypto = new BackupsService(
        dbService,
        fileStorageService,
        mockConfigWithDir,
        mockEncryptionService,
      );

      // Insert fake credential into current active db before creating a backup containing credentials
      const provider = fixtures.createProvider({ name: 'OpenAI Test' });
      dbService.run(
        `INSERT INTO provider_credentials (provider_id, encrypted_value, nonce, masked_preview, created_at, updated_at)
         VALUES (?, ?, ?, 'sk-123***', ?, ?)`,
        [
          provider.id,
          Buffer.from('encrypted ciphertext bytes'),
          Buffer.from('123456789012'),
          nowIso(),
          nowIso(),
        ],
      );

      const credBackup = await serviceWithMockCrypto.createBackup({
        trigger: 'manual',
      });

      const outcome = await serviceWithMockCrypto.restoreBackup(credBackup.id, {
        confirm: 'true',
      });

      expect(outcome.credentials.hasCredentials).toBe(true);
      expect(outcome.credentials.canDecrypt).toBe(false);
      expect(outcome.credentials.requiresReentry).toBe(true);
      expect(outcome.requiresCredentialReentry).toBe(true);
      expect(outcome.actionsRequired).toContain(
        'Re-enter provider API keys in Settings > Providers',
      );
    });

    it('reports credential situation when provider credentials decrypt successfully', async () => {
      const provider = fixtures.createProvider({ name: 'Google Test' });
      dbService.run(
        `INSERT INTO provider_credentials (provider_id, encrypted_value, nonce, masked_preview, created_at, updated_at)
         VALUES (?, ?, ?, 'AIza***', ?, ?)`,
        [
          provider.id,
          Buffer.from('encrypted ciphertext bytes'),
          Buffer.from('123456789012'),
          nowIso(),
          nowIso(),
        ],
      );

      const mockEncryptionService = {
        decrypt: vi.fn().mockReturnValue('decrypted-api-key-plaintext'),
      } as any;

      const mockConfigWithDir = {
        dataDir: testDataDir,
        databasePath: path.join(testDataDir, 'test.db'),
      } as AppConfigService;

      const serviceWithCrypto = new BackupsService(
        dbService,
        fileStorageService,
        mockConfigWithDir,
        mockEncryptionService,
      );

      const credBackup = await serviceWithCrypto.createBackup({
        trigger: 'manual',
      });

      const outcome = await serviceWithCrypto.restoreBackup(credBackup.id, {
        confirm: 'true',
      });

      expect(outcome.credentials.hasCredentials).toBe(true);
      expect(outcome.credentials.canDecrypt).toBe(true);
      expect(outcome.credentials.requiresReentry).toBe(false);
      expect(outcome.requiresCredentialReentry).toBe(false);
      expect(outcome.actionsRequired).not.toContain(
        'Re-enter provider API keys in Settings > Providers',
      );
    });

    it('refuses restore with 409 Conflict when another backup or restore is in progress', async () => {
      const backup = await backupsService.createBackup({ trigger: 'manual' });
      (backupsService as any).isBackupInProgress = true;

      await expect(
        backupsService.restoreBackup(backup.id, { confirm: 'true' }),
      ).rejects.toThrow(ConflictException);

      (backupsService as any).isBackupInProgress = false;
    });
  });

  describe('enforceRetention', () => {
    it('prunes oldest scheduled backups beyond retentionCount, deleting both database rows and archive files on disk', async () => {
      // Create 4 scheduled backups with distinct timestamps
      const b1 = await backupsService.createBackup({ trigger: 'scheduled' });
      const b2 = await backupsService.createBackup({ trigger: 'scheduled' });
      const b3 = await backupsService.createBackup({ trigger: 'scheduled' });
      const b4 = await backupsService.createBackup({ trigger: 'scheduled' });

      // Update timestamps so order is strictly deterministic: b1 oldest, b4 newest
      dbService.run(
        "UPDATE backups SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?",
        [b1.id],
      );
      dbService.run(
        "UPDATE backups SET created_at = '2026-01-02T00:00:00.000Z' WHERE id = ?",
        [b2.id],
      );
      dbService.run(
        "UPDATE backups SET created_at = '2026-01-03T00:00:00.000Z' WHERE id = ?",
        [b3.id],
      );
      dbService.run(
        "UPDATE backups SET created_at = '2026-01-04T00:00:00.000Z' WHERE id = ?",
        [b4.id],
      );

      const b1Path = path.join(
        testDataDir,
        'backups',
        `backup-${b1.id}.tar.gz`,
      );
      const b2Path = path.join(
        testDataDir,
        'backups',
        `backup-${b2.id}.tar.gz`,
      );
      const b3Path = path.join(
        testDataDir,
        'backups',
        `backup-${b3.id}.tar.gz`,
      );
      const b4Path = path.join(
        testDataDir,
        'backups',
        `backup-${b4.id}.tar.gz`,
      );

      expect(fs.existsSync(b1Path)).toBe(true);
      expect(fs.existsSync(b2Path)).toBe(true);
      expect(fs.existsSync(b3Path)).toBe(true);
      expect(fs.existsSync(b4Path)).toBe(true);

      // Retain 2: b4 and b3 should be kept; b2 and b1 should be pruned
      const pruned = await backupsService.enforceRetention(2);

      expect(pruned).toEqual([b2.id, b1.id]);

      // DB rows
      expect(await backupsService.findById(b1.id)).toBeNull();
      expect(await backupsService.findById(b2.id)).toBeNull();
      expect(await backupsService.findById(b3.id)).not.toBeNull();
      expect(await backupsService.findById(b4.id)).not.toBeNull();

      // Files on disk
      expect(fs.existsSync(b1Path)).toBe(false);
      expect(fs.existsSync(b2Path)).toBe(false);
      expect(fs.existsSync(b3Path)).toBe(true);
      expect(fs.existsSync(b4Path)).toBe(true);
    });

    it('never prunes manual backups, strictly preserving them regardless of retentionCount', async () => {
      // Create 2 manual backups and 3 scheduled backups
      const m1 = await backupsService.createBackup({ trigger: 'manual' });
      const m2 = await backupsService.createBackup({ trigger: 'manual' });

      const s1 = await backupsService.createBackup({ trigger: 'scheduled' });
      const s2 = await backupsService.createBackup({ trigger: 'scheduled' });
      const s3 = await backupsService.createBackup({ trigger: 'scheduled' });

      // Timestamps: manual ones are older than scheduled ones
      dbService.run(
        "UPDATE backups SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?",
        [m1.id],
      );
      dbService.run(
        "UPDATE backups SET created_at = '2026-01-02T00:00:00.000Z' WHERE id = ?",
        [m2.id],
      );
      dbService.run(
        "UPDATE backups SET created_at = '2026-01-03T00:00:00.000Z' WHERE id = ?",
        [s1.id],
      );
      dbService.run(
        "UPDATE backups SET created_at = '2026-01-04T00:00:00.000Z' WHERE id = ?",
        [s2.id],
      );
      dbService.run(
        "UPDATE backups SET created_at = '2026-01-05T00:00:00.000Z' WHERE id = ?",
        [s3.id],
      );

      const m1Path = path.join(
        testDataDir,
        'backups',
        `backup-${m1.id}.tar.gz`,
      );
      const m2Path = path.join(
        testDataDir,
        'backups',
        `backup-${m2.id}.tar.gz`,
      );
      const s1Path = path.join(
        testDataDir,
        'backups',
        `backup-${s1.id}.tar.gz`,
      );
      const s2Path = path.join(
        testDataDir,
        'backups',
        `backup-${s2.id}.tar.gz`,
      );
      const s3Path = path.join(
        testDataDir,
        'backups',
        `backup-${s3.id}.tar.gz`,
      );

      // Retain 1 scheduled backup: should prune s1 and s2, but NEVER m1 or m2
      const pruned = await backupsService.enforceRetention(1);

      expect(pruned).toEqual([s2.id, s1.id]);

      // Scheduled backups: s1 and s2 deleted, s3 retained
      expect(await backupsService.findById(s1.id)).toBeNull();
      expect(await backupsService.findById(s2.id)).toBeNull();
      expect(await backupsService.findById(s3.id)).not.toBeNull();
      expect(fs.existsSync(s1Path)).toBe(false);
      expect(fs.existsSync(s2Path)).toBe(false);
      expect(fs.existsSync(s3Path)).toBe(true);

      // Manual backups: both MUST be preserved
      expect(await backupsService.findById(m1.id)).not.toBeNull();
      expect(await backupsService.findById(m2.id)).not.toBeNull();
      expect(fs.existsSync(m1Path)).toBe(true);
      expect(fs.existsSync(m2Path)).toBe(true);
    });

    it('does not prune when scheduled backups count is less than or equal to retentionCount', async () => {
      const b1 = await backupsService.createBackup({ trigger: 'scheduled' });
      const b2 = await backupsService.createBackup({ trigger: 'scheduled' });

      const pruned = await backupsService.enforceRetention(5);
      expect(pruned).toEqual([]);

      expect(await backupsService.findById(b1.id)).not.toBeNull();
      expect(await backupsService.findById(b2.id)).not.toBeNull();
    });

    it('defensively aborts retention on non-positive or invalid retentionCount without deleting any backups', async () => {
      const b1 = await backupsService.createBackup({ trigger: 'scheduled' });
      const b2 = await backupsService.createBackup({ trigger: 'scheduled' });

      expect(await backupsService.enforceRetention(0)).toEqual([]);
      expect(await backupsService.enforceRetention(-5)).toEqual([]);
      expect(await backupsService.enforceRetention(NaN)).toEqual([]);
      expect(await backupsService.enforceRetention(null as any)).toEqual([]);
      expect(await backupsService.enforceRetention('7' as any)).toEqual([]);

      // All backups remain intact
      expect(await backupsService.findById(b1.id)).not.toBeNull();
      expect(await backupsService.findById(b2.id)).not.toBeNull();
    });
  });
});
