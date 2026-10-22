import { Module } from '@nestjs/common';
import { ProvidersController } from './providers.controller.js';
import { ProvidersService } from './providers.service.js';
import { CredentialsController } from './credentials/credentials.controller.js';
import { CredentialsService } from './credentials/credentials.service.js';
import { ProviderModelsController } from './provider-models/provider-models.controller.js';
import { ModelsController } from './models/models.controller.js';
import { ModelsService } from './models/models.service.js';

/**
 * Wires `/providers` and the three resources below it.
 *
 * Only {@link ProvidersService} and its controller are implemented.
 * `CredentialsController`, `ModelsController` and `ProviderModelsController`
 * declare their paths but no routes, and their services are empty — so a
 * provider can be configured, but its API key cannot be stored and its
 * models cannot be listed.
 *
 * Does not import `CryptoModule`. It will have to, once credentials are
 * implemented: `provider_credentials` stores an encrypted value and its
 * nonce, which only `EncryptionService` can produce.
 */
@Module({
  controllers: [ProvidersController, CredentialsController, ProviderModelsController, ModelsController],
  providers: [ProvidersService, CredentialsService, ModelsService]
})
export class ProvidersModule {}
