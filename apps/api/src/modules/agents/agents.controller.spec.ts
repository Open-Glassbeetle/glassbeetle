import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';
import type { PaginatedResponse } from '../../common/pagination/paginated-response.dto.js';
import type { AgentResponseDto } from './dto/agent-response.dto.js';
import type { ListAgentsQueryDto } from './dto/list-agents-query.dto.js';

describe('AgentsController', () => {
  let controller: AgentsController;
  let service: AgentsService;

  const mockResponse: PaginatedResponse<AgentResponseDto> = {
    items: [
      {
        id: '018f3a9e-0000-7000-8000-000000000001',
        name: 'Test Agent',
        personality: null,
        instructions: null,
        systemPromptId: null,
        modelId: null,
        temperature: null,
        maxTokens: null,
        modelParams: null,
        hasPicture: false,
        createdAt: '2026-10-04T00:00:00.000Z',
        updatedAt: '2026-10-04T00:00:00.000Z',
      },
    ],
    total: 1,
    limit: 50,
    offset: 0,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [
        {
          provide: AgentsService,
          useValue: {
            findAll: vi.fn().mockResolvedValue(mockResponse),
          },
        },
      ],
    }).compile();

    controller = module.get<AgentsController>(AgentsController);
    service = module.get<AgentsService>(AgentsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('delegates to agentsService.findAll and returns paginated result', async () => {
      const query: ListAgentsQueryDto = { limit: 10, offset: 0, name: 'Test' };
      const result = await controller.findAll(query);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(result).toBe(mockResponse);
    });
  });
});
