import { DEFAULT_CORS_ORIGINS, parseCorsOrigins } from './app.config.js';
import { validateEnv } from './env.validation.js';

describe('validateEnv', () => {
  it('accepts an entirely empty environment', () => {
    // Glassbeetle is an installed desktop application: it must start with
    // sensible defaults rather than demanding a configuration file.
    expect(() => validateEnv({})).not.toThrow();
  });

  it('accepts a fully specified environment', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        PORT: '3000',
        GLASSBEETLE_DATA_DIR: '/var/lib/glassbeetle',
        GLASSBEETLE_DATABASE_PATH: '/var/lib/glassbeetle/glassbeetle.db',
        GLASSBEETLE_CORS_ORIGINS: 'http://localhost:4200',
      }),
    ).not.toThrow();
  });

  it('names the offending setting when NODE_ENV is invalid', () => {
    expect(() => validateEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it.each(['not-a-number', '0', '70000', '-1'])('rejects PORT=%s', (port) => {
    expect(() => validateEnv({ PORT: port })).toThrow(/PORT/);
  });

  it('rejects a relative data directory', () => {
    // A relative path resolves against the process working directory, which
    // differs between `npm run dev:api`, a packaged build and a test run.
    expect(() => validateEnv({ GLASSBEETLE_DATA_DIR: './data' })).toThrow(
      /GLASSBEETLE_DATA_DIR must be an absolute path/,
    );
  });

  it('rejects a relative database path', () => {
    expect(() =>
      validateEnv({ GLASSBEETLE_DATABASE_PATH: 'glassbeetle.db' }),
    ).toThrow(/GLASSBEETLE_DATABASE_PATH must be an absolute path/);
  });
});

describe('parseCorsOrigins', () => {
  it('keeps the built-in desktop origins when unset', () => {
    expect(parseCorsOrigins(undefined)).toEqual(DEFAULT_CORS_ORIGINS);
  });

  it('splits and trims a comma-separated list', () => {
    expect(
      parseCorsOrigins('http://localhost:4200, tauri://localhost'),
    ).toEqual(['http://localhost:4200', 'tauri://localhost']);
  });

  it('treats an explicitly empty value as "allow nothing"', () => {
    // An explicit lockdown must not silently fall back to the defaults.
    expect(parseCorsOrigins('')).toEqual([]);
  });
});
