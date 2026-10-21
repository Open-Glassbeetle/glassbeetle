import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProvidersController } from './providers.controller.js';
import { ProvidersService } from './providers.service.js';
import type { ProviderDto } from './dto/provider.dto.js';

// Helpers
function makeDto(overrides: Partial<ProviderDto> = {}): ProviderDto {
  return {
    id: 'test-id',
    name: 'Test Provider',
    kind: 'anthropic',
    isLocal: false,
    baseUrl: null,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const mockService = {
  findAll: vi.fn(),
  create: vi.fn(),
  findOne: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
};

let controller: ProvidersController;

// Setup
beforeEach(async () => {
  vi.clearAllMocks();

  const module: TestingModule = await Test.createTestingModule({
    controllers: [ProvidersController],
    providers: [{ provide: ProvidersService, useValue: mockService }],
  }).compile();

  controller = module.get<ProvidersController>(ProvidersController);
});

// findAll
describe('ProvidersController.findAll', () => {
  it('delegates to service.findAll and returns the result', () => {
    const response = { items: [makeDto()], total: 1, limit: 50, offset: 0 };
    mockService.findAll.mockReturnValue(response);

    const result = controller.findAll({ limit: 50, offset: 0 });

    expect(mockService.findAll).toHaveBeenCalledWith({ limit: 50, offset: 0 });
    expect(result).toBe(response);
  });

  it('passes filters to the service', () => {
    mockService.findAll.mockReturnValue({ items: [], total: 0, limit: 50, offset: 0 });
    const query = { limit: 50, offset: 0, kind: 'openai' as const, enabled: true, isLocal: false };

    controller.findAll(query);

    expect(mockService.findAll).toHaveBeenCalledWith(query);
  });
});

// create
describe('ProvidersController.create', () => {
  it('delegates to service.create and returns the created provider', () => {
    const dto = makeDto({ kind: 'anthropic' });
    mockService.create.mockReturnValue(dto);

    const result = controller.create({ name: 'My Anthropic', kind: 'anthropic' });

    expect(result).toBe(dto);
    expect(mockService.create).toHaveBeenCalledOnce();
  });

  it('propagates BadRequestException from the service', () => {
    mockService.create.mockImplementation(() => {
      throw new BadRequestException('baseUrl is required when kind is ollama');
    });

    expect(() =>
      controller.create({ name: 'Ollama', kind: 'ollama' }),
    ).toThrow(BadRequestException);
  });
});

// findOne
describe('ProvidersController.findOne', () => {
  it('delegates to service.findOne with the route param', () => {
    const dto = makeDto({ id: 'abc-123' });
    mockService.findOne.mockReturnValue(dto);

    const result = controller.findOne('abc-123');

    expect(mockService.findOne).toHaveBeenCalledWith('abc-123');
    expect(result).toBe(dto);
  });

  it('propagates NotFoundException from the service', () => {
    mockService.findOne.mockImplementation(() => {
      throw new NotFoundException('Provider not found');
    });

    expect(() => controller.findOne('ghost')).toThrow(NotFoundException);
  });
});

// update
describe('ProvidersController.update', () => {
  it('delegates to service.update with id and body', () => {
    const dto = makeDto({ name: 'Updated' });
    mockService.update.mockReturnValue(dto);

    const result = controller.update('test-id', { name: 'Updated' });

    expect(mockService.update).toHaveBeenCalledWith('test-id', { name: 'Updated' });
    expect(result).toBe(dto);
  });

  it('propagates NotFoundException from the service', () => {
    mockService.update.mockImplementation(() => {
      throw new NotFoundException('Provider not found');
    });

    expect(() => controller.update('ghost', { name: 'X' })).toThrow(NotFoundException);
  });

  it('propagates BadRequestException from the service', () => {
    mockService.update.mockImplementation(() => {
      throw new BadRequestException('baseUrl is required when kind is ollama');
    });

    expect(() =>
      controller.update('test-id', { kind: 'ollama' }),
    ).toThrow(BadRequestException);
  });
});

// remove
describe('ProvidersController.remove', () => {
  it('delegates to service.remove with the route param', () => {
    mockService.remove.mockReturnValue(undefined);

    controller.remove('test-id');

    expect(mockService.remove).toHaveBeenCalledWith('test-id');
  });

  it('propagates NotFoundException from the service', () => {
    mockService.remove.mockImplementation(() => {
      throw new NotFoundException('Provider not found');
    });

    expect(() => controller.remove('ghost')).toThrow(NotFoundException);
  });
});
