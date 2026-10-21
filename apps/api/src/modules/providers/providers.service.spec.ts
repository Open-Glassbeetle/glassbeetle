import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProvidersService } from './providers.service.js';
import { DatabaseService } from '../../database/database.service.js';
import type { CreateProviderDto, ProviderRow, UpdateProviderDto } from './dto/provider.dto.js';

// Helpers
function makeRow(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: 'test-id',
    name: 'Test Provider',
    kind: 'anthropic',
    is_local: 0,
    base_url: null,
    enabled: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeMockDb(overrides: Partial<typeof mockDb> = {}) {
  return {
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
    run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
    ...overrides,
  };
}

let mockDb: ReturnType<typeof makeMockDb>;
let service: ProvidersService;

// Setup
beforeEach(async () => {
  mockDb = makeMockDb();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ProvidersService,
      { provide: DatabaseService, useValue: mockDb },
    ],
  }).compile();

  service = module.get<ProvidersService>(ProvidersService);
});

// findAll
describe('ProvidersService.findAll', () => {
  it('returns an empty paginated response when there are no providers', () => {
    mockDb.get.mockReturnValue({ total: 0 });
    mockDb.all.mockReturnValue([]);

    const result = service.findAll({ limit: 50, offset: 0 });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('maps rows to DTO shape with boolean conversion', () => {
    const row = makeRow({ is_local: 1, enabled: 0 });
    mockDb.get.mockReturnValue({ total: 1 });
    mockDb.all.mockReturnValue([row]);

    const result = service.findAll({ limit: 50, offset: 0 });

    expect(result.items[0]).toMatchObject({
      id: 'test-id',
      isLocal: true,
      enabled: false,
    });
  });

  it('filters by kind', () => {
    mockDb.get.mockReturnValue({ total: 0 });
    mockDb.all.mockReturnValue([]);

    service.findAll({ limit: 50, offset: 0, kind: 'openai' });

    const countCall = mockDb.get.mock.calls[0];
    expect(countCall[0]).toContain('kind = ?');
    expect(countCall[1]).toContain('openai');
  });

  it('filters by enabled (true)', () => {
    mockDb.get.mockReturnValue({ total: 0 });
    mockDb.all.mockReturnValue([]);

    service.findAll({ limit: 50, offset: 0, enabled: true });

    const countCall = mockDb.get.mock.calls[0];
    expect(countCall[0]).toContain('enabled = ?');
    expect(countCall[1]).toContain(1); // toDbBoolean(true)
  });

  it('filters by enabled (false)', () => {
    mockDb.get.mockReturnValue({ total: 0 });
    mockDb.all.mockReturnValue([]);

    service.findAll({ limit: 50, offset: 0, enabled: false });

    const countCall = mockDb.get.mock.calls[0];
    expect(countCall[1]).toContain(0); // toDbBoolean(false)
  });

  it('filters by isLocal', () => {
    mockDb.get.mockReturnValue({ total: 0 });
    mockDb.all.mockReturnValue([]);

    service.findAll({ limit: 50, offset: 0, isLocal: true });

    const countCall = mockDb.get.mock.calls[0];
    expect(countCall[0]).toContain('is_local = ?');
  });

  it('combines multiple filters', () => {
    mockDb.get.mockReturnValue({ total: 0 });
    mockDb.all.mockReturnValue([]);

    service.findAll({ limit: 50, offset: 0, kind: 'ollama', enabled: true, isLocal: true });

    const countCall = mockDb.get.mock.calls[0];
    expect(countCall[0]).toContain('kind = ?');
    expect(countCall[0]).toContain('enabled = ?');
    expect(countCall[0]).toContain('is_local = ?');
  });

  it('respects limit and offset', () => {
    mockDb.get.mockReturnValue({ total: 5 });
    mockDb.all.mockReturnValue([]);

    const result = service.findAll({ limit: 10, offset: 5 });

    expect(result.limit).toBe(10);
    expect(result.offset).toBe(5);
  });
});

// create
describe('ProvidersService.create', () => {
  it('creates an anthropic provider without baseUrl', () => {
    const row = makeRow({ kind: 'anthropic' });
    mockDb.get.mockReturnValue(row);

    const dto: CreateProviderDto = { name: 'My Anthropic', kind: 'anthropic' };
    const result = service.create(dto);

    expect(result.kind).toBe('anthropic');
    expect(mockDb.run).toHaveBeenCalledOnce();
  });

  it('creates an openai provider with an optional baseUrl override', () => {
    const row = makeRow({ kind: 'openai', base_url: 'https://api.openai.com' });
    mockDb.get.mockReturnValue(row);

    const dto: CreateProviderDto = { name: 'My OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com' };
    const result = service.create(dto);

    expect(result.baseUrl).toBe('https://api.openai.com');
  });

  it('throws 400 when kind=ollama and baseUrl is missing', () => {
    const dto: CreateProviderDto = { name: 'Local Ollama', kind: 'ollama' };
    expect(() => service.create(dto)).toThrow(BadRequestException);
  });

  it('throws 400 when kind=lmstudio and baseUrl is missing', () => {
    const dto: CreateProviderDto = { name: 'LM Studio', kind: 'lmstudio' };
    expect(() => service.create(dto)).toThrow(BadRequestException);
  });

  it('throws 400 when kind=openai_compatible and baseUrl is missing', () => {
    const dto: CreateProviderDto = { name: 'Custom', kind: 'openai_compatible' };
    expect(() => service.create(dto)).toThrow(BadRequestException);
  });

  it('creates an ollama provider when baseUrl is supplied', () => {
    const row = makeRow({ kind: 'ollama', is_local: 1, base_url: 'http://localhost:11434' });
    mockDb.get.mockReturnValue(row);

    const dto: CreateProviderDto = { name: 'Ollama', kind: 'ollama', baseUrl: 'http://localhost:11434' };
    const result = service.create(dto);

    expect(result.isLocal).toBe(true);
    expect(result.baseUrl).toBe('http://localhost:11434');
  });

  it('derives isLocal=true for ollama regardless of client value', () => {
    const row = makeRow({ kind: 'ollama', is_local: 1, base_url: 'http://localhost:11434' });
    mockDb.get.mockReturnValue(row);

    const dto: CreateProviderDto = {
      name: 'Ollama',
      kind: 'ollama',
      baseUrl: 'http://localhost:11434',
      isLocal: false, // should be overridden
    };
    service.create(dto);

    const insertCall = mockDb.run.mock.calls[0];
    const params = insertCall[1] as unknown[];
    // is_local is at index 3 in the INSERT params
    expect(params[3]).toBe(1); // forced to true
  });

  it('derives isLocal=true for lmstudio regardless of client value', () => {
    const row = makeRow({ kind: 'lmstudio', is_local: 1, base_url: 'http://localhost:1234' });
    mockDb.get.mockReturnValue(row);

    const dto: CreateProviderDto = {
      name: 'LM Studio',
      kind: 'lmstudio',
      baseUrl: 'http://localhost:1234',
      isLocal: false,
    };
    service.create(dto);

    const insertCall = mockDb.run.mock.calls[0];
    const params = insertCall[1] as unknown[];
    expect(params[3]).toBe(1);
  });

  it('respects client isLocal for openai_compatible', () => {
    const row = makeRow({ kind: 'openai_compatible', is_local: 1, base_url: 'http://my-host/v1' });
    mockDb.get.mockReturnValue(row);

    const dto: CreateProviderDto = {
      name: 'Custom',
      kind: 'openai_compatible',
      baseUrl: 'http://my-host/v1',
      isLocal: true,
    };
    service.create(dto);

    const insertCall = mockDb.run.mock.calls[0];
    const params = insertCall[1] as unknown[];
    expect(params[3]).toBe(1);
  });

  it('defaults enabled to true', () => {
    const row = makeRow({ enabled: 1 });
    mockDb.get.mockReturnValue(row);

    const dto: CreateProviderDto = { name: 'Test', kind: 'anthropic' };
    service.create(dto);

    const insertCall = mockDb.run.mock.calls[0];
    const params = insertCall[1] as unknown[];
    // enabled is at index 5
    expect(params[5]).toBe(1);
  });

  it('can create with enabled=false', () => {
    const row = makeRow({ enabled: 0 });
    mockDb.get.mockReturnValue(row);

    const dto: CreateProviderDto = { name: 'Test', kind: 'anthropic', enabled: false };
    service.create(dto);

    const insertCall = mockDb.run.mock.calls[0];
    const params = insertCall[1] as unknown[];
    expect(params[5]).toBe(0);
  });

  it('inserts with bound parameters', () => {
    mockDb.get.mockReturnValue(makeRow());
    service.create({ name: 'Test', kind: 'anthropic' });

    expect(mockDb.run).toHaveBeenCalledOnce();
    const [sql, params] = mockDb.run.mock.calls[0];
    expect(sql).toContain('?');
    expect(Array.isArray(params)).toBe(true);
  });
});

// findOne
describe('ProvidersService.findOne', () => {
  it('returns the provider when it exists', () => {
    const row = makeRow({ id: 'abc-123' });
    mockDb.get.mockReturnValue(row);

    const result = service.findOne('abc-123');

    expect(result.id).toBe('abc-123');
  });

  it('throws NotFoundException when the id does not exist', () => {
    mockDb.get.mockReturnValue(undefined);

    expect(() => service.findOne('ghost')).toThrow(NotFoundException);
  });
});

// update
describe('ProvidersService.update', () => {
  it('updates only the supplied fields', () => {
    const existing = makeRow({ name: 'Old Name', kind: 'openai', enabled: 1 });
    // first call: find existing; second call: re-read after update
    mockDb.get.mockReturnValueOnce(existing).mockReturnValueOnce({ ...existing, name: 'New Name' });

    const dto: UpdateProviderDto = { name: 'New Name' };
    const result = service.update('test-id', dto);

    const updateCall = mockDb.run.mock.calls[0];
    const params = updateCall[1] as unknown[];
    expect(params[0]).toBe('New Name'); // name unchanged to new
    expect(result.name).toBe('New Name');
  });

  it('throws NotFoundException when the id does not exist', () => {
    mockDb.get.mockReturnValue(undefined);

    expect(() => service.update('ghost', { name: 'X' })).toThrow(NotFoundException);
  });

  it('throws BadRequestException when switching to ollama without baseUrl', () => {
    const existing = makeRow({ kind: 'anthropic', base_url: null });
    mockDb.get.mockReturnValue(existing);

    const dto: UpdateProviderDto = { kind: 'ollama' };
    expect(() => service.update('test-id', dto)).toThrow(BadRequestException);
  });

  it('allows clearing baseUrl when switching to a managed remote kind', () => {
    const existing = makeRow({ kind: 'openai', base_url: 'https://proxy.example.com' });
    const updated = { ...existing, base_url: null, updated_at: '2026-06-01T00:00:00.000Z' };
    mockDb.get.mockReturnValueOnce(existing).mockReturnValueOnce(updated);

    const dto: UpdateProviderDto = { baseUrl: null };
    const result = service.update('test-id', dto);

    expect(result.baseUrl).toBeNull();
  });

  it('forces isLocal=true when updating kind to ollama', () => {
    const existing = makeRow({ kind: 'anthropic', is_local: 0, base_url: null });
    const afterUpdate = makeRow({ kind: 'ollama', is_local: 1, base_url: 'http://localhost:11434' });
    mockDb.get.mockReturnValueOnce(existing).mockReturnValueOnce(afterUpdate);

    service.update('test-id', { kind: 'ollama', baseUrl: 'http://localhost:11434' });

    const updateCall = mockDb.run.mock.calls[0];
    const params = updateCall[1] as unknown[];
    // is_local param is index 2
    expect(params[2]).toBe(1);
  });

  it('uses bound parameters in UPDATE', () => {
    const existing = makeRow();
    mockDb.get.mockReturnValue(existing);

    service.update('test-id', { name: 'Updated' });

    const [sql, params] = mockDb.run.mock.calls[0];
    expect(sql).toContain('?');
    expect(Array.isArray(params)).toBe(true);
  });
});

// remove
describe('ProvidersService.remove', () => {
  it('deletes an existing provider', () => {
    const row = makeRow();
    mockDb.get.mockReturnValue(row);

    expect(() => service.remove('test-id')).not.toThrow();
    expect(mockDb.run).toHaveBeenCalledWith('DELETE FROM providers WHERE id = ?', ['test-id']);
  });

  it('throws NotFoundException when the id does not exist', () => {
    mockDb.get.mockReturnValue(undefined);

    expect(() => service.remove('ghost')).toThrow(NotFoundException);
  });
});

// Boolean round-trip
describe('Boolean round-tripping', () => {
  it('maps is_local=0 from DB to isLocal=false in DTO', () => {
    mockDb.get.mockReturnValue(makeRow({ is_local: 0 }));
    const result = service.findOne('test-id');
    expect(result.isLocal).toBe(false);
  });

  it('maps is_local=1 from DB to isLocal=true in DTO', () => {
    mockDb.get.mockReturnValue(makeRow({ is_local: 1 }));
    const result = service.findOne('test-id');
    expect(result.isLocal).toBe(true);
  });

  it('maps enabled=0 from DB to enabled=false in DTO', () => {
    mockDb.get.mockReturnValue(makeRow({ enabled: 0 }));
    const result = service.findOne('test-id');
    expect(result.enabled).toBe(false);
  });

  it('maps enabled=1 from DB to enabled=true in DTO', () => {
    mockDb.get.mockReturnValue(makeRow({ enabled: 1 }));
    const result = service.findOne('test-id');
    expect(result.enabled).toBe(true);
  });

  it('stores true as 1 in DB', () => {
    mockDb.get.mockReturnValue(makeRow({ enabled: 1 }));
    service.create({ name: 'Test', kind: 'anthropic', enabled: true });
    const params = mockDb.run.mock.calls[0][1] as unknown[];
    expect(params[5]).toBe(1); // enabled at index 5
  });

  it('stores false as 0 in DB', () => {
    mockDb.get.mockReturnValue(makeRow({ enabled: 0 }));
    service.create({ name: 'Test', kind: 'anthropic', enabled: false });
    const params = mockDb.run.mock.calls[0][1] as unknown[];
    expect(params[5]).toBe(0);
  });
});
