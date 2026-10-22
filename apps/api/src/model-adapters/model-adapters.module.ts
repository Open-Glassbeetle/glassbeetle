import { Module } from '@nestjs/common';
import { AdapterFactoryService } from './adapter-factory/adapter-factory.service.js';

/**
 * Will hold the per-provider adapters that talk to model APIs.
 *
 * A placeholder: {@link AdapterFactoryService} has no implementation yet, and
 * the module exports nothing, so importing it has no effect beyond
 * registering that provider. It is wired into `AppModule` already so the
 * module graph does not have to change when the adapters land.
 */
@Module({
  providers: [AdapterFactoryService]
})
export class ModelAdaptersModule {}
