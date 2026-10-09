import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentMemoriesService } from './agent-memories/agent-memories.service.js';
import { MemoryService } from './memory.service.js';
import { SharedMemoriesService } from './shared-memories/shared-memories.service.js';

describe('MemoryService', () => {
  let service: MemoryService;
  let agentMemoriesService: AgentMemoriesService;
  let sharedMemoriesService: SharedMemoriesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryService,
        {
          provide: AgentMemoriesService,
          useValue: {
            removeAll: vi.fn().mockResolvedValue({ deleted: 2 }),
          },
        },
        {
          provide: SharedMemoriesService,
          useValue: {
            removeAll: vi.fn().mockResolvedValue({ deleted: 4 }),
          },
        },
      ],
    }).compile();

    service = module.get<MemoryService>(MemoryService);
    agentMemoriesService =
      module.get<AgentMemoriesService>(AgentMemoriesService);
    sharedMemoriesService = module.get<SharedMemoriesService>(
      SharedMemoriesService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('clearAgentMemories', () => {
    it('delegates to agentMemoriesService.removeAll', async () => {
      const result = await service.clearAgentMemories('agent-1');

      expect(agentMemoriesService.removeAll).toHaveBeenCalledWith('agent-1');
      expect(result).toEqual({ deleted: 2 });
    });
  });

  describe('clearSharedMemories', () => {
    it('delegates to sharedMemoriesService.removeAll', async () => {
      const result = await service.clearSharedMemories();

      expect(sharedMemoriesService.removeAll).toHaveBeenCalled();
      expect(result).toEqual({ deleted: 4 });
    });
  });
});
