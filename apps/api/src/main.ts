import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import {
  configureApp,
  DEFAULT_API_VERSION,
  GLOBAL_PREFIX,
  registerNotFoundFallback,
} from './bootstrap.js';
import { AppConfigService } from './config/app-config.service.js';
import { OPENAPI_UI_PATH, setupOpenApi } from './openapi/openapi.js';

/**
 * Interface the HTTP server binds to.
 *
 * Loopback only. Glassbeetle is a single-user desktop application and its API
 * has no authentication, so it must not be reachable from other machines on the
 * network. Node's default of `0.0.0.0` would expose it to the whole LAN.
 */
const BIND_ADDRESS = '127.0.0.1';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  configureApp(app);
  setupOpenApi(app);

  // Routes are registered during init; the not-found fallback must come after
  // them or it would shadow every route it is meant to fall back from.
  await app.init();
  registerNotFoundFallback(app);

  const config = app.get(AppConfigService);

  app.enableShutdownHooks();
  await app.listen(config.port, BIND_ADDRESS);

  const logger = new Logger('Bootstrap');
  const baseUrl = `http://${BIND_ADDRESS}:${config.port}/${GLOBAL_PREFIX}`;
  logger.log(`API listening on ${baseUrl}/v${DEFAULT_API_VERSION}`);
  logger.log(
    `API documentation on http://${BIND_ADDRESS}:${config.port}/${OPENAPI_UI_PATH}`,
  );
  logger.log(`Data directory: ${config.dataDir}`);
}

await bootstrap();
