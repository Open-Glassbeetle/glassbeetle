import { Test, type TestingModule } from '@nestjs/testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../../bootstrap.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { buildOpenApiDocument } from '../../openapi/openapi.js';
import { TeamMembersController } from './team-members/team-members.controller.js';
import { TeamMembersService } from './team-members/team-members.service.js';
import { TeamsController } from './teams.controller.js';
import { TeamsService } from './teams.service.js';

const TEAMS = '/api/v1/teams';
const TEAM = '/api/v1/teams/{teamId}';
const MEMBERS = '/api/v1/teams/{teamId}/members';
const MEMBER = '/api/v1/teams/{teamId}/members/{agentId}';
const ORDER = '/api/v1/teams/{teamId}/members/order';

const ERROR_REF = '#/components/schemas/ApiErrorResponseDto';

describe('Teams OpenAPI specification', () => {
  let doc: any;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TeamsController, TeamMembersController],
      providers: [
        { provide: TeamsService, useValue: {} },
        { provide: TeamMembersService, useValue: {} },
        { provide: AppConfigService, useValue: { corsOrigin: '*' } },
      ],
    }).compile();

    const app = module.createNestApplication();
    configureApp(app);
    await app.init();
    doc = buildOpenApiDocument(app);
    await app.close();
  });

  const op = (path: string, method: string) => doc.paths[path][method];
  const statuses = (path: string, method: string) =>
    Object.keys(op(path, method).responses).sort();
  const jsonRef = (response: any) =>
    response.content['application/json'].schema.$ref;
  const queryNames = (path: string, method: string) =>
    (op(path, method).parameters ?? [])
      .filter((parameter: any) => parameter.in === 'query')
      .map((parameter: any) => parameter.name)
      .sort();
  const pathNames = (path: string, method: string) =>
    (op(path, method).parameters ?? [])
      .filter((parameter: any) => parameter.in === 'path')
      .map((parameter: any) => parameter.name)
      .sort();

  it('declares the teams tag', () => {
    expect(doc.tags.map((tag: any) => tag.name)).toContain('teams');
  });

  it('documents exactly the routes both controllers serve', () => {
    const routes = Object.entries(doc.paths)
      .filter(([path]) => path.startsWith(TEAMS))
      .flatMap(([path, item]: [string, any]) =>
        Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`),
      )
      .sort();

    expect(routes).toEqual(
      [
        `GET ${TEAMS}`,
        `POST ${TEAMS}`,
        `GET ${TEAM}`,
        `PATCH ${TEAM}`,
        `DELETE ${TEAM}`,
        `GET ${MEMBERS}`,
        `POST ${MEMBERS}`,
        `PUT ${ORDER}`,
        `GET ${MEMBER}`,
        `PATCH ${MEMBER}`,
        `DELETE ${MEMBER}`,
      ].sort(),
    );
  });

  it('tags every operation as teams, nested roster routes included', () => {
    for (const item of Object.entries(doc.paths)
      .filter(([path]) => path.startsWith(TEAMS))
      .map(([, value]) => value as any)) {
      for (const operation of Object.values(item) as any[]) {
        expect(operation.tags).toEqual(['teams']);
      }
    }
  });

  describe('teams', () => {
    it('GET /teams documents the page, the query parameters and a 400', () => {
      expect(statuses(TEAMS, 'get')).toEqual(['200', '400']);
      expect(jsonRef(op(TEAMS, 'get').responses['200'])).toBe(
        '#/components/schemas/PaginatedTeamsResponseDto',
      );
      expect(jsonRef(op(TEAMS, 'get').responses['400'])).toBe(ERROR_REF);
      expect(queryNames(TEAMS, 'get')).toEqual(
        ['limit', 'name', 'offset', 'order', 'search', 'sort'].sort(),
      );

      const order = op(TEAMS, 'get').parameters.find(
        (parameter: any) => parameter.name === 'order',
      );
      expect(order.schema.enum).toEqual(['asc', 'desc']);
    });

    it('GET /teams/:teamId documents the team and a 404', () => {
      expect(pathNames(TEAM, 'get')).toEqual(['teamId']);
      expect(statuses(TEAM, 'get')).toEqual(['200', '404']);
      expect(jsonRef(op(TEAM, 'get').responses['200'])).toBe(
        '#/components/schemas/TeamResponseDto',
      );
      expect(jsonRef(op(TEAM, 'get').responses['404'])).toBe(ERROR_REF);
    });

    it('POST /teams documents the payload, a 201 with Location and a 400', () => {
      const create = op(TEAMS, 'post');

      expect(create.requestBody.content['application/json'].schema.$ref).toBe(
        '#/components/schemas/CreateTeamDto',
      );
      expect(statuses(TEAMS, 'post')).toEqual(['201', '400']);
      expect(jsonRef(create.responses['201'])).toBe(
        '#/components/schemas/TeamResponseDto',
      );
      expect(create.responses['201'].headers.Location).toBeDefined();
      expect(jsonRef(create.responses['400'])).toBe(ERROR_REF);
    });

    it('PATCH /teams/:teamId documents the payload, a 400 and a 404', () => {
      const update = op(TEAM, 'patch');

      expect(update.requestBody.content['application/json'].schema.$ref).toBe(
        '#/components/schemas/UpdateTeamDto',
      );
      expect(statuses(TEAM, 'patch')).toEqual(['200', '400', '404']);
      expect(jsonRef(update.responses['200'])).toBe(
        '#/components/schemas/TeamResponseDto',
      );
    });

    it('DELETE /teams/:teamId documents a 204 with no body and a 404', () => {
      expect(statuses(TEAM, 'delete')).toEqual(['204', '404']);
      expect(op(TEAM, 'delete').responses['204'].content).toBeUndefined();
    });
  });

  describe('team members', () => {
    it('GET /members documents the roster page, its query parameters, a 400 and a 404', () => {
      expect(pathNames(MEMBERS, 'get')).toEqual(['teamId']);
      expect(statuses(MEMBERS, 'get')).toEqual(['200', '400', '404']);
      expect(jsonRef(op(MEMBERS, 'get').responses['200'])).toBe(
        '#/components/schemas/PaginatedTeamMembersResponseDto',
      );
      // No name filter on a roster: it is paginated and ordered, nothing else.
      expect(queryNames(MEMBERS, 'get')).toEqual(
        ['limit', 'offset', 'order', 'sort'].sort(),
      );
    });

    it('GET /members/:agentId documents the membership and a 404', () => {
      expect(pathNames(MEMBER, 'get')).toEqual(['agentId', 'teamId']);
      expect(statuses(MEMBER, 'get')).toEqual(['200', '404']);
      expect(jsonRef(op(MEMBER, 'get').responses['200'])).toBe(
        '#/components/schemas/TeamMemberResponseDto',
      );
    });

    it('POST /members documents 201 with Location, 400, 404, 409 and 422', () => {
      const add = op(MEMBERS, 'post');

      expect(add.requestBody.content['application/json'].schema.$ref).toBe(
        '#/components/schemas/AddTeamMemberDto',
      );
      expect(statuses(MEMBERS, 'post')).toEqual([
        '201',
        '400',
        '404',
        '409',
        '422',
      ]);
      expect(jsonRef(add.responses['201'])).toBe(
        '#/components/schemas/TeamMemberResponseDto',
      );
      expect(add.responses['201'].headers.Location).toBeDefined();
      for (const status of ['400', '404', '409', '422']) {
        expect(jsonRef(add.responses[status])).toBe(ERROR_REF);
      }
    });

    it('PUT /members/order documents the reordered roster, 400, 404 and 409', () => {
      const reorder = op(ORDER, 'put');

      expect(pathNames(ORDER, 'put')).toEqual(['teamId']);
      expect(reorder.requestBody.content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ReorderTeamMembersDto',
      );
      expect(statuses(ORDER, 'put')).toEqual(['200', '400', '404', '409']);
      expect(jsonRef(reorder.responses['200'])).toBe(
        '#/components/schemas/PaginatedTeamMembersResponseDto',
      );
    });

    it('PATCH /members/:agentId documents the payload, 400 and 404', () => {
      const update = op(MEMBER, 'patch');

      expect(update.requestBody.content['application/json'].schema.$ref).toBe(
        '#/components/schemas/UpdateTeamMemberDto',
      );
      expect(statuses(MEMBER, 'patch')).toEqual(['200', '400', '404']);
      expect(jsonRef(update.responses['200'])).toBe(
        '#/components/schemas/TeamMemberResponseDto',
      );
    });

    it('DELETE /members/:agentId documents a 204 with no body and a 404', () => {
      expect(statuses(MEMBER, 'delete')).toEqual(['204', '404']);
      expect(op(MEMBER, 'delete').responses['204'].content).toBeUndefined();
    });
  });

  describe('schemas', () => {
    const fields = (name: string) =>
      Object.keys(doc.components.schemas[name].properties).sort();

    it('TeamResponseDto names every field a team is returned with', () => {
      expect(fields('TeamResponseDto')).toEqual(
        [
          'id',
          'name',
          'description',
          'memberCount',
          'createdAt',
          'updatedAt',
        ].sort(),
      );
      expect(
        doc.components.schemas.TeamResponseDto.properties.description.nullable,
      ).toBe(true);
    });

    it('CreateTeamDto and UpdateTeamDto accept only name and description', () => {
      expect(fields('CreateTeamDto')).toEqual(['description', 'name']);
      expect(fields('UpdateTeamDto')).toEqual(['description', 'name']);
      expect(doc.components.schemas.CreateTeamDto.required).toEqual(['name']);
      expect(doc.components.schemas.UpdateTeamDto.required).toBeUndefined();
    });

    it('TeamMemberResponseDto names every field a membership is returned with', () => {
      expect(fields('TeamMemberResponseDto')).toEqual(
        ['teamId', 'agentId', 'role', 'position', 'createdAt'].sort(),
      );
    });

    it('membership payloads match their DTOs, and PATCH takes no position', () => {
      expect(fields('AddTeamMemberDto')).toEqual(['agentId', 'role']);
      expect(doc.components.schemas.AddTeamMemberDto.required).toEqual([
        'agentId',
      ]);
      expect(fields('ReorderTeamMembersDto')).toEqual(['agentIds']);
      expect(fields('UpdateTeamMemberDto')).toEqual(['role']);
    });

    it('both page schemas carry items, total, limit and offset', () => {
      for (const name of [
        'PaginatedTeamsResponseDto',
        'PaginatedTeamMembersResponseDto',
      ]) {
        expect(fields(name)).toEqual(['items', 'limit', 'offset', 'total']);
      }
      expect(
        doc.components.schemas.PaginatedTeamsResponseDto.properties.items.items
          .$ref,
      ).toBe('#/components/schemas/TeamResponseDto');
      expect(
        doc.components.schemas.PaginatedTeamMembersResponseDto.properties.items
          .items.$ref,
      ).toBe('#/components/schemas/TeamMemberResponseDto');
    });
  });
});
