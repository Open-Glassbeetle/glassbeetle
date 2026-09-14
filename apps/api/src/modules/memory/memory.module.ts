import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { AgentMemoriesController } from './agent-memories/agent-memories.controller';
import { SharedMemoriesController } from './shared-memories/shared-memories.controller';

@Module({
  providers: [MemoryService],
  controllers: [AgentMemoriesController, SharedMemoriesController]
})
export class MemoryModule {}
