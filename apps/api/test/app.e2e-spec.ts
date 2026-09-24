import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { configureApp, registerNotFoundFallback } from './../src/bootstrap.js';
import { DatabaseService } from './../src/database/database.service.js';

describe('Health and Root endpoints (e2e)', () => {
  let app: INestApplication<App>;
  let dbService: DatabaseService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    registerNotFoundFallback(app);

    dbService = app.get(DatabaseService);
  });

  it('/api/v1 (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1')
      .expect(200)
      .expect('Glassbeetle API');
  });

  it('/api/v1/health (GET) - healthy response when database is reachable', () => {
    return request(app.getHttpServer())
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
    vi.spyOn(dbService, 'get').mockImplementation(() => {
      throw new Error('Database disconnected');
    });

    return request(app.getHttpServer())
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
      return request(app.getHttpServer()).get(path).expect(404);
    },
  );

  afterEach(async () => {
    await app.close();
  });
});
