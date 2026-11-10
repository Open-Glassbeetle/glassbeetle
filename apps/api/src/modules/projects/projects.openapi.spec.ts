import { Test, TestingModule } from '@nestjs/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../../bootstrap.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { buildOpenApiDocument } from '../../openapi/openapi.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

describe('Projects image OpenAPI specification', () => {
  let doc: any;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [
        { provide: ProjectsService, useValue: {} },
        { provide: AppConfigService, useValue: { corsOrigin: '*' } },
      ],
    }).compile();
    const app = module.createNestApplication();
    configureApp(app);
    await app.init();
    doc = buildOpenApiDocument(app);
    await app.close();
  });

  it('documents binary download, revalidation and removal', () => {
    const image = doc.paths['/api/v1/projects/{projectId}/image'];
    expect(image.get.responses['200'].content['image/png'].schema).toMatchObject({
      type: 'string',
      format: 'binary',
    });
    expect(image.get.responses['304']).toBeDefined();
    expect(image.get.responses['404']).toBeDefined();
    expect(image.delete.responses['204']).toBeDefined();
    expect(image.delete.responses['404']).toBeDefined();
  });
});
