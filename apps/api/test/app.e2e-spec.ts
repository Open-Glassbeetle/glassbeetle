import { chmodSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestApp, TestApp } from './harness/index.js';

// Root ignores directory permissions, so an unwritable directory cannot be
// simulated with chmod there.
const runningAsRoot = process.getuid?.() === 0;

describe('Health and Root endpoints (e2e)', () => {
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

  it('/api/v1 (GET)', () => {
    return testApp
      .request()
      .get('/api/v1')
      .expect(200)
      .expect('Glassbeetle API');
  });

  it('/api/v1/health (GET) - healthy response when database is reachable', () => {
    return testApp
      .request()
      .get('/api/v1/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ok');
        expect(res.body.service).toBe('glassbeetle-api');
        expect(typeof res.body.uptimeSeconds).toBe('number');
        expect(typeof res.body.timestamp).toBe('string');
        expect(res.body.checks).toEqual({
          database: {
            status: 'up',
          },
          storage: {
            status: 'up',
          },
        });
      });
  });

  it('/api/v1/health (GET) - returns 503 degraded status when database check fails', () => {
    vi.spyOn(testApp.db, 'get').mockImplementation(() => {
      throw new Error('Database disconnected');
    });

    return testApp
      .request()
      .get('/api/v1/health')
      .expect(503)
      .expect((res) => {
        expect(res.body.status).toBe('degraded');
        expect(res.body.service).toBe('glassbeetle-api');
        expect(typeof res.body.uptimeSeconds).toBe('number');
        expect(typeof res.body.timestamp).toBe('string');
        expect(res.body.checks.database).toEqual({
          status: 'down',
          error: 'Database disconnected',
        });
      });
  });

  it.each(['/api', '/api/health'])(
    'no longer serves the unversioned path %s',
    (path) => {
      return testApp.request().get(path).expect(404);
    },
  );
});

describe('Health storage check (e2e)', () => {
  let testApp: TestApp;
  let storageRoot: string;
  let previousStorageRoot: string | undefined;

  beforeAll(async () => {
    storageRoot = mkdtempSync(join(tmpdir(), 'glassbeetle-health-e2e-'));
    previousStorageRoot = process.env.GLASSBEETLE_STORAGE_ROOT;
    process.env.GLASSBEETLE_STORAGE_ROOT = storageRoot;
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
    if (previousStorageRoot === undefined) {
      delete process.env.GLASSBEETLE_STORAGE_ROOT;
    } else {
      process.env.GLASSBEETLE_STORAGE_ROOT = previousStorageRoot;
    }
    if (existsSync(storageRoot)) {
      chmodSync(storageRoot, 0o700);
      rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it('reports storage up when the storage root is writable', () => {
    return testApp
      .request()
      .get('/api/v1/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ok');
        expect(res.body.checks.storage).toEqual({ status: 'up' });
      });
  });

  it.skipIf(runningAsRoot)(
    'returns 503 degraded when the storage root is not writable, and recovers',
    async () => {
      chmodSync(storageRoot, 0o500);
      try {
        const res = await testApp.request().get('/api/v1/health').expect(503);

        expect(res.body.status).toBe('degraded');
        expect(res.body.checks.database).toEqual({ status: 'up' });
        expect(res.body.checks.storage).toEqual({
          status: 'down',
          error: 'Storage root is not writable (EACCES)',
        });
      } finally {
        chmodSync(storageRoot, 0o700);
      }

      await testApp.request().get('/api/v1/health').expect(200);
    },
  );

  it('returns 503 degraded when the storage root is missing, and does not recreate it', async () => {
    rmSync(storageRoot, { recursive: true, force: true });

    const res = await testApp.request().get('/api/v1/health').expect(503);

    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.storage).toEqual({
      status: 'down',
      error: 'Storage root does not exist (ENOENT)',
    });
    expect(JSON.stringify(res.body)).not.toContain(storageRoot);
    expect(existsSync(storageRoot)).toBe(false);
  });
});
