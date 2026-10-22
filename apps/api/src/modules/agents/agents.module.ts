import { Module } from '@nestjs/common';
import { PictureUploadInterceptor } from '../../common/http/picture-upload.interceptor.js';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';

/**
 * Wires the `/agents` resource.
 *
 * Exports {@link AgentsService} because an agent is referenced throughout the
 * domain — teams, chats, messages, memories and artifacts all point at one —
 * so other modules need to read agents without reaching into the database
 * themselves. `PictureUploadInterceptor` is registered as a provider so Nest
 * can inject `AppConfigService` into it; an interceptor named only in
 * `@UseInterceptors()` would be constructed without its dependencies.
 */
@Module({
  controllers: [AgentsController],
  providers: [AgentsService, PictureUploadInterceptor],
  exports: [AgentsService],
})
export class AgentsModule {}

