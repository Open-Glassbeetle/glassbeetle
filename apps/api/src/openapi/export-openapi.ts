import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { configureApp } from '../bootstrap.js';
import { buildOpenApiDocument } from './openapi.js';

/**
 * Writes the OpenAPI document to a file without starting a server.
 *
 * Useful for diffing the API surface in review and for feeding a client
 * generator. Run it with `npm run openapi:export` in `apps/api`.
 */
async function exportDocument(): Promise<void> {
  const outputPath = resolve(process.argv[2] ?? 'openapi.json');

  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.init();

  try {
    const document = buildOpenApiDocument(app);
    await writeFile(
      outputPath,
      `${JSON.stringify(document, null, 2)}\n`,
      'utf8',
    );
    console.log(`[openapi] wrote ${outputPath}`);
  } finally {
    await app.close();
  }
}

await exportDocument();
