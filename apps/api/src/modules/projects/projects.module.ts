import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

/**
 * Will wire the `/projects` resource.
 *
 * A placeholder: the controller declares no routes and the service has no
 * implementation, so importing this module adds nothing to the API. The
 * `projects` table exists in the schema and `chats.project_id` and
 * `artifacts.project_id` already reference it.
 */
@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService]
})
export class ProjectsModule {}
