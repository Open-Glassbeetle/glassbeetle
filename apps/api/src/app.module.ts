import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './database/database.module';
import { CryptoModule } from './crypto/crypto.module';
import { FileStorageModule } from './file-storage/file-storage.module';
import { ModelAdaptersModule } from './model-adapters/model-adapters.module';
import { CommonModule } from './common/common.module';
import { HealthModule } from './modules/health/health.module';
import { AgentsModule } from './modules/agents/agents.module';
import { MemoryModule } from './modules/memory/memory.module';
import { TeamsModule } from './modules/teams/teams.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ChatsModule } from './modules/chats/chats.module';
import { InferenceModule } from './modules/inference/inference.module';
import { ArtifactsModule } from './modules/artifacts/artifacts.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { SystemPromptsModule } from './modules/system-prompts/system-prompts.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { ApplicationModule } from './modules/application/application.module';

@Module({
  imports: [DatabaseModule, CryptoModule, FileStorageModule, ModelAdaptersModule, CommonModule, HealthModule, AgentsModule, MemoryModule, TeamsModule, ProjectsModule, ChatsModule, InferenceModule, ArtifactsModule, ProvidersModule, SystemPromptsModule, AnalyticsModule, ApplicationModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
