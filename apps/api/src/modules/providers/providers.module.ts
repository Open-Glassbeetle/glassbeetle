import { Module } from '@nestjs/common';
import { CryptoModule } from '../../crypto/crypto.module.js';
import { ModelAdaptersModule } from '../../model-adapters/model-adapters.module.js';
import { ProvidersController } from './providers.controller.js';
import { ProvidersService } from './providers.service.js';
import { CredentialsController } from './credentials/credentials.controller.js';
import { CredentialsService } from './credentials/credentials.service.js';
import { ProviderModelsController } from './provider-models/provider-models.controller.js';
import { ModelsController } from './models/models.controller.js';
import { ModelsService } from './models/models.service.js';

/**
 * Wires `/providers` and the resources below it.
 *
 * Imports {@link CryptoModule} to provide {@link "crypto/encryption/encryption.service".EncryptionService} for
 * encrypting provider API keys at rest, and {@link ModelAdaptersModule}
 * to provide {@link "model-adapters/adapter-factory/adapter-factory.service".AdapterFactoryService} for model discovery.
 */
@Module({
  imports: [CryptoModule, ModelAdaptersModule],
  controllers: [
    ProvidersController,
    CredentialsController,
    ProviderModelsController,
    ModelsController,
  ],
  providers: [ProvidersService, CredentialsService, ModelsService],
  exports: [ProvidersService, CredentialsService, ModelsService],
})
export class ProvidersModule {}
