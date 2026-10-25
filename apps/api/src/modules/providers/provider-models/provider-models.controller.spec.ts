import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelsService } from '../models/models.service.js';
import { ProviderModelsController } from './provider-models.controller.js';
import type {
  ListProviderModelsQueryDto,
  ModelDto,
  PaginatedModelsResponseDto,
  RegisterModelDto,
} from '../models/dto/index.js';

describe('ProviderModelsController', () => {
  let controller: ProviderModelsController;
  let mockModelsService: {
    listByProvider: ReturnType<typeof vi.fn>;
    createManual: ReturnType<typeof vi.fn>;
  };

  const providerId = '018f3a9e-0000-7000-8000-000000000001';

  beforeEach(async () => {
    mockModelsService = {
      listByProvider: vi.fn(),
      createManual: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProviderModelsController],
      providers: [
        {
          provide: ModelsService,
          useValue: mockModelsService,
        },
      ],
    }).compile();

    controller = module.get<ProviderModelsController>(ProviderModelsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('list', () => {
    it('delegates to modelsService.listByProvider', () => {
      const query: ListProviderModelsQueryDto = {
        limit: 20,
        offset: 0,
        enabled: true,
      };
      const expectedResponse: PaginatedModelsResponseDto = {
        items: [],
        total: 0,
        limit: 20,
        offset: 0,
      };

      mockModelsService.listByProvider.mockReturnValueOnce(expectedResponse);

      const result = controller.list(providerId, query);

      expect(mockModelsService.listByProvider).toHaveBeenCalledWith(
        providerId,
        query,
      );
      expect(result).toBe(expectedResponse);
    });
  });

  describe('create', () => {
    it('delegates to modelsService.createManual', () => {
      const dto: RegisterModelDto = {
        modelIdentifier: 'claude-sonnet-5',
        displayName: 'Claude Sonnet 3.5',
      };
      const createdModel: ModelDto = {
        id: '018f3a9e-0000-7000-8000-000000000002',
        providerId,
        modelIdentifier: 'claude-sonnet-5',
        displayName: 'Claude Sonnet 3.5',
        source: 'manual',
        contextWindow: null,
        defaultTemperature: null,
        defaultMaxTokens: null,
        enabled: true,
        createdAt: '2026-10-24T12:00:00.000Z',
        updatedAt: '2026-10-24T12:00:00.000Z',
      };

      mockModelsService.createManual.mockReturnValueOnce(createdModel);

      const result = controller.create(providerId, dto);

      expect(mockModelsService.createManual).toHaveBeenCalledWith(
        providerId,
        dto,
      );
      expect(result).toBe(createdModel);
    });
  });

  describe('discover', () => {
    it('delegates to modelsService.discover', async () => {
      const summary = {
        added: 2,
        updated: 1,
        unchanged: 3,
        disabled: 0,
        models: [],
      };
      mockModelsService.discover = vi.fn().mockResolvedValue(summary);

      const result = await controller.discover(providerId, { timeoutMs: 5000 });

      expect(mockModelsService.discover).toHaveBeenCalledWith(providerId, {
        timeoutMs: 5000,
      });
      expect(result).toBe(summary);
    });
  });
});
