import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { configureApp, registerNotFoundFallback } from './../src/bootstrap.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Apply the same global configuration production uses, so these tests
    // exercise the real request pipeline rather than a bare one.
    configureApp(app);
    await app.init();
    registerNotFoundFallback(app);
  });

  it('/api/v1 (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1')
      .expect(200)
      .expect('Glassbeetle API');
  });

  it('/api/v1/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ok');
        expect(res.body.service).toBe('glassbeetle-api');
        expect(typeof res.body.uptimeSeconds).toBe('number');
        expect(typeof res.body.timestamp).toBe('string');
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
