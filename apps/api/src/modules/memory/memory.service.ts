import { Injectable } from '@nestjs/common';
import { AgentMemoriesService } from './agent-memories/agent-memories.service.js';
import { SharedMemoriesService } from './shared-memories/shared-memories.service.js';
import type { BulkDeleteResponseDto } from './dto/index.js';

/**
 * Coordination service for memory operations spanning agent and shared scopes.
 *
 * A seam rather than a layer: it holds no SQL of its own and only forwards to
 * the two scope services. It exists so that an operation which has to touch
 * both scopes — a future "forget everything about X" — has a place that
 * already owns both, instead of one scope service reaching into the other.
 *
 * The controllers call their own scope service directly; nothing routes through
 * here today.
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
