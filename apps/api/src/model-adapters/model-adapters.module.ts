import { Module } from '@nestjs/common';
import { AdapterFactoryService } from './adapter-factory/adapter-factory.service.js';

@Module({
  providers: [AdapterFactoryService]
})
export class ModelAdaptersModule {}
