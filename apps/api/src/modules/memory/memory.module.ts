import { Module } from '@nestjs/common';
import { AgentMemoriesService } from './agent-memories/agent-memories.service.js';
import { AgentMemoriesController } from './agent-memories/agent-memories.controller.js';
import { MemoryService } from './memory.service.js';
import { SharedMemoriesService } from './shared-memories/shared-memories.service.js';
import { SharedMemoriesController } from './shared-memories/shared-memories.controller.js';

/**
 * Wires both kinds of memory and the coordination service over them.
 *
 * One module for two resources mounted at unrelated paths —
 * `/agents/:agentId/memories` and `/memories` — because they are the same
 * concept at two scopes: one agent's private recollection, and facts every
 * agent can see. They share the tag helpers, the bulk-delete DTOs and the
 * same row shape, so splitting them would duplicate all three.
 *
 * @see `docs/memory-tags.md`
 */
@Module({
  providers: [MemoryService, AgentMemoriesService, SharedMemoriesService],
  controllers: [AgentMemoriesController, SharedMemoriesController],
  exports: [MemoryService, AgentMemoriesService, SharedMemoriesService],
})
export class MemoryModule {}
