import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  APP_CONFIG_NAMESPACE,
  type AppConfig,
  type NodeEnv,
} from './app.config.js';

/**
 * Typed accessor for application configuration.
 *
 * Consumers inject this rather than `ConfigService` so they get
 * `config.databasePath: string` instead of
 * `configService.get<string>('GLASSBEETLE_DATABASE_PATH')`, which is optional
 * and stringly-typed. Every value here has already been validated and
 * defaulted at startup.
 */
@Injectable()
export class AppConfigService {
  private readonly config: AppConfig;

  constructor(configService: ConfigService) {
    // Non-null: the namespace is registered by `AppConfigModule`, which is the
    // only thing that provides this service.
    this.config = configService.get<AppConfig>(APP_CONFIG_NAMESPACE)!;
  }

  get nodeEnv(): NodeEnv {
    return this.config.nodeEnv;
  }

  get isProduction(): boolean {
    return this.config.nodeEnv === 'production';
  }

  get port(): number {
    return this.config.port;
  }

  /** Root directory for the database, uploaded files, artifacts and backups. */
  get dataDir(): string {
    return this.config.dataDir;
  }

  /** Absolute path of the SQLite database file. */
  get databasePath(): string {
    return this.config.databasePath;
  }

  /** Origins permitted to make cross-origin requests. */
  get corsOrigins(): readonly string[] {
    return this.config.corsOrigins;
  }
}
