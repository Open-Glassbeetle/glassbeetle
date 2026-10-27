import { Module, type OnModuleInit } from '@nestjs/common';
import { AdapterFactoryService } from './adapter-factory/adapter-factory.service.js';
import { AnthropicAdapter } from './anthropic/anthropic.adapter.js';

/**
 * Wires the model adapter abstraction layer.
 *
 * Exports {@link AdapterFactoryService} for the inference and completion pipelines
 * to resolve provider-agnostic {@link "model-adapters/model-adapter.interface".ModelAdapter} instances.
 */
@Module({
  providers: [AdapterFactoryService],
  exports: [AdapterFactoryService],
})
export class ModelAdaptersModule implements OnModuleInit {
  constructor(private readonly adapterFactory: AdapterFactoryService) {}

  onModuleInit(): void {
    this.adapterFactory.register('anthropic', (config) => new AnthropicAdapter(config));
  }
}
