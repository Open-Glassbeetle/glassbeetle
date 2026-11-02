import { Module } from '@nestjs/common';
import { ModelAdaptersModule } from '../../model-adapters/model-adapters.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { ContextConstructionService } from './context-construction.service.js';
import { InferenceService } from './inference.service.js';

/**
 * Owns model invocation, orchestration, and context construction for chat completions.
 *
 * Imports {@link ModelAdaptersModule} for adapter factory resolution and
 * {@link ProvidersModule} for credentials decryption. Exports {@link InferenceService}
 * and {@link ContextConstructionService} for use by chats and inspection endpoints.
 */
@Module({
  imports: [ModelAdaptersModule, ProvidersModule],
  providers: [InferenceService, ContextConstructionService],
  exports: [InferenceService, ContextConstructionService],
})
export class InferenceModule {}

