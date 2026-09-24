import { createTestApp, TestApp } from './harness/index.js';

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
