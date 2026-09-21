import { Module } from '@nestjs/common';
import { ProvidersController } from './providers.controller.js';
import { ProvidersService } from './providers.service.js';
import { CredentialsController } from './credentials/credentials.controller.js';
import { CredentialsService } from './credentials/credentials.service.js';
import { ProviderModelsController } from './provider-models/provider-models.controller.js';
import { ModelsController } from './models/models.controller.js';
import { ModelsService } from './models/models.service.js';

@Module({
  controllers: [ProvidersController, CredentialsController, ProviderModelsController, ModelsController],
  providers: [ProvidersService, CredentialsService, ModelsService]
})
export class ProvidersModule {}
