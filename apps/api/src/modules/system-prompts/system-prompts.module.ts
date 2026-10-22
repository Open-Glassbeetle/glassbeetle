import { Module } from '@nestjs/common';
import { SystemPromptsController } from './system-prompts.controller.js';
import { SystemPromptsService } from './system-prompts.service.js';

/**
 * Wires the `/system-prompts` resource.
 *
 * Exports {@link SystemPromptsService} because an agent references a prompt
 * through `agents.system_prompt_id`, so other features need to read prompts
 * without querying the table themselves.
 */
@Module({
  controllers: [SystemPromptsController],
  providers: [SystemPromptsService],
  exports: [SystemPromptsService],
})
export class SystemPromptsModule {}
