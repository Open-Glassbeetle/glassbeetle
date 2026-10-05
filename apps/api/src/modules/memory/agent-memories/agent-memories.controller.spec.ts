import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaginatedResponse } from '../../../common/pagination/paginated-response.dto.js';
import { AgentMemoriesController } from './agent-memories.controller.js';
import { AgentMemoriesService } from './agent-memories.service.js';
import type {
  AgentMemoryResponseDto,
  CreateAgentMemoryDto,
  ListAgentMemoriesQueryDto,
} from './dto/index.js';

describe('AgentMemoriesController', () => {
  let controller: AgentMemoriesController;
  let service: AgentMemoriesService;

  const mockMemory: AgentMemoryResponseDto = {
    id: '018f3a9e-0000-7000-8000-000000000001',
    agentId: '018f3a9e-0000-7000-8000-000000000002',
    content: 'Prefers TypeScript over Python.',
    tags: ['preference', 'language'],
    createdAt: '2026-10-04T00:00:00.000Z',
    updatedAt: '2026-10-04T00:00:00.000Z',
  };

  const mockPaginatedResponse: PaginatedResponse<AgentMemoryResponseDto> = {
    items: [mockMemory],
    total: 1,
    limit: 50,
    offset: 0,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentMemoriesController],
      providers: [
        {
          provide: AgentMemoriesService,
          useValue: {
            findAll: vi.fn().mockResolvedValue(mockPaginatedResponse),
            create: vi.fn().mockResolvedValue(mockMemory),
          },
        },
      ],
    }).compile();

    controller = module.get<AgentMemoriesController>(AgentMemoriesController);
    service = module.get<AgentMemoriesService>(AgentMemoriesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('delegates to agentMemoriesService.findAll and returns paginated result', async () => {
      const query: ListAgentMemoriesQueryDto = {
        limit: 10,
        offset: 0,
        tag: 'preference',
      };

      const result = await controller.findAll('agent-1', query);

      expect(service.findAll).toHaveBeenCalledWith('agent-1', query);
      expect(result).toBe(mockPaginatedResponse);
    });
  });

  describe('create', () => {
    it('delegates to agentMemoriesService.create and sets Location header', async () => {
      const dto: CreateAgentMemoryDto = {
        content: 'Prefers TypeScript over Python.',
        tags: ['preference', 'language'],
      };

      const mockResponse = {
        setHeader: vi.fn(),
      } as unknown as Response;

      const result = await controller.create('agent-1', dto, mockResponse);

      expect(service.create).toHaveBeenCalledWith('agent-1', dto);
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Location',
        `/api/v1/agents/agent-1/memories/${mockMemory.id}`,
      );
      expect(result).toBe(mockMemory);
    });
  });
});
