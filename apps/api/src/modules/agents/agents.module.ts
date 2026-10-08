import { Module } from '@nestjs/common';
import { PictureUploadInterceptor } from '../../common/http/picture-upload.interceptor.js';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';

@Module({
  controllers: [AgentsController],
  providers: [AgentsService, PictureUploadInterceptor],
  exports: [AgentsService],
})
export class AgentsModule {}

