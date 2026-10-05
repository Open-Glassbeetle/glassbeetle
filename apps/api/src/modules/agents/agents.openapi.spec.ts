import { Test, TestingModule } from '@nestjs/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../../bootstrap.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { buildOpenApiDocument } from '../../openapi/openapi.js';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';

describe('Agents OpenAPI specification', () => {
  let doc: any;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [
        {
          provide: AgentsService,
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

  it('declares the agents tag and has documented paths', () => {
    expect(doc.paths['/api/v1/agents']).toBeDefined();
    expect(doc.paths['/api/v1/agents/{agentId}']).toBeDefined();
    expect(doc.paths['/api/v1/agents/{agentId}/picture']).toBeDefined();
  });

  describe('GET /api/v1/agents', () => {
    it('documents summary, tags, query parameters and responses', () => {
      const op = doc.paths['/api/v1/agents'].get;
      expect(op.summary).toBe('List agents');
      expect(op.tags).toContain('agents');

      const paramNames = op.parameters.map((p: any) => p.name);
      expect(paramNames).toEqual(
        expect.arrayContaining([
          'limit',
          'offset',
          'sort',
          'order',
          'modelId',
          'systemPromptId',
          'name',
          'search',
        ]),
      );

      expect(op.responses['200']).toBeDefined();
      expect(op.responses['200'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/PaginatedAgentsResponseDto',
      );

      expect(op.responses['400']).toBeDefined();
      expect(op.responses['400'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ApiErrorResponseDto',
      );
    });
  });

  describe('POST /api/v1/agents', () => {
    it('documents summary, requestBody, Location header, and response codes (201, 400, 422)', () => {
      const op = doc.paths['/api/v1/agents'].post;
      expect(op.summary).toBe('Create an agent');
      expect(op.tags).toContain('agents');

      expect(op.requestBody.content['application/json'].schema.$ref).toBe(
        '#/components/schemas/CreateAgentDto',
      );

      expect(op.responses['201']).toBeDefined();
      expect(op.responses['201'].headers.Location).toBeDefined();
      expect(op.responses['201'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/AgentResponseDto',
      );

      expect(op.responses['400']).toBeDefined();
      expect(op.responses['400'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ApiErrorResponseDto',
      );

      expect(op.responses['422']).toBeDefined();
      expect(op.responses['422'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ApiErrorResponseDto',
      );
    });
  });

  describe('GET /api/v1/agents/{agentId}', () => {
    it('documents agentId parameter and responses (200, 404)', () => {
      const op = doc.paths['/api/v1/agents/{agentId}'].get;
      expect(op.summary).toBe('Retrieve an agent');
      expect(op.tags).toContain('agents');

      const agentIdParam = op.parameters.find(
        (p: any) => p.name === 'agentId' && p.in === 'path',
      );
      expect(agentIdParam).toBeDefined();
      expect(agentIdParam.required).toBe(true);

      expect(op.responses['200']).toBeDefined();
      expect(op.responses['200'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/AgentResponseDto',
      );

      expect(op.responses['404']).toBeDefined();
      expect(op.responses['404'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ApiErrorResponseDto',
      );
    });
  });

  describe('PATCH /api/v1/agents/{agentId}', () => {
    it('documents requestBody and responses (200, 400, 404, 422)', () => {
      const op = doc.paths['/api/v1/agents/{agentId}'].patch;
      expect(op.summary).toBe('Update an agent');
      expect(op.tags).toContain('agents');

      expect(op.requestBody.content['application/json'].schema.$ref).toBe(
        '#/components/schemas/UpdateAgentDto',
      );

      expect(op.responses['200']).toBeDefined();
      expect(op.responses['200'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/AgentResponseDto',
      );

      expect(op.responses['400']).toBeDefined();
      expect(op.responses['400'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ApiErrorResponseDto',
      );

      expect(op.responses['404']).toBeDefined();
      expect(op.responses['404'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ApiErrorResponseDto',
      );

      expect(op.responses['422']).toBeDefined();
      expect(op.responses['422'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ApiErrorResponseDto',
      );
    });
  });

  describe('DELETE /api/v1/agents/{agentId}', () => {
    it('documents agentId parameter and responses (204, 404)', () => {
      const op = doc.paths['/api/v1/agents/{agentId}'].delete;
      expect(op.summary).toBe('Delete an agent');
      expect(op.tags).toContain('agents');

      expect(op.responses['204']).toBeDefined();
      expect(op.responses['404']).toBeDefined();
      expect(op.responses['404'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ApiErrorResponseDto',
      );
    });
  });

  describe('PUT /api/v1/agents/{agentId}/picture', () => {
    it('documents multipart/form-data upload and responses (200, 400, 404, 413)', () => {
      const op = doc.paths['/api/v1/agents/{agentId}/picture'].put;
      expect(op.summary).toBe('Upload an agent profile picture');
      expect(op.tags).toContain('agents');

      expect(op.requestBody.content['multipart/form-data']).toBeDefined();
      expect(op.requestBody.content['multipart/form-data'].schema.$ref).toBe(
        '#/components/schemas/UploadAgentPictureDto',
      );

      expect(op.responses['200']).toBeDefined();
      expect(op.responses['200'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/AgentResponseDto',
      );

      expect(op.responses['400']).toBeDefined();
      expect(op.responses['400'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ApiErrorResponseDto',
      );

      expect(op.responses['404']).toBeDefined();
      expect(op.responses['404'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ApiErrorResponseDto',
      );

      expect(op.responses['413']).toBeDefined();
      expect(op.responses['413'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ApiErrorResponseDto',
      );
    });
  });

  describe('DELETE /api/v1/agents/{agentId}/picture', () => {
    it('documents responses (204, 404)', () => {
      const op = doc.paths['/api/v1/agents/{agentId}/picture'].delete;
      expect(op.summary).toBe('Remove an agent profile picture');
      expect(op.tags).toContain('agents');

      expect(op.responses['204']).toBeDefined();
      expect(op.responses['404']).toBeDefined();
      expect(op.responses['404'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ApiErrorResponseDto',
      );
    });
  });

  describe('Reusable component schemas', () => {
    it('defines AgentResponseDto with correct types and nullable attributes, without leaking picture_path', () => {
      const schema = doc.components.schemas.AgentResponseDto;
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');

      // picture_path must NOT be present
      expect(schema.properties.picture_path).toBeUndefined();
      expect(schema.properties.picturePath).toBeUndefined();

      // hasPicture is boolean
      expect(schema.properties.hasPicture.type).toBe('boolean');

      // string fields
      expect(schema.properties.id.type).toBe('string');
      expect(schema.properties.name.type).toBe('string');
      expect(schema.properties.personality.type).toBe('string');
      expect(schema.properties.personality.nullable).toBe(true);
      expect(schema.properties.instructions.type).toBe('string');
      expect(schema.properties.instructions.nullable).toBe(true);
      expect(schema.properties.systemPromptId.type).toBe('string');
      expect(schema.properties.systemPromptId.nullable).toBe(true);
      expect(schema.properties.modelId.type).toBe('string');
      expect(schema.properties.modelId.nullable).toBe(true);

      // numeric fields
      expect(schema.properties.temperature.type).toBe('number');
      expect(schema.properties.temperature.nullable).toBe(true);
      expect(schema.properties.temperature.example).toBe(0.7);

      expect(schema.properties.maxTokens.type).toBe('integer');
      expect(schema.properties.maxTokens.nullable).toBe(true);
      expect(schema.properties.maxTokens.example).toBe(4096);

      // modelParams arbitrary object
      expect(schema.properties.modelParams.type).toBe('object');
      expect(schema.properties.modelParams.nullable).toBe(true);
      expect(schema.properties.modelParams.additionalProperties).toBe(true);
    });

    it('defines CreateAgentDto with name required and others optional/nullable', () => {
      const schema = doc.components.schemas.CreateAgentDto;
      expect(schema).toBeDefined();
      expect(schema.required).toEqual(['name']);
      expect(schema.properties.personality.type).toBe('string');
      expect(schema.properties.personality.nullable).toBe(true);
      expect(schema.properties.temperature.type).toBe('number');
      expect(schema.properties.temperature.nullable).toBe(true);
      expect(schema.properties.maxTokens.type).toBe('integer');
      expect(schema.properties.maxTokens.nullable).toBe(true);
      expect(schema.properties.modelParams.type).toBe('object');
    });

    it('defines UpdateAgentDto with all fields optional and appropriate nullability', () => {
      const schema = doc.components.schemas.UpdateAgentDto;
      expect(schema).toBeDefined();
      expect(schema.required).toBeUndefined();
      expect(schema.properties.personality.type).toBe('string');
      expect(schema.properties.personality.nullable).toBe(true);
      expect(schema.properties.temperature.type).toBe('number');
      expect(schema.properties.temperature.nullable).toBe(true);
    });

    it('defines PaginatedAgentsResponseDto referencing AgentResponseDto', () => {
      const schema = doc.components.schemas.PaginatedAgentsResponseDto;
      expect(schema).toBeDefined();
      expect(schema.properties.items.type).toBe('array');
      expect(schema.properties.items.items.$ref).toBe(
        '#/components/schemas/AgentResponseDto',
      );
      expect(schema.properties.total.type).toBe('number');
      expect(schema.properties.limit.type).toBe('number');
      expect(schema.properties.offset.type).toBe('number');
    });

    it('defines ApiErrorResponseDto with expected fields', () => {
      const schema = doc.components.schemas.ApiErrorResponseDto;
      expect(schema).toBeDefined();
      expect(schema.properties.statusCode.type).toBe('number');
      expect(schema.properties.error.type).toBe('string');
      expect(schema.properties.code.type).toBe('string');
      expect(schema.properties.message.type).toBe('string');
      expect(schema.properties.path.type).toBe('string');
      expect(schema.properties.timestamp.type).toBe('string');
      expect(schema.properties.details.type).toBe('array');
    });
  });
});
