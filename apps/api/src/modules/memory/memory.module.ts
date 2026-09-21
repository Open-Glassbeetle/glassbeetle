import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service.js';
import { AgentMemoriesController } from './agent-memories/agent-memories.controller.js';
import { SharedMemoriesController } from './shared-memories/shared-memories.controller.js';

@Module({
  providers: [MemoryService],
  controllers: [AgentMemoriesController, SharedMemoriesController]
})
export class MemoryModule {}
