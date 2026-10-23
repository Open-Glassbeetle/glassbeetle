import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialsController } from './credentials.controller.js';
import { CredentialsService } from './credentials.service.js';
import type { CredentialResponseDto } from './dto/credential-response.dto.js';
import type { SetCredentialDto } from './dto/set-credential.dto.js';

describe('CredentialsController', () => {
  let controller: CredentialsController;
  let service: {
    find: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };

  const sampleMetadata: CredentialResponseDto = {
    providerId: 'provider-123',
    configured: true,
    maskedPreview: 'sk-ant-…4f2a',
    createdAt: '2026-10-24T00:00:00.000Z',
    updatedAt: '2026-10-24T00:00:00.000Z',
  };

  beforeEach(async () => {
    service = {
      find: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CredentialsController],
      providers: [{ provide: CredentialsService, useValue: service }],
    }).compile();

    controller = module.get<CredentialsController>(CredentialsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('find', () => {
    it('delegates to service.find and returns metadata', () => {
      service.find.mockReturnValue(sampleMetadata);

      const result = controller.find('provider-123');

      expect(service.find).toHaveBeenCalledWith('provider-123');
      expect(result).toBe(sampleMetadata);
    });

    it('propagates NotFoundException from service', () => {
      service.find.mockImplementation(() => {
        throw new NotFoundException('Provider not found');
      });

      expect(() => controller.find('unknown')).toThrow(NotFoundException);
    });
  });

  describe('set', () => {
    it('delegates to service.set and returns updated metadata', () => {
      const dto: SetCredentialDto = { apiKey: 'sk-ant-sample-secret-key-1234' };
      service.set.mockReturnValue(sampleMetadata);

      const result = controller.set('provider-123', dto);

      expect(service.set).toHaveBeenCalledWith('provider-123', dto);
      expect(result).toBe(sampleMetadata);
    });
  });

  describe('remove', () => {
    it('delegates to service.remove and returns void (204)', () => {
      service.remove.mockReturnValue(undefined);

      expect(() => controller.remove('provider-123')).not.toThrow();
      expect(service.remove).toHaveBeenCalledWith('provider-123');
    });

    it('propagates NotFoundException from service', () => {
      service.remove.mockImplementation(() => {
        throw new NotFoundException('Provider not found');
      });

      expect(() => controller.remove('unknown')).toThrow(NotFoundException);
    });
  });
});
