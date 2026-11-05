import { Module } from '@nestjs/common';
import { ArtifactsController } from './artifacts.controller.js';
import { ArtifactsService } from './artifacts.service.js';

/**
 * Wires the `/artifacts` resource.
 *
 * Exposes CRUD endpoints for artifacts, which serve as first-class work products
 * (documents, code, files, structured data) produced by agents or supplied by users.
 * References to projects, chats, and agents use `ON DELETE SET NULL`, ensuring
 * artifacts outlive whatever produced them.
 */
@Module({
  controllers: [ArtifactsController],
  providers: [ArtifactsService],
  exports: [ArtifactsService],
})
export class ArtifactsModule {}
