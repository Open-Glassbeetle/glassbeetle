import { Test, type TestingModule } from '@nestjs/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../../bootstrap.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { buildOpenApiDocument } from '../../openapi/openapi.js';
import { BudgetController } from './budget.controller.js';
import { BudgetService } from './budget.service.js';

describe('Budget OpenAPI specification', () => {
  let doc: any;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BudgetController],
      providers: [
        { provide: BudgetService, useValue: {} },
        { provide: AppConfigService, useValue: { corsOrigin: '*' } },
      ],
    }).compile();

    const app = module.createNestApplication();
    configureApp(app);
    await app.init();
    doc = buildOpenApiDocument(app);
    await app.close();
  });

  it('declares the budget tag', () => {
    expect(doc.tags.map((tag: any) => tag.name)).toContain('budget');
  });

  it('documents one path, with no id segment and no way to create or delete', () => {
    const paths = Object.keys(doc.paths).filter((path: string) =>
      path.startsWith('/api/v1/budget'),
    );

    expect(paths).toEqual(['/api/v1/budget']);
    expect(Object.keys(doc.paths['/api/v1/budget']).sort()).toEqual([
      'get',
      'patch',
    ]);
  });

  it('documents the read as always succeeding', () => {
    const op = doc.paths['/api/v1/budget'].get;

    expect(op.tags).toContain('budget');
    expect(Object.keys(op.responses)).toEqual(['200']);
    expect(op.responses['200'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/BudgetResponseDto',
    );
  });

  it('documents the update payload and its validation failure', () => {
    const op = doc.paths['/api/v1/budget'].patch;

    expect(op.requestBody.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/UpdateBudgetDto',
    );
    expect(op.responses['400']).toBeDefined();
  });

  it('describes every field the API returns', () => {
    const schema = doc.components.schemas.BudgetResponseDto;

    expect(Object.keys(schema.properties)).toEqual([
      'id',
      'limitUsd',
      'period',
      'periodStart',
      'periodEnd',
      'spentUsd',
      'remainingUsd',
      'usedFraction',
      'callCount',
      'createdAt',
      'updatedAt',
    ]);
    expect(schema.properties.singleton).toBeUndefined();
  });

  it('marks the amounts that are absent without a limit as nullable, not optional', () => {
    const schema = doc.components.schemas.BudgetResponseDto;

    for (const field of ['limitUsd', 'remainingUsd', 'usedFraction']) {
      expect(schema.properties[field].nullable).toBe(true);
    }
    expect(schema.required).toEqual(
      expect.arrayContaining(['limitUsd', 'remainingUsd', 'usedFraction']),
    );
  });

  it('constrains the period to the three the window calculation supports', () => {
    expect(
      doc.components.schemas.UpdateBudgetDto.properties.period.enum,
    ).toEqual(['daily', 'weekly', 'monthly']);
  });
});
