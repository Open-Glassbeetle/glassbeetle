import { Module } from '@nestjs/common';
import { InferenceService } from './inference.service';

@Module({
  providers: [InferenceService]
})
export class InferenceModule {}
