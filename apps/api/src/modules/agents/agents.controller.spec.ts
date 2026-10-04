import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';
import type { PaginatedResponse } from '../../common/pagination/paginated-response.dto.js';
import type { AgentResponseDto } from './dto/agent-response.dto.js';
import type { CreateAgentDto } from './dto/create-agent.dto.js';
import type { ListAgentsQueryDto } from './dto/list-agents-query.dto.js';
import type { UpdateAgentDto } from './dto/update-agent.dto.js';

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
            findOne: vi.fn().mockResolvedValue(mockAgent),
            create: vi.fn().mockResolvedValue(mockAgent),
            update: vi.fn().mockResolvedValue(mockAgent),
            delete: vi.fn().mockResolvedValue(undefined),
            uploadPicture: vi.fn().mockResolvedValue({
              ...mockAgent,
              hasPicture: true,
            }),
            deletePicture: vi.fn().mockResolvedValue(undefined),
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

  describe('findOne', () => {
    it('delegates to agentsService.findOne and returns agent', async () => {
      const result = await controller.findOne(mockAgent.id);

      expect(service.findOne).toHaveBeenCalledWith(mockAgent.id);
      expect(result).toBe(mockAgent);
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

  describe('update', () => {
    it('delegates to agentsService.update and returns updated agent', async () => {
      const dto: UpdateAgentDto = { name: 'Updated Name', temperature: 0.5 };
      const result = await controller.update(mockAgent.id, dto);

      expect(service.update).toHaveBeenCalledWith(mockAgent.id, dto);
      expect(result).toBe(mockAgent);
    });
  });

  describe('delete', () => {
    it('delegates to agentsService.delete and returns void', async () => {
      await controller.delete(mockAgent.id);

      expect(service.delete).toHaveBeenCalledWith(mockAgent.id);
    });
  });

  describe('uploadPicture', () => {
    const mockFile = {
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      originalname: 'pic.png',
      mimetype: 'image/png',
      size: 4,
    } as Express.Multer.File;

    it('delegates to agentsService.uploadPicture and returns updated agent', async () => {
      const result = await controller.uploadPicture(mockAgent.id, mockFile);

      expect(service.uploadPicture).toHaveBeenCalledWith(
        mockAgent.id,
        mockFile,
      );
      expect(result.hasPicture).toBe(true);
    });

    it('rejects when file is undefined or empty with BadRequestException', async () => {
      await expect(
        controller.uploadPicture(mockAgent.id, undefined),
      ).rejects.toThrow();

      await expect(
        controller.uploadPicture(mockAgent.id, {
          ...mockFile,
          buffer: Buffer.alloc(0),
        }),
      ).rejects.toThrow();
    });
  });

  describe('deletePicture', () => {
    it('delegates to agentsService.deletePicture and returns void', async () => {
      await controller.deletePicture(mockAgent.id);

      expect(service.deletePicture).toHaveBeenCalledWith(mockAgent.id);
    });
  });
});


