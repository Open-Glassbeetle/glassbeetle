import { Module } from '@nestjs/common';
import { ArtifactsController } from './artifacts.controller.js';
import { ArtifactsService } from './artifacts.service.js';

/**
 * Will wire the `/artifacts` resource.
 *
 * A placeholder: no routes and no service implementation. The `artifacts`
 * table exists and is referenced by nothing, but it references projects,
 * chats and agents — all three with `ON DELETE SET NULL`, so an artifact
 * outlives whatever produced it.
 */
@Module({
  controllers: [ArtifactsController],
  providers: [ArtifactsService]
})
export class ArtifactsModule {}
