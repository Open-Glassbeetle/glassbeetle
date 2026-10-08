import { Test, type TestingModule } from '@nestjs/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../../bootstrap.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { buildOpenApiDocument } from '../../openapi/openapi.js';
import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';

describe('User OpenAPI specification', () => {
  let doc: any;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: {} },
        { provide: AppConfigService, useValue: { corsOrigin: '*' } },
      ],
    }).compile();

    const app = module.createNestApplication();
    configureApp(app);
    await app.init();
    doc = buildOpenApiDocument(app);
    await app.close();
  });

  it('declares the user tag', () => {
    expect(doc.tags.map((tag: any) => tag.name)).toContain('user');
  });

  it('documents both paths and nothing with an id segment', () => {
    expect(doc.paths['/api/v1/user']).toBeDefined();
    expect(doc.paths['/api/v1/user/picture']).toBeDefined();

    // The singleton is the whole point: no path may name a second person.
    const userPaths = Object.keys(doc.paths).filter((path: string) =>
      path.startsWith('/api/v1/user'),
    );
    expect(userPaths).toHaveLength(2);
    expect(userPaths.join(' ')).not.toContain('{');
  });

  it('offers no way to create or delete the profile itself', () => {
    expect(doc.paths['/api/v1/user'].post).toBeUndefined();
    expect(doc.paths['/api/v1/user'].delete).toBeUndefined();
    expect(doc.paths['/api/v1/user'].put).toBeUndefined();
  });

  describe('GET /api/v1/user', () => {
    it('documents a summary, the tag and the success response', () => {
      const op = doc.paths['/api/v1/user'].get;

      expect(op.summary).toBe('Retrieve the user profile');
      expect(op.tags).toContain('user');
      expect(op.responses['200'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/UserProfileResponseDto',
      );
    });

    it('documents no failure response, because it has none', () => {
      expect(Object.keys(doc.paths['/api/v1/user'].get.responses)).toEqual([
        '200',
      ]);
    });
  });

  describe('PATCH /api/v1/user', () => {
    it('documents the payload and the validation failure', () => {
      const op = doc.paths['/api/v1/user'].patch;

      expect(op.summary).toBe('Update the user profile');
      expect(op.requestBody.content['application/json'].schema.$ref).toBe(
        '#/components/schemas/UpdateUserProfileDto',
      );
      expect(op.responses['400']).toBeDefined();
    });
  });

  describe('GET /api/v1/user/picture', () => {
    it('documents a binary response rather than JSON', () => {
      const op = doc.paths['/api/v1/user/picture'].get;

      expect(Object.keys(op.responses['200'].content)).toEqual(
        expect.arrayContaining([
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/gif',
        ]),
      );
      expect(op.responses['200'].content['image/png'].schema).toMatchObject({
        type: 'string',
        format: 'binary',
      });
    });

    it('documents revalidation and the missing-picture case', () => {
      const op = doc.paths['/api/v1/user/picture'].get;

      expect(op.responses['304']).toBeDefined();
      expect(op.responses['404']).toBeDefined();
    });
  });

  describe('PUT /api/v1/user/picture', () => {
    it('documents the multipart upload and its failures', () => {
      const op = doc.paths['/api/v1/user/picture'].put;

      expect(op.requestBody.content['multipart/form-data']).toBeDefined();
      expect(op.responses['200'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/UserProfileResponseDto',
      );
      expect(op.responses['400']).toBeDefined();
      expect(op.responses['413']).toBeDefined();
    });
  });

  describe('DELETE /api/v1/user/picture', () => {
    it('documents the idempotent removal', () => {
      const op = doc.paths['/api/v1/user/picture'].delete;

      expect(op.responses['204']).toBeDefined();
    });
  });

  describe('UserProfileResponseDto schema', () => {
    it('describes every field the API returns', () => {
      const schema = doc.components.schemas.UserProfileResponseDto;

      expect(Object.keys(schema.properties)).toEqual([
        'id',
        'displayName',
        'pronouns',
        'about',
        'locale',
        'timezone',
        'includeInPrompts',
        'hasPicture',
        'pictureUpdatedAt',
        'createdAt',
        'updatedAt',
      ]);
    });

    it('never mentions the stored picture path or the singleton column', () => {
      const schema = doc.components.schemas.UserProfileResponseDto;

      expect(schema.properties.picturePath).toBeUndefined();
      expect(schema.properties.singleton).toBeUndefined();
    });

    it('marks the always-present-but-nullable fields as nullable, not optional', () => {
      const schema = doc.components.schemas.UserProfileResponseDto;

      expect(schema.properties.displayName.nullable).toBe(true);
      expect(schema.required).toEqual(
        expect.arrayContaining(['displayName', 'pronouns', 'about']),
      );
    });
  });
});
