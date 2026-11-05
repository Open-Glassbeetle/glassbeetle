import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaginatedResponse } from '../../common/pagination/paginated-response.dto.js';
import { ArtifactsController } from './artifacts.controller.js';
import { ArtifactsService } from './artifacts.service.js';
import type {
  ArtifactResponseDto,
  CreateArtifactDto,
  ListArtifactsQueryDto,
  UpdateArtifactDto,
} from './dto/index.js';

describe('ArtifactsController', () => {
  let controller: ArtifactsController;
  let service: ArtifactsService;

  const mockArtifact: ArtifactResponseDto = {
    id: '018f3a9e-0000-7000-8000-000000000001',
    projectId: '018f3a9e-0000-7000-8000-000000000002',
    chatId: '018f3a9e-0000-7000-8000-000000000003',
    agentId: '018f3a9e-0000-7000-8000-000000000004',
    title: 'Test Artifact',
    type: 'document',
    mimeType: 'text/markdown',
    content: '# Test Content',
    hasFile: false,
    version: 1,
    createdAt: '2026-09-21T09:30:52.000Z',
    updatedAt: '2026-09-21T09:30:52.000Z',
  };

  const mockPaginatedResponse: PaginatedResponse<ArtifactResponseDto> = {
    items: [mockArtifact],
    total: 1,
    limit: 50,
    offset: 0,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ArtifactsController],
      providers: [
        {
          provide: ArtifactsService,
          useValue: {
            findAll: vi.fn().mockResolvedValue(mockPaginatedResponse),
            findOne: vi.fn().mockResolvedValue(mockArtifact),
            create: vi.fn().mockResolvedValue(mockArtifact),
            update: vi.fn().mockResolvedValue(mockArtifact),
            delete: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    controller = module.get<ArtifactsController>(ArtifactsController);
    service = module.get<ArtifactsService>(ArtifactsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('delegates to artifactsService.findAll and returns paginated result', async () => {
      const query: ListArtifactsQueryDto = {
        limit: 10,
        offset: 0,
        type: 'document',
      };
      const result = await controller.findAll(query);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(result).toBe(mockPaginatedResponse);
    });
  });

  describe('findOne', () => {
    it('delegates to artifactsService.findOne and returns artifact', async () => {
      const result = await controller.findOne(mockArtifact.id);

      expect(service.findOne).toHaveBeenCalledWith(mockArtifact.id);
      expect(result).toBe(mockArtifact);
    });
  });

  describe('create', () => {
    it('creates an artifact, sets Location header, and returns created artifact', async () => {
      const dto: CreateArtifactDto = {
        title: 'New Artifact',
        type: 'document',
        content: '# Spec',
      };
      const res = {
        setHeader: vi.fn(),
      } as unknown as Response;

      const result = await controller.create(dto, res);

      expect(service.create).toHaveBeenCalledWith(dto);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Location',
        `/api/v1/artifacts/${mockArtifact.id}`,
      );
      expect(result).toBe(mockArtifact);
    });
  });

  describe('update', () => {
    it('delegates to artifactsService.update and returns updated artifact', async () => {
      const dto: UpdateArtifactDto = {
        title: 'Updated Title',
      };

      const result = await controller.update(mockArtifact.id, dto);

      expect(service.update).toHaveBeenCalledWith(mockArtifact.id, dto);
      expect(result).toBe(mockArtifact);
    });
  });

  describe('delete', () => {
    it('delegates to artifactsService.delete', async () => {
      await controller.delete(mockArtifact.id);

      expect(service.delete).toHaveBeenCalledWith(mockArtifact.id);
    });
  });
});
