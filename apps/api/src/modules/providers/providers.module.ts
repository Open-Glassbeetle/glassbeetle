import { Module } from '@nestjs/common';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { CredentialsController } from './credentials/credentials.controller';
import { CredentialsService } from './credentials/credentials.service';
import { ProviderModelsController } from './provider-models/provider-models.controller';
import { ModelsController } from './models/models.controller';
import { ModelsService } from './models/models.service';

@Module({
  controllers: [ProvidersController, CredentialsController, ProviderModelsController, ModelsController],
  providers: [ProvidersService, CredentialsService, ModelsService]
})
export class ProvidersModule {}
