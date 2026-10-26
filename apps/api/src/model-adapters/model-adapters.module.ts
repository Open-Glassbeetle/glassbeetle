import { Module } from '@nestjs/common';
import { AdapterFactoryService } from './adapter-factory/adapter-factory.service.js';

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
export class ModelAdaptersModule {}
