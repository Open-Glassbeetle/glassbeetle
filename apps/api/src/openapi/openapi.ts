import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import { DEFAULT_API_VERSION, GLOBAL_PREFIX } from '../bootstrap.js';

/**
 * Path the interactive documentation is served from.
 */
export const OPENAPI_UI_PATH = `${GLOBAL_PREFIX}/docs`;

/**
 * Path the raw OpenAPI document is served from.
 *
 * `SwaggerModule` derives this from the UI path by appending `-json`; it is
 * named here so tests and tooling do not have to reproduce that rule.
 */
export const OPENAPI_JSON_PATH = `${OPENAPI_UI_PATH}-json`;

/**
 * Tags, one per resource area of the API.
 *
 * Declared up front so the documentation page is grouped and navigable from the
 * first endpoint onwards, rather than being one flat list that only acquires
 * structure once every controller happens to add its own tag.
 */
const API_TAGS: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'health', description: 'Service health and readiness' },
  { name: 'agents', description: 'Agent configuration and lifecycle' },
  { name: 'memory', description: 'Agent-private and shared memory' },
  { name: 'teams', description: 'Teams and team membership' },
  { name: 'chats', description: 'Chats, messages and completions' },
  { name: 'providers', description: 'AI providers and credentials' },
  { name: 'models', description: 'Models and model discovery' },
  { name: 'system-prompts', description: 'Reusable system prompt templates' },
  { name: 'projects', description: 'Projects' },
  { name: 'artifacts', description: 'Artifacts and their content' },
  { name: 'analytics', description: 'Usage and activity reporting' },
  {
    name: 'application',
    description: 'Backups, restore and application lifecycle',
  },
];

/**
 * Builds the OpenAPI document for a configured application.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('Glassbeetle API')
    .setDescription(
      'Local-first API for orchestrating AI agents, their memory, teams, chats, ' +
        'projects and artifacts across configurable model providers.',
    )
    .setVersion(DEFAULT_API_VERSION)
    .setLicense(
      'See repository',
      'https://github.com/Open-Glassbeetle/glassbeetle',
    )
    .setExternalDoc(
      'Project repository',
      'https://github.com/Open-Glassbeetle/glassbeetle',
    )
    .addServer(`/${GLOBAL_PREFIX}/v${DEFAULT_API_VERSION}`);

  for (const tag of API_TAGS) {
    builder.addTag(tag.name, tag.description);
  }

  return SwaggerModule.createDocument(app, builder.build());
}

/**
 * Serves the interactive documentation and the raw document.
 *
 * Docs are served in every run mode. Glassbeetle is an installed, loopback-only
 * desktop application rather than a public deployment, so a browsable API on
 * the user's own machine is a feature, not an exposure — and there is no
 * unauthenticated internet-facing surface for it to leak.
 */
export function setupOpenApi(app: INestApplication): OpenAPIObject {
  const document = buildOpenApiDocument(app);

  SwaggerModule.setup(OPENAPI_UI_PATH, app, document, {
    jsonDocumentUrl: OPENAPI_JSON_PATH,
  });

  return document;
}
