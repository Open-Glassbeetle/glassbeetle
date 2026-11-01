import { Module } from '@nestjs/common';
import { ModelAdaptersModule } from '../../model-adapters/model-adapters.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { InferenceService } from './inference.service.js';

/**
 * Owns model invocation and orchestration for chat completions.
 *
 * Imports {@link ModelAdaptersModule} for adapter factory resolution and
 * {@link ProvidersModule} for credentials decryption. Exports {@link InferenceService}
 * for use by {@link "modules/chats/chats.module".ChatsModule}.
 */
@Module({
  imports: [ModelAdaptersModule, ProvidersModule],
  providers: [InferenceService],
  exports: [InferenceService],
})
export class InferenceModule {}

