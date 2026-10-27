import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  GatewayTimeoutException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../../database/database.service.js';
import { AdapterFactoryService } from '../../../model-adapters/adapter-factory/adapter-factory.service.js';
import { RequestAbortedError } from '../../../model-adapters/errors/index.js';
import { CredentialsService } from '../credentials/credentials.service.js';
import { type ModelRow, type RegisterModelDto } from './dto/index.js';
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
    transaction: vi.fn((fn: () => unknown) => fn()),
  };
}

describe('ModelsService', () => {
  let service: ModelsService;
  let mockDb: ReturnType<typeof makeMockDb>;
  let mockCredentialsService: {
    getDecryptedCredential: ReturnType<typeof vi.fn>;
  };
  let mockAdapterFactory: {
    isSupported: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };

  const providerId = '018f3a9e-0000-7000-8000-000000000002';

  beforeEach(async () => {
    mockDb = makeMockDb();
    mockCredentialsService = {
      getDecryptedCredential: vi.fn(),
    };
    mockAdapterFactory = {
      isSupported: vi.fn(),
      create: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModelsService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: CredentialsService, useValue: mockCredentialsService },
        { provide: AdapterFactoryService, useValue: mockAdapterFactory },
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
      expect(result.items[0].enabled).toBe(true);
      expect(result.items[0].source).toBe('manual');
    });

    it('filters by enabled status when supplied', () => {
      mockDb.get
        .mockReturnValueOnce({ id: providerId })
        .mockReturnValueOnce({ total: 0 });
      mockDb.all.mockReturnValueOnce([]);

      service.listByProvider(providerId, {
        enabled: false,
        limit: 50,
        offset: 0,
      });

      const [countSql, countParams] = mockDb.get.mock.calls[1];
      expect(countSql).toContain('enabled = ?');
      expect(countParams).toEqual([providerId, 0]);
    });

    it('filters by source when supplied', () => {
      mockDb.get
        .mockReturnValueOnce({ id: providerId })
        .mockReturnValueOnce({ total: 0 });
      mockDb.all.mockReturnValueOnce([]);

      service.listByProvider(providerId, {
        source: 'discovered',
        limit: 50,
        offset: 0,
      });

      const [countSql, countParams] = mockDb.get.mock.calls[1];
      expect(countSql).toContain('source = ?');
      expect(countParams).toEqual([providerId, 'discovered']);
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

    it('throws ConflictException when modelIdentifier already exists for this provider', () => {
      mockDb.get
        .mockReturnValueOnce({ id: providerId })
        .mockReturnValueOnce({ id: 'existing-model-id' });

      expect(() => service.createManual(providerId, validDto)).toThrow(
        ConflictException,
      );
    });

    it('inserts a new model with source forced to manual and returns the mapped model', () => {
      const persistedRow = makeModelRow({
        provider_id: providerId,
        source: 'manual',
        enabled: 1,
      });

      mockDb.get
        .mockReturnValueOnce({ id: providerId }) // assertProviderExists
        .mockReturnValueOnce(undefined) // conflict check
        .mockReturnValueOnce(persistedRow); // findOneOrFail

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
        .mockReturnValueOnce(undefined);

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

  describe('discover', () => {
    it('throws NotFoundException when provider does not exist', async () => {
      mockDb.get.mockReturnValueOnce(undefined);

      await expect(service.discover(providerId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when local provider lacks baseUrl', async () => {
      mockDb.get.mockReturnValueOnce({
        id: providerId,
        kind: 'ollama',
        base_url: null,
      });

      await expect(service.discover(providerId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when hosted provider has no credentials configured', async () => {
      mockDb.get.mockReturnValueOnce({
        id: providerId,
        kind: 'openai',
        base_url: null,
      });
      mockCredentialsService.getDecryptedCredential.mockImplementationOnce(
        () => {
          throw new NotFoundException('No credentials');
        },
      );

      await expect(service.discover(providerId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotImplementedException when provider kind is not supported', async () => {
      mockDb.get.mockReturnValueOnce({
        id: providerId,
        kind: 'ollama',
        base_url: 'http://localhost:11434',
      });
      mockCredentialsService.getDecryptedCredential.mockImplementationOnce(
        () => {
          throw new NotFoundException('No credentials');
        },
      );
      mockAdapterFactory.isSupported.mockReturnValueOnce(false);

      await expect(service.discover(providerId)).rejects.toThrow(
        NotImplementedException,
      );
    });

    it('throws NotImplementedException when adapter reports discovery not supported', async () => {
      mockDb.get.mockReturnValueOnce({
        id: providerId,
        kind: 'ollama',
        base_url: 'http://localhost:11434',
      });
      mockAdapterFactory.isSupported.mockReturnValueOnce(true);
      mockAdapterFactory.create.mockReturnValueOnce({
        capabilities: { supportsDiscovery: false },
      });

      await expect(service.discover(providerId)).rejects.toThrow(
        NotImplementedException,
      );
    });

    it('throws GatewayTimeoutException when discoverModels throws RequestAbortedError', async () => {
      mockDb.get.mockReturnValueOnce({
        id: providerId,
        kind: 'ollama',
        base_url: 'http://localhost:11434',
      });
      mockAdapterFactory.isSupported.mockReturnValueOnce(true);
      mockAdapterFactory.create.mockReturnValueOnce({
        capabilities: { supportsDiscovery: true },
        discoverModels: vi
          .fn()
          .mockRejectedValueOnce(new RequestAbortedError('Aborted')),
      });

      await expect(
        service.discover(providerId, { timeoutMs: 50 }),
      ).rejects.toThrow(GatewayTimeoutException);
    });

    it('throws BadGatewayException when adapter returns malformed data', async () => {
      mockDb.get.mockReturnValueOnce({
        id: providerId,
        kind: 'ollama',
        base_url: 'http://localhost:11434',
      });
      mockAdapterFactory.isSupported.mockReturnValueOnce(true);
      mockAdapterFactory.create.mockReturnValueOnce({
        capabilities: { supportsDiscovery: true },
        discoverModels: vi.fn().mockResolvedValueOnce('not an array' as any),
      });

      await expect(service.discover(providerId)).rejects.toThrow(
        BadGatewayException,
      );
    });

    it('throws BadGatewayException when adapter throws upstream error', async () => {
      mockDb.get.mockReturnValueOnce({
        id: providerId,
        kind: 'ollama',
        base_url: 'http://localhost:11434',
      });
      mockAdapterFactory.isSupported.mockReturnValueOnce(true);
      mockAdapterFactory.create.mockReturnValueOnce({
        capabilities: { supportsDiscovery: true },
        discoverModels: vi
          .fn()
          .mockRejectedValueOnce(new Error('Connection refused')),
      });

      await expect(service.discover(providerId)).rejects.toThrow(
        BadGatewayException,
      );
    });

    it('reconciles discovered models into empty table: inserts with source=discovered', async () => {
      mockDb.get.mockReturnValueOnce({
        id: providerId,
        kind: 'ollama',
        base_url: 'http://localhost:11434',
      });
      mockAdapterFactory.isSupported.mockReturnValueOnce(true);
      mockAdapterFactory.create.mockReturnValueOnce({
        capabilities: { supportsDiscovery: true },
        discoverModels: vi.fn().mockResolvedValueOnce([
          {
            modelIdentifier: 'qwen2.5:14b',
            displayName: 'Qwen 2.5 14B',
            contextWindow: 32768,
          },
        ]),
      });
      // Existing models query in transaction
      mockDb.all
        .mockReturnValueOnce([]) // existing
        .mockReturnValueOnce([
          makeModelRow({
            provider_id: providerId,
            model_identifier: 'qwen2.5:14b',
            display_name: 'Qwen 2.5 14B',
            source: 'discovered',
            enabled: 1,
          }),
        ]); // final select

      const result = await service.discover(providerId);

      expect(result.added).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(0);
      expect(result.disabled).toBe(0);
      expect(result.models).toHaveLength(1);
      expect(result.models[0].source).toBe('discovered');
    });

    it('preserves manual models with same identifier untouched', async () => {
      mockDb.get.mockReturnValueOnce({
        id: providerId,
        kind: 'ollama',
        base_url: 'http://localhost:11434',
      });
      mockAdapterFactory.isSupported.mockReturnValueOnce(true);
      mockAdapterFactory.create.mockReturnValueOnce({
        capabilities: { supportsDiscovery: true },
        discoverModels: vi.fn().mockResolvedValueOnce([
          {
            modelIdentifier: 'qwen2.5:14b',
            displayName: 'Upstream Name',
          },
        ]),
      });

      const manualRow = makeModelRow({
        provider_id: providerId,
        model_identifier: 'qwen2.5:14b',
        display_name: 'Manual Custom Name',
        source: 'manual',
        enabled: 1,
      });

      mockDb.all
        .mockReturnValueOnce([manualRow]) // existing rows
        .mockReturnValueOnce([manualRow]); // final rows

      const result = await service.discover(providerId);

      expect(result.added).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(1);
      expect(result.disabled).toBe(0);
      expect(mockDb.run).not.toHaveBeenCalled();
      expect(result.models[0].source).toBe('manual');
      expect(result.models[0].displayName).toBe('Manual Custom Name');
    });

    it('disables disappeared discovered models while leaving manual models untouched', async () => {
      mockDb.get.mockReturnValueOnce({
        id: providerId,
        kind: 'ollama',
        base_url: 'http://localhost:11434',
      });
      mockAdapterFactory.isSupported.mockReturnValueOnce(true);
      mockAdapterFactory.create.mockReturnValueOnce({
        capabilities: { supportsDiscovery: true },
        discoverModels: vi.fn().mockResolvedValueOnce([]), // upstream returns empty list
      });

      const discoveredRow = makeModelRow({
        id: 'discovered-1',
        provider_id: providerId,
        model_identifier: 'old-model',
        source: 'discovered',
        enabled: 1,
      });
      const manualRow = makeModelRow({
        id: 'manual-1',
        provider_id: providerId,
        model_identifier: 'my-manual',
        source: 'manual',
        enabled: 1,
      });

      mockDb.all
        .mockReturnValueOnce([discoveredRow, manualRow])
        .mockReturnValueOnce([{ ...discoveredRow, enabled: 0 }, manualRow]);

      const result = await service.discover(providerId);

      expect(result.disabled).toBe(1);
      expect(result.unchanged).toBe(1); // manual row unchanged
      expect(mockDb.run).toHaveBeenCalledTimes(1);
      const [sql, params] = mockDb.run.mock.calls[0];
      expect(sql).toContain('SET enabled = 0');
      expect(params[1]).toBe('discovered-1');
    });

    it('is idempotent: running discovery with identical data makes no updates', async () => {
      mockDb.get.mockReturnValueOnce({
        id: providerId,
        kind: 'ollama',
        base_url: 'http://localhost:11434',
      });
      mockAdapterFactory.isSupported.mockReturnValueOnce(true);
      mockAdapterFactory.create.mockReturnValueOnce({
        capabilities: { supportsDiscovery: true },
        discoverModels: vi.fn().mockResolvedValueOnce([
          {
            modelIdentifier: 'qwen2.5:14b',
            displayName: 'Qwen 2.5 14B',
            contextWindow: 32768,
            defaultTemperature: 0.7,
            defaultMaxTokens: 4096,
          },
        ]),
      });

      const existingDiscovered = makeModelRow({
        provider_id: providerId,
        model_identifier: 'qwen2.5:14b',
        display_name: 'Qwen 2.5 14B',
        source: 'discovered',
        context_window: 32768,
        default_temperature: 0.7,
        default_max_tokens: 4096,
        enabled: 1,
      });

      mockDb.all
        .mockReturnValueOnce([existingDiscovered])
        .mockReturnValueOnce([existingDiscovered]);

      const result = await service.discover(providerId);

      expect(result.added).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(1);
      expect(result.disabled).toBe(0);
      expect(mockDb.run).not.toHaveBeenCalled();
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

    it('returns mapped ModelDto with provider summary when provider is joined', () => {
      const row = makeModelRow({
        id: 'existing-id',
        provider_name: 'Anthropic',
        provider_kind: 'anthropic',
      });
      mockDb.get.mockReturnValueOnce(row);

      const result = service.findOne('existing-id');
      expect(result.id).toBe('existing-id');
      expect(result.provider).toEqual({
        id: row.provider_id,
        name: 'Anthropic',
        kind: 'anthropic',
      });
    });
  });

  describe('listAll', () => {
    it('returns a paginated list of models across providers with default pagination', () => {
      const row1 = makeModelRow({
        id: 'm1',
        provider_name: 'Anthropic',
        provider_kind: 'anthropic',
      });
      const row2 = makeModelRow({
        id: 'm2',
        provider_name: 'OpenAI',
        provider_kind: 'openai',
      });

      mockDb.get.mockReturnValueOnce({ total: 2 });
      mockDb.all.mockReturnValueOnce([row1, row2]);

      const result = service.listAll({});

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].provider?.name).toBe('Anthropic');
      expect(result.items[1].provider?.name).toBe('OpenAI');
    });

    it('applies providerId, enabled, and source filters', () => {
      mockDb.get.mockReturnValueOnce({ total: 1 });
      mockDb.all.mockReturnValueOnce([makeModelRow({ id: 'm1' })]);

      service.listAll({
        providerId: 'p1',
        enabled: true,
        source: 'manual',
      });

      const [countSql, countParams] = mockDb.get.mock.calls[0];
      expect(countSql).toContain('models.provider_id = ?');
      expect(countSql).toContain('models.enabled = ?');
      expect(countSql).toContain('models.source = ?');
      expect(countParams).toEqual(['p1', 1, 'manual']);

      const [dataSql, dataParams] = mockDb.all.mock.calls[0];
      expect(dataSql).toContain('LEFT JOIN providers');
      expect(dataSql).toContain('models.provider_id = ?');
      expect(dataParams).toEqual(['p1', 1, 'manual', 50, 0]);
    });
  });

  describe('update', () => {
    it('throws BadRequestException when providerId is supplied', () => {
      expect(() =>
        service.update('m1', { providerId: 'p2' } as any),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException when modelIdentifier is supplied', () => {
      expect(() =>
        service.update('m1', { modelIdentifier: 'gpt-4' } as any),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException when source is supplied', () => {
      expect(() =>
        service.update('m1', { source: 'discovered' } as any),
      ).toThrow(BadRequestException);
    });

    it('throws NotFoundException when model does not exist', () => {
      mockDb.get.mockReturnValueOnce(undefined);

      expect(() =>
        service.update('non-existent', { displayName: 'New Name' }),
      ).toThrow(NotFoundException);
    });

    it('updates mutable fields and advances updated_at', () => {
      const existing = makeModelRow({ id: 'm1', display_name: 'Old Name' });
      const updatedRow = makeModelRow({
        id: 'm1',
        display_name: 'New Name',
        context_window: 128000,
        default_temperature: 0.2,
        default_max_tokens: 2048,
        enabled: 0,
      });

      mockDb.get
        .mockReturnValueOnce(existing) // existing check
        .mockReturnValueOnce(updatedRow); // findOneOrFail return

      const result = service.update('m1', {
        displayName: 'New Name',
        contextWindow: 128000,
        defaultTemperature: 0.2,
        defaultMaxTokens: 2048,
        enabled: false,
      });

      expect(mockDb.run).toHaveBeenCalledTimes(1);
      const [updateSql, updateParams] = mockDb.run.mock.calls[0];
      expect(updateSql).toContain('UPDATE models SET');
      expect(updateSql).toContain('display_name = ?');
      expect(updateSql).toContain('context_window = ?');
      expect(updateSql).toContain('default_temperature = ?');
      expect(updateSql).toContain('default_max_tokens = ?');
      expect(updateSql).toContain('enabled = ?');
      expect(updateSql).toContain('updated_at = ?');
      expect(updateParams).toContain('New Name');
      expect(updateParams).toContain(128000);
      expect(updateParams).toContain(0.2);
      expect(updateParams).toContain(2048);
      expect(updateParams).toContain(0); // toDbBoolean(false)
      expect(updateParams).toContain('m1');

      expect(result.displayName).toBe('New Name');
      expect(result.enabled).toBe(false);
    });

    it('clears nullable fields when set to null', () => {
      const existing = makeModelRow({ id: 'm1' });
      mockDb.get
        .mockReturnValueOnce(existing)
        .mockReturnValueOnce(existing);

      service.update('m1', {
        contextWindow: null,
        defaultTemperature: null,
        defaultMaxTokens: null,
      });

      expect(mockDb.run).toHaveBeenCalledTimes(1);
      const [updateSql, updateParams] = mockDb.run.mock.calls[0];
      expect(updateSql).toContain('context_window = ?');
      expect(updateSql).toContain('default_temperature = ?');
      expect(updateSql).toContain('default_max_tokens = ?');
      expect(updateParams).toContain(null);
    });

    it('does not execute UPDATE query when body is empty ({})', () => {
      const existing = makeModelRow({ id: 'm1' });
      mockDb.get
        .mockReturnValueOnce(existing)
        .mockReturnValueOnce(existing);

      service.update('m1', {});

      expect(mockDb.run).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('throws NotFoundException when model does not exist', () => {
      mockDb.get.mockReturnValueOnce(undefined);

      expect(() => service.delete('unknown-id')).toThrow(NotFoundException);
      expect(mockDb.run).not.toHaveBeenCalled();
    });

    it('deletes model and warns if dependent agents exist', () => {
      const existing = makeModelRow({ id: 'm1', display_name: 'Claude' });
      mockDb.get
        .mockReturnValueOnce(existing) // existing check
        .mockReturnValueOnce({ count: 3 }); // dependent agents check
      mockDb.run.mockReturnValueOnce({ changes: 1, lastInsertRowid: 1 });

      service.delete('m1');

      expect(mockDb.run).toHaveBeenCalledWith(
        'DELETE FROM models WHERE id = ?',
        ['m1'],
      );
    });

    it('throws NotFoundException if delete changes 0 rows', () => {
      const existing = makeModelRow({ id: 'm1' });
      mockDb.get
        .mockReturnValueOnce(existing)
        .mockReturnValueOnce({ count: 0 });
      mockDb.run.mockReturnValueOnce({ changes: 0, lastInsertRowid: 0 });

      expect(() => service.delete('m1')).toThrow(NotFoundException);
    });
  });
});
