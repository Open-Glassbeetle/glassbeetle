import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  validateSync,
} from 'class-validator';
import { assertAbsolutePath } from './app.config.js';

/**
 * Run modes accepted by `NODE_ENV`.
 */
export enum NodeEnvironment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * Accepted values of `GLASSBEETLE_LOG_LEVEL`.
 *
 * Declared as an enum rather than reusing `LogLevelType` because
 * `@IsEnum()` needs a runtime value to validate against.
 */
export enum LogLevel {
  Debug = 'debug',
  Log = 'log',
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
}

/**
 * Shape of the environment variables the API reads.
 *
 * Validation uses `class-validator`, the same library the global request
 * `ValidationPipe` uses, so the project carries one schema library rather than
 * two.
 */
export class EnvironmentVariables {
  /**
   * Run mode. Unset means `development`.
   */
  @IsOptional()
  @IsEnum(NodeEnvironment, {
    message: `NODE_ENV must be one of: ${Object.values(NodeEnvironment).join(', ')}`,
  })
  NODE_ENV?: NodeEnvironment;

  /**
   * Port the HTTP server binds on loopback. 1-65535; defaults to 3000.
   */
  @IsOptional()
  @IsInt({ message: 'PORT must be an integer' })
  @Min(1, { message: 'PORT must be between 1 and 65535' })
  @Max(65535, { message: 'PORT must be between 1 and 65535' })
  PORT?: number;

  /**
   * Root directory for the database and application data.
   *
   * Must be absolute — see {@link validateEnv}. Unset, a per-user application
   * data directory is resolved per platform.
   */
  @IsOptional()
  @IsString()
  GLASSBEETLE_DATA_DIR?: string;

  /**
   * Absolute path of the SQLite database file.
   *
   * Overrides only the database location, so it can be moved — onto a
   * different disk, or to a throwaway file in a test — without relocating
   * uploads, artifacts and backups with it.
   */
  @IsOptional()
  @IsString()
  GLASSBEETLE_DATABASE_PATH?: string;

  /**
   * Absolute path of the file holding the AES master key that encrypts
   * provider credentials at rest. Defaults to `master.key` in the data
   * directory.
   */
  @IsOptional()
  @IsString()
  GLASSBEETLE_MASTER_KEY_FILE?: string;

  /**
   * The master key supplied directly as hex or base64, instead of through a
   * file.
   *
   * Intended for ephemeral test runs and containers that have no durable
   * filesystem. Takes precedence over the key file; see `EncryptionService`.
   */
  @IsOptional()
  @IsString()
  GLASSBEETLE_MASTER_KEY?: string;

  /**
   * Comma-separated origin allowlist. Unset keeps the desktop-app defaults; an
   * explicitly empty value allows no cross-origin request at all.
   */
  @IsOptional()
  @IsString()
  GLASSBEETLE_CORS_ORIGINS?: string;

  /**
   * Operational log level. Defaults to `log`.
   */
  @IsOptional()
  @IsEnum(LogLevel, {
    message: `GLASSBEETLE_LOG_LEVEL must be one of: ${Object.values(LogLevel).join(', ')}`,
  })
  GLASSBEETLE_LOG_LEVEL?: LogLevel;

  /**
   * Enables request-body logging when set to `true` or `1`; any other value,
   * including unset, leaves it off.
   *
   * A string rather than a boolean because environment variables are strings
   * and the permissive readings of "false" are what this setting must not
   * accept.
   */
  @IsOptional()
  @IsString()
  GLASSBEETLE_LOG_BODY?: string;

  /**
   * Largest accepted picture upload, in bytes. Positive integer; defaults to
   * 5 MiB.
   */
  @IsOptional()
  @IsInt({ message: 'GLASSBEETLE_MAX_PICTURE_SIZE_BYTES must be an integer' })
  @Min(1, {
    message: 'GLASSBEETLE_MAX_PICTURE_SIZE_BYTES must be greater than 0',
  })
  GLASSBEETLE_MAX_PICTURE_SIZE_BYTES?: number;

  /**
   * Name the single user profile is seeded with on first read.
   *
   * At most 120 characters. Unset, the operating system account name is used.
   * Only ever consulted while seeding, so a name later changed through the API
   * is not overwritten on restart.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120, {
    message: 'GLASSBEETLE_USER_NAME must not exceed 120 characters',
  })
  GLASSBEETLE_USER_NAME?: string;
}

/**
 * Validates the process environment at startup.
 *
 * Failing here means the application refuses to boot with a message naming the
 * offending setting, rather than starting half-configured and failing later in
 * a way that is harder to diagnose.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const parsed = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
    excludeExtraneousValues: false,
  });

  const errors = validateSync(parsed, {
    skipMissingProperties: false,
    whitelist: false,
    forbidNonWhitelisted: false,
  });

  if (errors.length > 0) {
    const messages = errors.flatMap((error) =>
      Object.values(error.constraints ?? {}),
    );

    throw new Error(
      `Invalid application configuration:\n  - ${messages.join('\n  - ')}`,
    );
  }

  // Path shape is checked here rather than with a decorator so the message names
  // the setting and shows the offending value.
  if (
    typeof config.GLASSBEETLE_DATA_DIR === 'string' &&
    config.GLASSBEETLE_DATA_DIR.trim()
  ) {
    assertAbsolutePath(
      'GLASSBEETLE_DATA_DIR',
      config.GLASSBEETLE_DATA_DIR.trim(),
    );
  }

  if (
    typeof config.GLASSBEETLE_DATABASE_PATH === 'string' &&
    config.GLASSBEETLE_DATABASE_PATH.trim()
  ) {
    assertAbsolutePath(
      'GLASSBEETLE_DATABASE_PATH',
      config.GLASSBEETLE_DATABASE_PATH.trim(),
    );
  }

  if (
    typeof config.GLASSBEETLE_MASTER_KEY_FILE === 'string' &&
    config.GLASSBEETLE_MASTER_KEY_FILE.trim()
  ) {
    assertAbsolutePath(
      'GLASSBEETLE_MASTER_KEY_FILE',
      config.GLASSBEETLE_MASTER_KEY_FILE.trim(),
    );
  }

  return config;
}
