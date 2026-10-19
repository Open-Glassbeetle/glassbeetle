import { Test, type TestingModule } from '@nestjs/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../../bootstrap.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { buildOpenApiDocument } from '../../openapi/openapi.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

describe('Health OpenAPI specification', () => {
  let doc: any;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthService, useValue: {} },
        { provide: AppConfigService, useValue: { corsOrigin: '*' } },
      ],
    }).compile();

    const app = module.createNestApplication();
    configureApp(app);
    await app.init();
    doc = buildOpenApiDocument(app);
    await app.close();
  });

  it('documents GET /api/v1/health with a 200 and a 503', () => {
    const op = doc.paths['/api/v1/health'].get;

    expect(op.tags).toContain('health');
    expect(Object.keys(op.responses).sort()).toEqual(['200', '503']);
  });

  it('documents both the database and the storage check', () => {
    const checks =
      doc.paths['/api/v1/health'].get.responses['200'].content[
        'application/json'
      ].schema.properties.checks;

    expect(checks.required).toEqual(['database', 'storage']);
    expect(Object.keys(checks.properties)).toEqual(['database', 'storage']);
  });

  it('describes the storage check like the database check', () => {
    const { database, storage } =
      doc.paths['/api/v1/health'].get.responses['200'].content[
        'application/json'
      ].schema.properties.checks.properties;

    expect(storage.required).toEqual(['status']);
    expect(storage.properties.status.enum).toEqual(
      database.properties.status.enum,
    );
    expect(storage.properties.error.type).toBe('string');
  });
});
