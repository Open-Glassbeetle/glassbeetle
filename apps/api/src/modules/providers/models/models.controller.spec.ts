import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelsController } from './models.controller.js';
import { ModelsService } from './models.service.js';
import type {
  ListModelsQueryDto,
  ModelDto,
  PaginatedModelsResponseDto,
  UpdateModelDto,
} from './dto/index.js';

describe('ModelsController', () => {
  let controller: ModelsController;
  let mockModelsService: {
    listAll: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  const modelId = '018f3a9e-0000-7000-8000-000000000001';
  const providerId = '018f3a9e-0000-7000-8000-000000000002';

  const sampleModel: ModelDto = {
    id: modelId,
    providerId,
    modelIdentifier: 'claude-sonnet-5',
    displayName: 'Claude Sonnet 3.5',
    source: 'manual',
    contextWindow: 200000,
    defaultTemperature: 0.7,
    defaultMaxTokens: 8192,
    enabled: true,
    createdAt: '2026-10-24T12:00:00.000Z',
    updatedAt: '2026-10-24T12:00:00.000Z',
    provider: {
      id: providerId,
      name: 'Anthropic',
      kind: 'anthropic',
    },
  };

  beforeEach(async () => {
    mockModelsService = {
      listAll: vi.fn(),
      findOne: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ModelsController],
      providers: [
        {
          provide: ModelsService,
          useValue: mockModelsService,
        },
      ],
    }).compile();

    controller = module.get<ModelsController>(ModelsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('delegates to modelsService.listAll with query parameters', () => {
      const query: ListModelsQueryDto = {
        limit: 20,
        offset: 0,
        providerId,
        enabled: true,
        source: 'manual',
      };
      const expectedResponse: PaginatedModelsResponseDto = {
        items: [sampleModel],
        total: 1,
        limit: 20,
        offset: 0,
      };

      mockModelsService.listAll.mockReturnValueOnce(expectedResponse);

      const result = controller.findAll(query);

      expect(mockModelsService.listAll).toHaveBeenCalledWith(query);
      expect(result).toBe(expectedResponse);
    });
  });

  describe('findOne', () => {
    it('delegates to modelsService.findOne with modelId', () => {
      mockModelsService.findOne.mockReturnValueOnce(sampleModel);

      const result = controller.findOne(modelId);

      expect(mockModelsService.findOne).toHaveBeenCalledWith(modelId);
      expect(result).toBe(sampleModel);
    });
  });

  describe('update', () => {
    it('delegates to modelsService.update with modelId and dto', () => {
      const dto: UpdateModelDto = {
        displayName: 'Updated Claude',
        enabled: false,
      };
      const updatedModel = { ...sampleModel, ...dto };
      mockModelsService.update.mockReturnValueOnce(updatedModel);

      const result = controller.update(modelId, dto);

      expect(mockModelsService.update).toHaveBeenCalledWith(modelId, dto);
      expect(result).toBe(updatedModel);
    });
  });

  describe('delete', () => {
    it('delegates to modelsService.delete with modelId', () => {
      mockModelsService.delete.mockReturnValueOnce(undefined);

      controller.delete(modelId);

      expect(mockModelsService.delete).toHaveBeenCalledWith(modelId);
    });
  });
});
