import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { configureApp, registerNotFoundFallback } from '../../src/bootstrap.js';
import { AppConfigService } from '../../src/config/app-config.service.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { resetDatabase } from './database-reset.js';
import { TestFixtures } from './fixtures.js';

export interface TestAppOptions {
  /**
   * Additional controllers or providers to register in the testing module.
   */
  controllers?: any[];
  providers?: any[];
}

export interface TestApp {
  readonly app: INestApplication;
  readonly db: DatabaseService;
  readonly fixtures: TestFixtures;
  readonly getHttpServer: () => any;
  readonly request: () => request.SuperTest<request.Test>;
  readonly reset: () => void;
  readonly close: () => Promise<void>;
}

/**
 * Boots a NestJS application configured identically to production, but backed
 * by an isolated temporary SQLite database file.
 */
export async function createTestApp(
  options: TestAppOptions = {},
): Promise<TestApp> {
  const tempDbPath = join(tmpdir(), `glassbeetle-test-${randomUUID()}.db`);

  // Safety assertion: test DB path must be in tmpdir and never match a real config
  if (!tempDbPath.includes(tmpdir())) {
    throw new Error(
      `Test database path "${tempDbPath}" is not inside system temp directory.`,
    );
  }

  // Create a mock AppConfigService providing the temporary database path
  const mockConfigService = {
    nodeEnv: 'test',
    isProduction: false,
    port: 0,
    dataDir: tmpdir(),
    databasePath: tempDbPath,
    corsOrigins: ['http://localhost:4200'],
    logLevel: 'error',
    logBody: false,
  };

  const moduleBuilder = Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
    providers: options.providers ?? [],
  })
    .overrideProvider(AppConfigService)
    .useValue(mockConfigService);

  const moduleFixture: TestingModule = await moduleBuilder.compile();

  const app = moduleFixture.createNestApplication();
  configureApp(app);
  await app.init();
  registerNotFoundFallback(app);

  const db = app.get(DatabaseService);
  const fixtures = new TestFixtures(db);

  return {
    app,
    db,
    fixtures,
    getHttpServer: () => app.getHttpServer(),
    request: () => request(app.getHttpServer()),
    reset: () => resetDatabase(db),
    close: async () => {
      await app.close();
      // Clean up the temporary database file and WAL/SHM artifacts if present
      for (const ext of ['', '-wal', '-shm']) {
        try {
          rmSync(`${tempDbPath}${ext}`, { force: true });
        } catch {
          // Ignore removal errors on temp files
        }
      }
    },
  };
}
