import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AppConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { CryptoModule } from './crypto/crypto.module.js';
import { FileStorageModule } from './file-storage/file-storage.module.js';
import { ModelAdaptersModule } from './model-adapters/model-adapters.module.js';
import { CommonModule } from './common/common.module.js';
import { RequestLoggingMiddleware } from './common/logging/request-logging.middleware.js';
import { HealthModule } from './modules/health/health.module.js';
import { AgentsModule } from './modules/agents/agents.module.js';
import { MemoryModule } from './modules/memory/memory.module.js';
import { TeamsModule } from './modules/teams/teams.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { ChatsModule } from './modules/chats/chats.module.js';
import { InferenceModule } from './modules/inference/inference.module.js';
import { ArtifactsModule } from './modules/artifacts/artifacts.module.js';
import { ProvidersModule } from './modules/providers/providers.module.js';
import { SystemPromptsModule } from './modules/system-prompts/system-prompts.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { ApplicationModule } from './modules/application/application.module.js';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    CryptoModule,
    FileStorageModule,
    ModelAdaptersModule,
    CommonModule,
    HealthModule,
    AgentsModule,
    MemoryModule,
    TeamsModule,
    ProjectsModule,
    ChatsModule,
    InferenceModule,
    ArtifactsModule,
    ProvidersModule,
    SystemPromptsModule,
    AnalyticsModule,
    ApplicationModule,
  ],
  controllers: [AppController],
  providers: [AppService, RequestLoggingMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggingMiddleware).forRoutes('*');
  }
}
