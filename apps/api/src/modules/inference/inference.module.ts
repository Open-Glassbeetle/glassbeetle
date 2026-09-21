import { Module } from '@nestjs/common';
import { InferenceService } from './inference.service.js';

@Module({
  providers: [InferenceService]
})
export class InferenceModule {}
