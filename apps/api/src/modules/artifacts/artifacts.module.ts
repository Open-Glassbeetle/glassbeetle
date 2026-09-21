import { Module } from '@nestjs/common';
import { ArtifactsController } from './artifacts.controller.js';
import { ArtifactsService } from './artifacts.service.js';

@Module({
  controllers: [ArtifactsController],
  providers: [ArtifactsService]
})
export class ArtifactsModule {}
