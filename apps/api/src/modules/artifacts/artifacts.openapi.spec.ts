import { Test, TestingModule } from '@nestjs/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../../bootstrap.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { buildOpenApiDocument } from '../../openapi/openapi.js';
import { ArtifactsController } from './artifacts.controller.js';
import { ArtifactsService } from './artifacts.service.js';

describe('Artifacts OpenAPI specification', () => {
  let doc: any;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ArtifactsController],
      providers: [
        {
          provide: ArtifactsService,
          useValue: {},
        },
        {
          provide: AppConfigService,
          useValue: { corsOrigin: '*' },
        },
      ],
    }).compile();

    const app = module.createNestApplication();
    configureApp(app);
    await app.init();
    doc = buildOpenApiDocument(app);
    await app.close();
  });

  it('declares the artifacts tag and documents all paths', () => {
    expect(doc.paths['/api/v1/artifacts']).toBeDefined();
    expect(doc.paths['/api/v1/artifacts/{artifactId}']).toBeDefined();
    expect(doc.paths['/api/v1/artifacts/{artifactId}/content']).toBeDefined();
    expect(doc.paths['/api/v1/artifacts/{artifactId}/versions']).toBeDefined();
    expect(
      doc.paths['/api/v1/artifacts/{artifactId}/versions/{version}'],
    ).toBeDefined();
    expect(
      doc.paths['/api/v1/artifacts/{artifactId}/versions/{version}/content'],
    ).toBeDefined();
    expect(
      doc.paths['/api/v1/artifacts/{artifactId}/versions/{version}/restore'],
    ).toBeDefined();
  });

  describe('PUT /api/v1/artifacts/{artifactId}/content', () => {
    it('documents multipart upload for file content', () => {
      const op = doc.paths['/api/v1/artifacts/{artifactId}/content'].put;
      expect(op.summary).toBe('Upload artifact file content');
      expect(op.tags).toContain('artifacts');
      expect(op.requestBody.content['multipart/form-data']).toBeDefined();
      expect(op.responses['200']).toBeDefined();
      expect(op.responses['400']).toBeDefined();
      expect(op.responses['404']).toBeDefined();
    });
  });

  describe('GET /api/v1/artifacts/{artifactId}/versions', () => {
    it('documents listing historical versions with pagination', () => {
      const op = doc.paths['/api/v1/artifacts/{artifactId}/versions'].get;
      expect(op.summary).toBe('List artifact versions');
      expect(op.tags).toContain('artifacts');
      expect(op.responses['200']).toBeDefined();
      expect(op.responses['200'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/PaginatedArtifactVersionsResponseDto',
      );
    });
  });

  describe('GET /api/v1/artifacts/{artifactId}/versions/{version}', () => {
    it('documents retrieving a single historical version', () => {
      const op =
        doc.paths['/api/v1/artifacts/{artifactId}/versions/{version}'].get;
      expect(op.summary).toBe('Retrieve artifact version');
      expect(op.responses['200']).toBeDefined();
      expect(op.responses['200'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ArtifactVersionResponseDto',
      );
    });
  });

  describe('POST /api/v1/artifacts/{artifactId}/versions/{version}/restore', () => {
    it('documents restoring a historical version by rolling forward', () => {
      const op =
        doc.paths['/api/v1/artifacts/{artifactId}/versions/{version}/restore']
          .post;
      expect(op.summary).toBe('Restore artifact version');
      expect(op.responses['200']).toBeDefined();
      expect(op.responses['200'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ArtifactResponseDto',
      );
    });
  });
});
