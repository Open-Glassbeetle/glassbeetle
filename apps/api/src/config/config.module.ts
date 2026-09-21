import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import appConfig from './app.config.js';
import { AppConfigService } from './app-config.service.js';
import { validateEnv } from './env.validation.js';

/**
 * Application configuration.
 *
 * Global so that feature modules can inject {@link AppConfigService} without
 * importing this module everywhere. A `.env` file is read when present but is
 * not required: Glassbeetle is an installed desktop application and must start
 * with sensible per-user defaults rather than demanding a configuration file.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [appConfig],
      validate: validateEnv,
      envFilePath: ['.env'],
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
