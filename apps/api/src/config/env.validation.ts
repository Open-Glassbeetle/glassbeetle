import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
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
  @IsOptional()
  @IsEnum(NodeEnvironment, {
    message: `NODE_ENV must be one of: ${Object.values(NodeEnvironment).join(', ')}`,
  })
  NODE_ENV?: NodeEnvironment;

  @IsOptional()
  @IsInt({ message: 'PORT must be an integer' })
  @Min(1, { message: 'PORT must be between 1 and 65535' })
  @Max(65535, { message: 'PORT must be between 1 and 65535' })
  PORT?: number;

  @IsOptional()
  @IsString()
  GLASSBEETLE_DATA_DIR?: string;

  @IsOptional()
  @IsString()
  GLASSBEETLE_DATABASE_PATH?: string;

  @IsOptional()
  @IsString()
  GLASSBEETLE_CORS_ORIGINS?: string;

  @IsOptional()
  @IsEnum(LogLevel, {
    message: `GLASSBEETLE_LOG_LEVEL must be one of: ${Object.values(LogLevel).join(', ')}`,
  })
  GLASSBEETLE_LOG_LEVEL?: LogLevel;

  @IsOptional()
  @IsString()
  GLASSBEETLE_LOG_BODY?: string;
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

  return config;
}
