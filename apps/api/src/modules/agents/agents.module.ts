import { Module } from '@nestjs/common';
import { AgentPictureInterceptor } from './agent-picture.interceptor.js';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';

@Module({
  controllers: [AgentsController],
  providers: [AgentsService, AgentPictureInterceptor],
  exports: [AgentsService],
})
export class AgentsModule {}

