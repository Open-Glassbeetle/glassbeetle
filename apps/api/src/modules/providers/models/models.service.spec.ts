import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../../database/database.service.js';
import {
  type ModelRow,
  type RegisterModelDto,
} from './dto/index.js';
import { ModelsService } from './models.service.js';

function makeModelRow(overrides: Partial<ModelRow> = {}): ModelRow {
  return {
    id: '018f3a9e-0000-7000-8000-000000000001',
    provider_id: '018f3a9e-0000-7000-8000-000000000002',
    model_identifier: 'claude-sonnet-5',
    display_name: 'Claude Sonnet 3.5',
    source: 'manual',
    context_window: 200000,
    default_temperature: 0.7,
    default_max_tokens: 8192,
    enabled: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeMockDb() {
  return {
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
    run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
  };
}

describe('ModelsService', () => {
  let service: ModelsService;
  let mockDb: ReturnType<typeof makeMockDb>;

  const providerId = '018f3a9e-0000-7000-8000-000000000002';

  beforeEach(async () => {
    mockDb = makeMockDb();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModelsService,
        { provide: DatabaseService, useValue: mockDb },
      ],
    }).compile();

    service = module.get<ModelsService>(ModelsService);
  });

  describe('listByProvider', () => {
    it('throws NotFoundException when provider does not exist', () => {
      mockDb.get.mockReturnValueOnce(undefined);

      expect(() =>
        service.listByProvider(providerId, { limit: 50, offset: 0 }),
      ).toThrow(NotFoundException);

      expect(mockDb.get).toHaveBeenCalledWith(
        'SELECT id FROM providers WHERE id = ?',
        [providerId],
      );
    });

    it('returns an empty collection when provider exists but has no models', () => {
      mockDb.get
        .mockReturnValueOnce({ id: providerId }) // assertProviderExists
        .mockReturnValueOnce({ total: 0 }); // COUNT(*)
      mockDb.all.mockReturnValueOnce([]);

      const result = service.listByProvider(providerId, {
        limit: 50,
        offset: 0,
      });

      expect(result).toEqual({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      });
    });

    it('returns models with boolean enabled conversion', () => {
      const row = makeModelRow({ provider_id: providerId, enabled: 1 });
      mockDb.get
        .mockReturnValueOnce({ id: providerId })
        .mockReturnValueOnce({ total: 1 });
      mockDb.all.mockReturnValueOnce([row]);

      const result = service.listByProvider(providerId, {
        limit: 50,
        offset: 0,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
        id: row.id,
        providerId: row.provider_id,
        modelIdentifier: row.model_identifier,
        displayName: row.display_name,
        source: 'manual',
        contextWindow: 200000,
        defaultTemperature: 0.7,
        defaultMaxTokens: 8192,
        enabled: true,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    });

    it('applies filters for enabled and source', () => {
      mockDb.get
        .mockReturnValueOnce({ id: providerId })
        .mockReturnValueOnce({ total: 1 });
      mockDb.all.mockReturnValueOnce([]);

      service.listByProvider(providerId, {
        limit: 10,
        offset: 0,
        enabled: true,
        source: 'manual',
      });

      const countSql = mockDb.get.mock.calls[1][0];
      const countParams = mockDb.get.mock.calls[1][1];

      expect(countSql).toContain('provider_id = ?');
      expect(countSql).toContain('enabled = ?');
      expect(countSql).toContain('source = ?');
      expect(countParams).toEqual([providerId, 1, 'manual']);
    });

    it('throws BadRequestException on invalid sort column', () => {
      mockDb.get.mockReturnValueOnce({ id: providerId });

      expect(() =>
        service.listByProvider(providerId, {
          limit: 50,
          offset: 0,
          sort: 'unknownColumn',
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('createManual', () => {
    const validDto: RegisterModelDto = {
      modelIdentifier: 'claude-sonnet-5',
      displayName: 'Claude Sonnet 3.5',
      contextWindow: 200000,
      defaultTemperature: 0.7,
      defaultMaxTokens: 8192,
      enabled: true,
    };

    it('throws NotFoundException when provider does not exist', () => {
      mockDb.get.mockReturnValueOnce(undefined);

      expect(() => service.createManual(providerId, validDto)).toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when duplicate modelIdentifier exists under the same provider', () => {
      mockDb.get
        .mockReturnValueOnce({ id: providerId }) // assertProviderExists
        .mockReturnValueOnce({ id: 'existing-model-id' }); // duplicate check

      expect(() => service.createManual(providerId, validDto)).toThrow(
        ConflictException,
      );
    });

    it('persists model with source forced to manual and returns created DTO', () => {
      mockDb.get
        .mockReturnValueOnce({ id: providerId }) // assertProviderExists
        .mockReturnValueOnce(undefined) // duplicate check: none found
        .mockImplementation((sql: string) => {
          if (sql.includes('SELECT * FROM models WHERE id = ?')) {
            return makeModelRow({
              provider_id: providerId,
              model_identifier: 'claude-sonnet-5',
              display_name: 'Claude Sonnet 3.5',
              source: 'manual',
              enabled: 1,
            });
          }
          return undefined;
        });

      const result = service.createManual(providerId, validDto);

      expect(mockDb.run).toHaveBeenCalledTimes(1);
      const [insertSql, insertParams] = mockDb.run.mock.calls[0];

      expect(insertSql).toContain('INSERT INTO models');
      expect(insertParams[1]).toBe(providerId);
      expect(insertParams[2]).toBe('claude-sonnet-5');
      expect(insertParams[3]).toBe('Claude Sonnet 3.5');
      expect(insertParams[4]).toBe('manual'); // Forced to manual
      expect(insertParams[8]).toBe(1); // enabled as integer

      expect(result.modelIdentifier).toBe('claude-sonnet-5');
      expect(result.source).toBe('manual');
      expect(result.enabled).toBe(true);
    });

    it('defaults enabled to true when omitted', () => {
      mockDb.get
        .mockReturnValueOnce({ id: providerId })
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(makeModelRow({ enabled: 1 }));

      service.createManual(providerId, {
        modelIdentifier: 'gpt-4o',
        displayName: 'GPT-4o',
      });

      const [, insertParams] = mockDb.run.mock.calls[0];
      expect(insertParams[8]).toBe(1); // enabled defaulted to true -> 1
    });

    it('handles explicit enabled: false', () => {
      mockDb.get
        .mockReturnValueOnce({ id: providerId })
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(makeModelRow({ enabled: 0 }));

      service.createManual(providerId, {
        modelIdentifier: 'gpt-4o',
        displayName: 'GPT-4o',
        enabled: false,
      });

      const [, insertParams] = mockDb.run.mock.calls[0];
      expect(insertParams[8]).toBe(0); // enabled: false -> 0
    });

    it('catches SQLite unique constraint violation and surfaces 409 ConflictException', () => {
      mockDb.get
        .mockReturnValueOnce({ id: providerId })
        .mockReturnValueOnce(undefined); // race condition: duplicate check missed it

      mockDb.run.mockImplementationOnce(() => {
        const err: any = new Error(
          'UNIQUE constraint failed: models.provider_id, models.model_identifier',
        );
        err.code = 'SQLITE_CONSTRAINT_UNIQUE';
        throw err;
      });

      expect(() => service.createManual(providerId, validDto)).toThrow(
        ConflictException,
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when model does not exist', () => {
      mockDb.get.mockReturnValueOnce(undefined);

      expect(() => service.findOne('unknown-model-id')).toThrow(
        NotFoundException,
      );
    });

    it('returns mapped ModelDto when model exists', () => {
      const row = makeModelRow({ id: 'existing-id' });
      mockDb.get.mockReturnValueOnce(row);

      const result = service.findOne('existing-id');
      expect(result.id).toBe('existing-id');
      expect(result.modelIdentifier).toBe(row.model_identifier);
    });
  });
});
