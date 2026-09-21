import { isAbsolute } from 'node:path';
import { registerAs } from '@nestjs/config';
import {
  resolveDefaultDataDir,
  resolveDefaultDatabasePath,
} from './data-dir.js';

/**
 * Configuration namespace key.
 */
export const APP_CONFIG_NAMESPACE = 'app';

/**
 * Run mode of the application.
 */
export type NodeEnv = 'development' | 'production' | 'test';

/**
 * Fully resolved application configuration.
 *
 * Every field is non-optional: defaults are applied and validation has run by
 * the time this object exists, so consumers never deal with `string | undefined`.
 */
export interface AppConfig {
  /** Run mode. */
  readonly nodeEnv: NodeEnv;
  /** TCP port the HTTP server listens on. */
  readonly port: number;
  /** Root directory for the database, uploaded files, artifacts and backups. */
  readonly dataDir: string;
  /** Absolute path of the SQLite database file. */
  readonly databasePath: string;
  /** Origins permitted to make cross-origin requests to the API. */
  readonly corsOrigins: readonly string[];
}

/**
 * Default port, matching what the Angular dev server and the Tauri shell expect.
 */
export const DEFAULT_PORT = 3000;

/**
 * Origins the desktop application legitimately reaches the API from.
 *
 * The frontend presents a different origin depending on how it runs: the
 * Angular dev server, the macOS/Linux Tauri webview, and the Windows Tauri
 * webview. Anything outside this list is a third-party page and must not
 * receive a permissive CORS header.
 */
export const DEFAULT_CORS_ORIGINS: readonly string[] = [
  'http://localhost:4200',
  'tauri://localhost',
  'http://tauri.localhost',
];

/**
 * Builds the resolved configuration from the validated environment.
 *
 * `dataDir` drives `databasePath`, so setting only `GLASSBEETLE_DATA_DIR` moves
 * the whole installation while `GLASSBEETLE_DATABASE_PATH` can still override
 * the database independently.
 */
export default registerAs(APP_CONFIG_NAMESPACE, (): AppConfig => {
  const env = process.env;

  const dataDir = env.GLASSBEETLE_DATA_DIR?.trim()
    ? env.GLASSBEETLE_DATA_DIR.trim()
    : resolveDefaultDataDir();

  const databasePath = env.GLASSBEETLE_DATABASE_PATH?.trim()
    ? env.GLASSBEETLE_DATABASE_PATH.trim()
    : resolveDefaultDatabasePath(dataDir);

  return {
    nodeEnv: (env.NODE_ENV as NodeEnv | undefined) ?? 'development',
    port: env.PORT ? Number(env.PORT) : DEFAULT_PORT,
    dataDir,
    databasePath,
    corsOrigins: parseCorsOrigins(env.GLASSBEETLE_CORS_ORIGINS),
  };
});

/**
 * Parses the comma-separated CORS origin allowlist.
 *
 * An unset value keeps the built-in defaults. An explicitly empty value means
 * "allow nothing", which is a legitimate lockdown rather than a reason to fall
 * back to the defaults.
 */
export function parseCorsOrigins(raw: string | undefined): readonly string[] {
  if (raw === undefined) {
    return DEFAULT_CORS_ORIGINS;
  }

  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Asserts that a configured path is absolute.
 *
 * A relative data directory would resolve against the process working
 * directory, which differs between `npm run dev:api`, a packaged Tauri build
 * and a test run — silently scattering user data across three locations.
 */
export function assertAbsolutePath(label: string, value: string): void {
  if (!isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path, received "${value}"`);
  }
}
