import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

/**
 * Wires the `/projects` resource.
 *
 * Exposes CRUD endpoints for projects, which serve as organizing containers
 * for chats and artifacts.
 */
@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
