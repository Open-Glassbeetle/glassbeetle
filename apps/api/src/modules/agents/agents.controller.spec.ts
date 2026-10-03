import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';
import type { PaginatedResponse } from '../../common/pagination/paginated-response.dto.js';
import type { AgentResponseDto } from './dto/agent-response.dto.js';
import type { CreateAgentDto } from './dto/create-agent.dto.js';
import type { ListAgentsQueryDto } from './dto/list-agents-query.dto.js';

describe('AgentsController', () => {
  let controller: AgentsController;
  let service: AgentsService;

  const mockAgent: AgentResponseDto = {
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
  };

  const mockResponse: PaginatedResponse<AgentResponseDto> = {
    items: [mockAgent],
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
            create: vi.fn().mockResolvedValue(mockAgent),
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

  describe('create', () => {
    it('creates an agent, sets Location header, and returns created agent', async () => {
      const dto: CreateAgentDto = { name: 'Test Agent' };
      const res = {
        setHeader: vi.fn(),
      } as unknown as Response;

      const result = await controller.create(dto, res);

      expect(service.create).toHaveBeenCalledWith(dto);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Location',
        `/api/v1/agents/${mockAgent.id}`,
      );
      expect(result).toBe(mockAgent);
    });
  });
});
