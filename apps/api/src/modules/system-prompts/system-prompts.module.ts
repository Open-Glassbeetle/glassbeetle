import { Module } from '@nestjs/common';
import { SystemPromptsController } from './system-prompts.controller.js';
import { SystemPromptsService } from './system-prompts.service.js';

@Module({
  controllers: [SystemPromptsController],
  providers: [SystemPromptsService],
  exports: [SystemPromptsService],
})
export class SystemPromptsModule {}
