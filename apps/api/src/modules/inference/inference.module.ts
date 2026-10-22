import { Module } from '@nestjs/common';
import { InferenceService } from './inference.service.js';

/**
 * Will own model invocation for chat completions.
 *
 * A placeholder: {@link InferenceService} has no implementation yet and is
 * not exported, so no other module can depend on it. Registered in
 * `AppModule` so the wiring exists when it does.
 */
@Module({
  providers: [InferenceService]
})
export class InferenceModule {}
