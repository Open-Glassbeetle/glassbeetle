import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Test, TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppConfigService } from '../config/app-config.service.js';
import {
  FileNotFoundError,
  FilePayloadTooLargeError,
  InvalidPathError,
  UnsupportedMediaTypeError,
} from './file-storage.errors.js';
import {
  FILE_STORAGE_ROOT_OVERRIDE,
  FileStorageService,
} from './file-storage.service.js';
import { KNOWN_STORAGE_BUCKETS } from './file-storage.types.js';

describe('FileStorageService', () => {
  let service: FileStorageService;
  let tempStorageRoot: string;

  beforeEach(async () => {
    tempStorageRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'gb-storage-test-'),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileStorageService,
        {
          provide: FILE_STORAGE_ROOT_OVERRIDE,
          useValue: tempStorageRoot,
        },
      ],
    }).compile();

    service = module.get<FileStorageService>(FileStorageService);
    await service.onModuleInit();
  });

  afterEach(async () => {
    await fs.rm(tempStorageRoot, { recursive: true, force: true });
  });

  it('initializes and creates storage root and all known bucket directories on startup', async () => {
    expect(await fs.stat(tempStorageRoot)).toBeDefined();

    for (const bucket of KNOWN_STORAGE_BUCKETS) {
      const bucketDir = path.join(tempStorageRoot, bucket);
      const stat = await fs.stat(bucketDir);
      expect(stat.isDirectory()).toBe(true);
    }
  });

  describe('Write, Read, Stat, Exists, Delete round trip', () => {
    it('writes a buffer, reads it back, checks existence, stats it, and deletes it', async () => {
      const pngBytes = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52,
      ]);

      // 1. Write
      const writeResult = await service.write('pictures', pngBytes);
      expect(writeResult.reference).toMatch(/^pictures\/[0-9a-f-]+\.png$/);
      expect(writeResult.size).toBe(pngBytes.length);
      expect(writeResult.contentType).toBe('image/png');

      // 2. Exists
      expect(await service.exists(writeResult.reference)).toBe(true);

      // 3. Read
      const readBuffer = await service.read(writeResult.reference);
      expect(readBuffer).toEqual(pngBytes);

      // 4. Stat
      const statResult = await service.stat(writeResult.reference);
      expect(statResult.size).toBe(pngBytes.length);
      expect(statResult.contentType).toBe('image/png');
      expect(statResult.modifiedAt).toBeInstanceOf(Date);
      expect(statResult.createdAt).toBeInstanceOf(Date);

      // 5. Delete
      await service.delete(writeResult.reference);
      expect(await service.exists(writeResult.reference)).toBe(false);

      // 6. Read after delete throws FileNotFoundError
      await expect(service.read(writeResult.reference)).rejects.toThrow(
        FileNotFoundError,
      );
    });

    it('writes text string content and detects text/plain or json accordingly', async () => {
      const jsonContent = JSON.stringify({
        name: 'Glassbeetle',
        version: '0.1.0',
      });
      const result = await service.write('artifacts', jsonContent);

      expect(result.reference).toMatch(/^artifacts\/[0-9a-f-]+\.json$/);
      expect(result.contentType).toBe('application/json');

      const readBack = await service.read(result.reference);
      expect(readBack.toString('utf-8')).toBe(jsonContent);
    });
  });

  describe('Streaming reads and writes', () => {
    it('writes from a stream and streams back the file content', async () => {
      const sampleData = Buffer.from('%PDF-1.7\nSample PDF payload stream');
      const inputStream = Readable.from(sampleData);

      const writeResult = await service.write('artifacts', inputStream);
      expect(writeResult.reference).toMatch(/^artifacts\/[0-9a-f-]+\.pdf$/);
      expect(writeResult.size).toBe(sampleData.length);
      expect(writeResult.contentType).toBe('application/pdf');

      // Stream read
      const readStream = await service.stream(writeResult.reference);
      const chunks: Buffer[] = [];
      for await (const chunk of readStream) {
        chunks.push(chunk as Buffer);
      }
      const streamResult = Buffer.concat(chunks);
      expect(streamResult).toEqual(sampleData);
    });
  });

  describe('Deleting non-existent files', () => {
    it('deleting a non-existent file succeeds silently without throwing', async () => {
      await expect(
        service.delete('pictures/018f0000-0000-7000-8000-000000000000.png'),
      ).resolves.toBeUndefined();
    });
  });

  describe('Missing files operations', () => {
    it('read throws FileNotFoundError for missing file', async () => {
      await expect(service.read('pictures/missing.png')).rejects.toThrow(
        FileNotFoundError,
      );
    });

    it('stream throws FileNotFoundError for missing file', async () => {
      await expect(service.stream('pictures/missing.png')).rejects.toThrow(
        FileNotFoundError,
      );
    });

    it('stat throws FileNotFoundError for missing file', async () => {
      await expect(service.stat('pictures/missing.png')).rejects.toThrow(
        FileNotFoundError,
      );
    });

    it('exists returns false for missing file', async () => {
      expect(await service.exists('pictures/missing.png')).toBe(false);
    });
  });

  describe('Adversarial Path Containment and Security', () => {
    const maliciousTraversalReferences = [
      '../../etc/passwd',
      '../outside.txt',
      'pictures/../../../etc/passwd',
      'pictures/../../../../../../etc/shadow',
      'artifacts/..%2f..%2fetc%2fpasswd',
      'backups/..%2f..%2f..%2fetc%2fhosts',
      '..\\..\\windows\\system32\\calc.exe',
      'pictures\\..\\..\\secret.txt',
      '/etc/passwd',
      '/var/data/evil',
      'C:\\Windows\\System32\\cmd.exe',
      'C:/Windows/System32/cmd.exe',
      '\\\\server\\share\\evil.txt',
      'pictures/photo.png\0.exe',
      'pictures/photo.png%00.exe',
      '',
      '   ',
      '.',
      '..',
      '/',
      '\\',
    ];

    maliciousTraversalReferences.forEach((ref) => {
      it(`rejects traversal or absolute path "${ref}" across all operations`, async () => {
        await expect(service.read(ref)).rejects.toThrow(InvalidPathError);
        await expect(service.stream(ref)).rejects.toThrow(InvalidPathError);
        await expect(service.stat(ref)).rejects.toThrow(InvalidPathError);
        await expect(service.delete(ref)).rejects.toThrow(InvalidPathError);
        await expect(service.exists(ref)).rejects.toThrow(InvalidPathError);
        await expect(service.resolveAndVerify(ref)).rejects.toThrow(
          InvalidPathError,
        );
      });
    });

    it('rejects invalid or traversal bucket names on write', async () => {
      const data = Buffer.from('test');
      await expect(service.write('../evil' as any, data)).rejects.toThrow(
        InvalidPathError,
      );
      await expect(service.write('/evil' as any, data)).rejects.toThrow(
        InvalidPathError,
      );
      await expect(service.write('bucket/nested' as any, data)).rejects.toThrow(
        InvalidPathError,
      );
    });

    it('rejects sibling directory sharing the root prefix (sibling prefix attack)', async () => {
      // Create sibling directory: e.g. <tempStorageRoot>-evil
      const siblingDir = `${tempStorageRoot}-evil`;
      await fs.mkdir(siblingDir, { recursive: true });
      const secretFile = path.join(siblingDir, 'secret.txt');
      await fs.writeFile(secretFile, 'secret data');

      try {
        // Attempt to access via ../<name>-evil/secret.txt
        const rootBaseName = path.basename(tempStorageRoot);
        const maliciousRef = `../${rootBaseName}-evil/secret.txt`;

        await expect(service.read(maliciousRef)).rejects.toThrow(
          InvalidPathError,
        );
        await expect(service.stat(maliciousRef)).rejects.toThrow(
          InvalidPathError,
        );
        await expect(service.delete(maliciousRef)).rejects.toThrow(
          InvalidPathError,
        );
        await expect(service.exists(maliciousRef)).rejects.toThrow(
          InvalidPathError,
        );
      } finally {
        await fs.rm(siblingDir, { recursive: true, force: true });
      }
    });

    it('rejects a symlink inside the storage root pointing outside', async () => {
      const outsideDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'gb-storage-outside-'),
      );
      const outsideSecret = path.join(outsideDir, 'outside-secret.txt');
      await fs.writeFile(outsideSecret, 'top secret info');

      try {
        // Create symlink inside pictures pointing to outside file
        const symlinkFile = path.join(
          tempStorageRoot,
          'pictures',
          'evil-symlink.txt',
        );
        await fs.symlink(outsideSecret, symlinkFile);

        const symlinkRef = 'pictures/evil-symlink.txt';

        await expect(service.read(symlinkRef)).rejects.toThrow(
          InvalidPathError,
        );
        await expect(service.stat(symlinkRef)).rejects.toThrow(
          InvalidPathError,
        );
        await expect(service.stream(symlinkRef)).rejects.toThrow(
          InvalidPathError,
        );
        await expect(service.exists(symlinkRef)).rejects.toThrow(
          InvalidPathError,
        );
        await expect(service.delete(symlinkRef)).rejects.toThrow(
          InvalidPathError,
        );
      } finally {
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('rejects a symlinked directory inside the storage root pointing outside', async () => {
      const outsideDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'gb-storage-outside-dir-'),
      );
      const outsideFile = path.join(outsideDir, 'target.txt');
      await fs.writeFile(outsideFile, 'target content');

      try {
        // Create symlink directory inside pictures pointing to outside directory
        const symlinkDir = path.join(
          tempStorageRoot,
          'pictures',
          'external-dir',
        );
        await fs.symlink(outsideDir, symlinkDir, 'dir');

        const symlinkRef = 'pictures/external-dir/target.txt';

        await expect(service.read(symlinkRef)).rejects.toThrow(
          InvalidPathError,
        );
        await expect(service.stat(symlinkRef)).rejects.toThrow(
          InvalidPathError,
        );
        await expect(service.stream(symlinkRef)).rejects.toThrow(
          InvalidPathError,
        );
        await expect(service.exists(symlinkRef)).rejects.toThrow(
          InvalidPathError,
        );
        await expect(service.delete(symlinkRef)).rejects.toThrow(
          InvalidPathError,
        );
      } finally {
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  describe('Content-Type Byte Detection & Lying Header Defense', () => {
    it('detects actual content from bytes and rejects when lying type is disguised', async () => {
      // Disguised payload: A ZIP archive disguised as a JPEG
      const zipBytes = Buffer.from([
        0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00,
      ]);

      // If caller expects only images, the detected ZIP type will be rejected
      await expect(
        service.write('pictures', zipBytes, {
          allowedMimeTypes: ['image/jpeg', 'image/png'],
        }),
      ).rejects.toThrow(UnsupportedMediaTypeError);
    });

    it('derives stored extension from detected bytes, ignoring input file extension', async () => {
      const jpegBytes = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
      ]);

      const result = await service.write('pictures', jpegBytes);
      expect(result.contentType).toBe('image/jpeg');
      expect(result.reference.endsWith('.jpg')).toBe(true);
    });
  });

  describe('Max Size Limit Enforcement', () => {
    it('rejects oversized Buffer write and does not write to disk', async () => {
      const largeBuffer = Buffer.alloc(1024 * 1024); // 1MB

      await expect(
        service.write('artifacts', largeBuffer, { maxBytes: 500 * 1024 }),
      ).rejects.toThrow(FilePayloadTooLargeError);

      // Verify bucket remains clean
      const artifactsDir = path.join(tempStorageRoot, 'artifacts');
      const files = await fs.readdir(artifactsDir);
      expect(files).toHaveLength(0);
    });

    it('aborts and cleans up temp file when stream exceeds maxBytes', async () => {
      // Create stream with 100KB chunks totaling 500KB
      const chunk = Buffer.alloc(100 * 1024, 0x41);
      const stream = new Readable({
        read() {
          this.push(chunk);
          this.push(chunk);
          this.push(chunk);
          this.push(chunk);
          this.push(chunk);
          this.push(null);
        },
      });

      await expect(
        service.write('backups', stream, { maxBytes: 250 * 1024 }),
      ).rejects.toThrow(FilePayloadTooLargeError);

      // Ensure temporary files were cleaned up
      const backupsDir = path.join(tempStorageRoot, 'backups');
      const files = await fs.readdir(backupsDir);
      expect(files.filter((f) => f.startsWith('.tmp'))).toHaveLength(0);
    });
  });

  describe('Concurrency & Collision Safety', () => {
    it('performs concurrent writes without colliding on generated filenames', async () => {
      const writePromises = Array.from({ length: 50 }, (_, i) => {
        const payload = Buffer.from(
          JSON.stringify({ index: i, timestamp: Date.now() }),
        );
        return service.write('artifacts', payload);
      });

      const results = await Promise.all(writePromises);
      const references = results.map((r) => r.reference);
      const uniqueRefs = new Set(references);

      expect(uniqueRefs.size).toBe(50);

      // Read back all 50 files concurrently
      const readPromises = results.map(async (res, i) => {
        const content = await service.read(res.reference);
        const parsed = JSON.parse(content.toString('utf-8'));
        expect(parsed.index).toBe(i);
      });

      await Promise.all(readPromises);
    });
  });

  describe('Configuration seam and fallback behavior', () => {
    it('uses AppConfigService dataDir when injected', async () => {
      const mockDataDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'gb-appconfig-test-'),
      );
      const mockAppConfigService = {
        dataDir: mockDataDir,
      } as unknown as AppConfigService;

      const customService = new FileStorageService(mockAppConfigService);
      expect(customService.storageRoot).toBe(path.join(mockDataDir, 'storage'));

      await fs.rm(mockDataDir, { recursive: true, force: true });
    });
  });
});
