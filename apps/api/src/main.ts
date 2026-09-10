import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const PORT = Number(process.env.PORT ?? 3000);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  // The frontend reaches the API from three different origins depending on how
  // it is running: the Angular dev server (http://localhost:4200), the packaged
  // Tauri webview on macOS/Linux (tauri://localhost) and on Windows
  // (http://tauri.localhost). Reflecting the request origin covers all of them.
  // This service is only ever bound to localhost for the desktop app.
  app.enableCors({ origin: true, credentials: true });

  await app.listen(PORT);
  console.log(`[api] listening on http://localhost:${PORT}/api`);
}

await bootstrap();
