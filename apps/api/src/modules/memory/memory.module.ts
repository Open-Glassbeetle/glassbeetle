import { Module } from '@nestjs/common';
import { AgentMemoriesService } from './agent-memories/agent-memories.service.js';
import { AgentMemoriesController } from './agent-memories/agent-memories.controller.js';
import { MemoryService } from './memory.service.js';
import { SharedMemoriesController } from './shared-memories/shared-memories.controller.js';

@Module({
  providers: [MemoryService, AgentMemoriesService],
  controllers: [AgentMemoriesController, SharedMemoriesController],
  exports: [MemoryService, AgentMemoriesService],
})
export class MemoryModule {}
