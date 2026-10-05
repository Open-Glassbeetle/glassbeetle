import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaginatedResponse } from '../../common/pagination/paginated-response.dto.js';
import { SystemPromptsController } from './system-prompts.controller.js';
import { SystemPromptsService } from './system-prompts.service.js';
import type {
  CreateSystemPromptDto,
  ListSystemPromptsQueryDto,
  SystemPromptResponseDto,
  UpdateSystemPromptDto,
} from './dto/index.js';

describe('SystemPromptsController', () => {
  let controller: SystemPromptsController;
  let service: SystemPromptsService;

  const mockPrompt: SystemPromptResponseDto = {
    id: '018f3a9e-0000-7000-8000-000000000001',
    name: 'Assistant Template',
    content: 'You are a helpful coding assistant.',
    createdAt: '2026-10-04T00:00:00.000Z',
    updatedAt: '2026-10-04T00:00:00.000Z',
  };

  const mockPaginatedResponse: PaginatedResponse<SystemPromptResponseDto> = {
    items: [mockPrompt],
    total: 1,
    limit: 50,
    offset: 0,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SystemPromptsController],
      providers: [
        {
          provide: SystemPromptsService,
          useValue: {
            findAll: vi.fn().mockResolvedValue(mockPaginatedResponse),
            findOne: vi.fn().mockResolvedValue(mockPrompt),
            create: vi.fn().mockResolvedValue(mockPrompt),
            update: vi.fn().mockResolvedValue(mockPrompt),
            delete: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    controller = module.get<SystemPromptsController>(SystemPromptsController);
    service = module.get<SystemPromptsService>(SystemPromptsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('delegates to systemPromptsService.findAll and returns paginated result', async () => {
      const query: ListSystemPromptsQueryDto = {
        limit: 10,
        offset: 0,
        name: 'Assistant',
      };
      const result = await controller.findAll(query);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(result).toBe(mockPaginatedResponse);
    });
  });

  describe('findOne', () => {
    it('delegates to systemPromptsService.findOne and returns system prompt', async () => {
      const result = await controller.findOne(mockPrompt.id);

      expect(service.findOne).toHaveBeenCalledWith(mockPrompt.id);
      expect(result).toBe(mockPrompt);
    });
  });

  describe('create', () => {
    it('creates a system prompt, sets Location header, and returns created prompt', async () => {
      const dto: CreateSystemPromptDto = {
        name: 'Assistant Template',
        content: 'You are a helpful assistant.',
      };
      const res = {
        setHeader: vi.fn(),
      } as unknown as Response;

      const result = await controller.create(dto, res);

      expect(service.create).toHaveBeenCalledWith(dto);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Location',
        `/api/v1/system-prompts/${mockPrompt.id}`,
      );
      expect(result).toBe(mockPrompt);
    });
  });

  describe('update', () => {
    it('delegates to systemPromptsService.update and returns updated prompt', async () => {
      const dto: UpdateSystemPromptDto = {
        name: 'Updated Template',
      };
      const result = await controller.update(mockPrompt.id, dto);

      expect(service.update).toHaveBeenCalledWith(mockPrompt.id, dto);
      expect(result).toBe(mockPrompt);
    });
  });

  describe('delete', () => {
    it('delegates to systemPromptsService.delete and returns void', async () => {
      await controller.delete(mockPrompt.id);

      expect(service.delete).toHaveBeenCalledWith(mockPrompt.id);
    });
  });
});
