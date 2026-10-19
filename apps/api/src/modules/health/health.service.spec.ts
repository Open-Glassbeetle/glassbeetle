import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service.js';
import { FileStorageService } from '../../file-storage/file-storage.service.js';
import { HealthService } from './health.service.js';

// Root ignores directory permissions, so an unwritable directory cannot be
// simulated with chmod there.
const runningAsRoot = process.getuid?.() === 0;

describe('HealthService', () => {
  let service: HealthService;
  let dbService: DatabaseService;
  let storageRoot: string;

  beforeEach(async () => {
    storageRoot = mkdtempSync(join(tmpdir(), 'glassbeetle-health-'));

    const mockDbService = {
      get: vi.fn().mockReturnValue({ '1': 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: DatabaseService,
          useValue: mockDbService,
        },
        {
          provide: FileStorageService,
          useValue: { storageRoot },
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
    dbService = module.get<DatabaseService>(DatabaseService);
  });

  afterEach(() => {
    if (existsSync(storageRoot)) {
      chmodSync(storageRoot, 0o700);
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it('returns a healthy response shape when database is reachable', async () => {
    const health = await service.getHealth();

    expect(health.status).toBe('ok');
    expect(health.service).toBe('glassbeetle-api');
    expect(health.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(health.timestamp))).toBe(false);
    expect(health.checks.database.status).toBe('up');
    expect(health.checks.storage).toEqual({ status: 'up' });
    expect(dbService.get).toHaveBeenCalledWith('SELECT 1');
  });

  it('increases uptimeSeconds over time', async () => {
    const initialHealth = await service.getHealth();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const laterHealth = await service.getHealth();

    expect(laterHealth.uptimeSeconds).toBeGreaterThan(
      initialHealth.uptimeSeconds,
    );
  });

  it('returns a degraded status when the database check throws an error', async () => {
    vi.spyOn(dbService, 'get').mockImplementation(() => {
      throw new Error('Database connection failed');
    });

    const health = await service.getHealth();

    expect(health.status).toBe('degraded');
    expect(health.checks.database.status).toBe('down');
    expect(health.checks.database.error).toBe('Database connection failed');
  });

  it('returns not_configured when DatabaseService is not available', async () => {
    const unconfiguredService = new HealthService(undefined, {
      storageRoot,
    } as FileStorageService);
    const health = await unconfiguredService.getHealth();

    expect(health.status).toBe('degraded');
    expect(health.checks.database.status).toBe('not_configured');
  });

  describe('storage', () => {
    it('returns not_configured when FileStorageService is not available', async () => {
      const unconfiguredService = new HealthService(dbService, undefined);
      const health = await unconfiguredService.getHealth();

      expect(health.status).toBe('degraded');
      expect(health.checks.database.status).toBe('up');
      expect(health.checks.storage).toEqual({ status: 'not_configured' });
    });

    it.skipIf(runningAsRoot)(
      'is down when the storage root is not writable',
      async () => {
        chmodSync(storageRoot, 0o500);

        const health = await service.getHealth();

        expect(health.status).toBe('degraded');
        expect(health.checks.database.status).toBe('up');
        expect(health.checks.storage).toEqual({
          status: 'down',
          error: 'Storage root is not writable (EACCES)',
        });
      },
    );

    it('is down when the storage root does not exist, without creating it', async () => {
      rmSync(storageRoot, { recursive: true });

      const health = await service.getHealth();

      expect(health.status).toBe('degraded');
      expect(health.checks.storage).toEqual({
        status: 'down',
        error: 'Storage root does not exist (ENOENT)',
      });
      expect(existsSync(storageRoot)).toBe(false);
    });

    it('is down when the storage root is a file', async () => {
      const file = join(storageRoot, 'not-a-directory');
      writeFileSync(file, '');
      const fileService = new HealthService(dbService, {
        storageRoot: file,
      } as FileStorageService);

      const health = await fileService.getHealth();

      expect(health.status).toBe('degraded');
      expect(health.checks.storage).toEqual({
        status: 'down',
        error: 'Storage root is not a directory',
      });
    });

    it('does not put the storage path in the error', async () => {
      rmSync(storageRoot, { recursive: true });

      const health = await service.getHealth();

      expect(health.checks.storage.error).not.toContain(storageRoot);
    });
  });
});
