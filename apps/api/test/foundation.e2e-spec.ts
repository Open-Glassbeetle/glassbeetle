import { Body, Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { configureApp, registerNotFoundFallback } from './../src/bootstrap.js';
import { OPENAPI_JSON_PATH, setupOpenApi } from './../src/openapi/openapi.js';

/**
 * Body used to exercise the global validation pipe end to end.
 */
class ProbeDto {
  @IsString()
  name!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;
}

/**
 * Throwaway controller used only by these tests. Feature endpoints are tracked
 * by their own issues; this exists to prove the shared pipeline behaves.
 */
@Controller('probe')
class ProbeController {
  @Post()
  create(@Body() body: ProbeDto): ProbeDto {
    return body;
  }

  @Get('boom')
  boom(): never {
    throw new Error(
      'SQLITE_ERROR: no such table: agents at /home/ada/secret.db',
    );
  }

  @Get('thrown-string')
  thrownString(): never {
    // eslint-disable-next-line no-throw-literal
    throw 'a bare string';
  }
}

describe('API foundation (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    setupOpenApi(app);
    await app.init();
    registerNotFoundFallback(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('versioning', () => {
    it('serves routes under /api/v1', async () => {
      await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    });

    it('does not serve the unversioned path', async () => {
      await request(app.getHttpServer()).get('/api/health').expect(404);
    });
  });

  describe('correlation ID', () => {
    it('returns a generated X-Request-Id header when none is provided', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(res.headers['x-request-id']).toBeDefined();
      expect(res.headers['x-request-id'].length).toBeGreaterThan(10);
    });

    it('preserves an inbound X-Request-Id header', async () => {
      const customId = 'e2e-client-req-999';
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('X-Request-Id', customId)
        .expect(200);

      expect(res.headers['x-request-id']).toBe(customId);
    });
  });

  describe('request validation', () => {
    it('accepts a valid body', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/probe')
        .send({ name: 'Ada', score: 10 })
        .expect(201);

      expect(res.body).toEqual({ name: 'Ada', score: 10 });
    });

    it('rejects a missing required field', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/probe')
        .send({})
        .expect(400);

      expect(res.body.details.join(' ')).toContain('name');
    });

    it('rejects a wrong-typed field and names it', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/probe')
        .send({ name: 'Ada', score: 'not a number' })
        .expect(400);

      expect(res.body.details.join(' ')).toContain('score');
    });

    it('rejects an out-of-range value', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/probe')
        .send({ name: 'Ada', score: 1000 })
        .expect(400);
    });

    it('rejects an unknown property rather than silently dropping it', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/probe')
        .send({ name: 'Ada', typo: true })
        .expect(400);

      expect(res.body.details.join(' ')).toContain('typo');
    });

    it('proves decorator metadata survives the SWC transform', async () => {
      // `ValidationPipe` finds the DTO class through `design:paramtypes`. If SWC
      // stopped emitting decorator metadata the pipe would see a plain Object,
      // skip validation entirely, and this invalid body would return 201.
      await request(app.getHttpServer())
        .post('/api/v1/probe')
        .send({})
        .expect(400);
    });
  });

  describe('error contract', () => {
    it('returns the standard envelope for a 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/does-not-exist')
        .expect(404);

      expect(res.body).toMatchObject({
        statusCode: 404,
        error: 'Not Found',
        code: 'NOT_FOUND',
        path: '/api/v1/does-not-exist',
      });
      expect(typeof res.body.message).toBe('string');
      expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    });

    it('uses the same envelope for a validation failure', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/probe')
        .send({})
        .expect(400);

      expect(res.body).toMatchObject({
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'Request validation failed',
        path: '/api/v1/probe',
      });
      expect(Array.isArray(res.body.details)).toBe(true);
    });

    it('sanitises an unexpected error into a generic 500', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/probe/boom')
        .expect(500);

      expect(res.body).toMatchObject({
        statusCode: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      });
    });

    it('never leaks database or filesystem detail to the client', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/probe/boom')
        .expect(500);

      const body = JSON.stringify(res.body);
      expect(body).not.toContain('SQLITE_ERROR');
      expect(body).not.toContain('/home/ada');
      expect(body).not.toContain('stack');
    });

    it('responds rather than hanging when a non-Error value is thrown', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/probe/thrown-string')
        .expect(500);

      expect(res.body.message).toBe('Internal server error');
    });
  });

  describe('CORS', () => {
    it.each([
      'http://localhost:4200',
      'tauri://localhost',
      'http://tauri.localhost',
    ])('allows the desktop origin %s', async (origin) => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('Origin', origin)
        .expect(200);

      expect(res.headers['access-control-allow-origin']).toBe(origin);
    });

    it('does not send a permissive header to an untrusted origin', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('Origin', 'https://example.com')
        .expect(200);

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('never enables credentials', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('Origin', 'http://localhost:4200')
        .expect(200);

      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it.each(['PATCH', 'DELETE'])(
      'answers a %s preflight for an allowed origin',
      async (method) => {
        const res = await request(app.getHttpServer())
          .options('/api/v1/probe')
          .set('Origin', 'http://localhost:4200')
          .set('Access-Control-Request-Method', method)
          .set('Access-Control-Request-Headers', 'content-type');

        expect(res.status).toBeLessThan(300);
        expect(res.headers['access-control-allow-origin']).toBe(
          'http://localhost:4200',
        );
        expect(res.headers['access-control-allow-methods']).toContain(method);
      },
    );
  });

  describe('OpenAPI', () => {
    it('serves a valid document with the expected metadata', async () => {
      const res = await request(app.getHttpServer())
        .get(`/${OPENAPI_JSON_PATH}`)
        .expect(200);

      expect(res.body.openapi).toMatch(/^3\./);
      expect(res.body.info.title).toBe('Glassbeetle API');
      expect(res.body.info.version).toBe('1');
    });

    it('declares a tag for every resource area', async () => {
      const res = await request(app.getHttpServer())
        .get(`/${OPENAPI_JSON_PATH}`)
        .expect(200);

      const tags = res.body.tags.map((tag: { name: string }) => tag.name);
      expect(tags).toEqual(
        expect.arrayContaining([
          'health',
          'agents',
          'memory',
          'teams',
          'chats',
          'providers',
          'models',
          'system-prompts',
          'projects',
          'artifacts',
          'analytics',
          'application',
        ]),
      );
    });

    it('includes the known routes, so the wiring cannot silently break', async () => {
      const res = await request(app.getHttpServer())
        .get(`/${OPENAPI_JSON_PATH}`)
        .expect(200);

      expect(Object.keys(res.body.paths)).toContain('/api/v1/health');
    });
  });
});
