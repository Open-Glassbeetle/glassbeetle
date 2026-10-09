import { Injectable } from '@nestjs/common';
import { AgentMemoriesService } from './agent-memories/agent-memories.service.js';
import { SharedMemoriesService } from './shared-memories/shared-memories.service.js';
import type { BulkDeleteResponseDto } from './dto/index.js';

/**
 * Coordination service for memory operations spanning agent and shared scopes.
 */
@Injectable()
export class MemoryService {
  constructor(
    private readonly agentMemoriesService: AgentMemoriesService,
    private readonly sharedMemoriesService: SharedMemoriesService,
  ) {}

  /**
   * Clears all private memories for a given agent.
   */
  async clearAgentMemories(agentId: string): Promise<BulkDeleteResponseDto> {
    return this.agentMemoriesService.removeAll(agentId);
  }

  /**
   * Clears all shared memories.
   */
  async clearSharedMemories(): Promise<BulkDeleteResponseDto> {
    return this.sharedMemoriesService.removeAll();
  }
}
