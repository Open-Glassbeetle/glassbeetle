import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaginatedResponse } from '../../../common/pagination/paginated-response.dto.js';
import {
  CreateSharedMemoryDto,
  ListSharedMemoriesQueryDto,
  SharedMemoryResponseDto,
  UpdateSharedMemoryDto,
} from './dto/index.js';
import { SharedMemoriesController } from './shared-memories.controller.js';
import { SharedMemoriesService } from './shared-memories.service.js';

describe('SharedMemoriesController', () => {
  let controller: SharedMemoriesController;
  let service: SharedMemoriesService;

  const mockMemory: SharedMemoryResponseDto = {
    id: '018f3a9e-0000-7000-8000-000000000001',
    content: 'Always format code using Prettier and Oxlint.',
    tags: ['conventions', 'style'],
    createdAt: '2026-10-04T00:00:00.000Z',
    updatedAt: '2026-10-04T00:00:00.000Z',
  };

  const mockPaginatedResponse: PaginatedResponse<SharedMemoryResponseDto> = {
    items: [mockMemory],
    total: 1,
    limit: 50,
    offset: 0,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SharedMemoriesController],
      providers: [
        {
          provide: SharedMemoriesService,
          useValue: {
            findAll: vi.fn().mockResolvedValue(mockPaginatedResponse),
            create: vi.fn().mockResolvedValue(mockMemory),
            findOne: vi.fn().mockResolvedValue(mockMemory),
            update: vi.fn().mockResolvedValue(mockMemory),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    controller = module.get<SharedMemoriesController>(SharedMemoriesController);
    service = module.get<SharedMemoriesService>(SharedMemoriesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('delegates to sharedMemoriesService.findAll and returns paginated result', async () => {
      const query: ListSharedMemoriesQueryDto = {
        limit: 10,
        offset: 0,
        tag: 'conventions',
      };

      const result = await controller.findAll(query);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(result).toBe(mockPaginatedResponse);
    });
  });

  describe('create', () => {
    it('delegates to sharedMemoriesService.create and sets Location header', async () => {
      const dto: CreateSharedMemoryDto = {
        content: 'Always format code using Prettier and Oxlint.',
        tags: ['conventions', 'style'],
      };

      const mockResponse = {
        setHeader: vi.fn(),
      } as unknown as Response;

      const result = await controller.create(dto, mockResponse);

      expect(service.create).toHaveBeenCalledWith(dto);
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Location',
        `/api/v1/memories/${mockMemory.id}`,
      );
      expect(result).toBe(mockMemory);
    });
  });

  describe('findOne', () => {
    it('delegates to sharedMemoriesService.findOne with memoryId', async () => {
      const result = await controller.findOne(mockMemory.id);

      expect(service.findOne).toHaveBeenCalledWith(mockMemory.id);
      expect(result).toBe(mockMemory);
    });
  });

  describe('update', () => {
    it('delegates to sharedMemoriesService.update with memoryId and dto', async () => {
      const dto: UpdateSharedMemoryDto = { content: 'Updated content' };

      const result = await controller.update(mockMemory.id, dto);

      expect(service.update).toHaveBeenCalledWith(mockMemory.id, dto);
      expect(result).toBe(mockMemory);
    });
  });

  describe('remove', () => {
    it('delegates to sharedMemoriesService.remove with memoryId', async () => {
      await controller.remove(mockMemory.id);

      expect(service.remove).toHaveBeenCalledWith(mockMemory.id);
    });
  });
});
