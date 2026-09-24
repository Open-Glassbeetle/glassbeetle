import { Test, TestingModule } from '@nestjs/testing';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppConfigService } from '../config/app-config.service.js';
import { DatabaseService } from './database.service.js';

describe('DatabaseService', () => {
  let service: DatabaseService;
  let tempDir: string;

  beforeEach(() => {
    service = new DatabaseService();
    service.connect(':memory:');
  });

  afterEach(() => {
    service.close();
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('enforces foreign key constraints', () => {
    expect(() => {
      service.run(
        `INSERT INTO models (id, provider_id, model_identifier, display_name, source, created_at, updated_at)
         VALUES ('mod_1', 'non_existent_provider', 'model-x', 'Model X', 'manual', '2026-01-01', '2026-01-01')`,
      );
    }).toThrow(/FOREIGN KEY/i);
  });

  it('creates all tables and indexes on initial bootstrap', () => {
    const tables = service
      .all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .map((r) => r.name);

    expect(tables).toEqual(
      expect.arrayContaining([
        'system_prompts',
        'providers',
        'models',
        'provider_credentials',
        'agents',
        'agent_memories',
        'teams',
        'team_members',
        'projects',
        'chats',
        'messages',
        'shared_memories',
        'artifacts',
        'usage_events',
        'backups',
        'backup_policy',
        'schema_migrations',
      ]),
    );

    const indexes = service
      .all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'",
      )
      .map((r) => r.name);

    expect(indexes).toEqual(
      expect.arrayContaining([
        'idx_models_provider_id',
        'idx_agents_system_prompt_id',
        'idx_agents_model_id',
        'idx_agent_memories_agent_id',
        'idx_team_members_agent_id',
        'idx_chats_project_id',
        'idx_chats_agent_id',
        'idx_chats_team_id',
        'idx_messages_chat_id_sequence',
        'idx_artifacts_project_id',
        'idx_artifacts_chat_id',
        'idx_artifacts_agent_id',
        'idx_usage_events_occurred_at',
        'idx_usage_events_agent_id',
        'idx_usage_events_provider_id',
        'idx_usage_events_model_id',
      ]),
    );
  });

  it('does not re-apply schema or error on a second bootstrap', () => {
    expect(() => {
      service.connect(':memory:');
    }).not.toThrow();

    const count = service.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM backup_policy',
    );
    expect(count?.cnt).toBe(1);
  });

  it('records applied schema migration version in schema_migrations table', () => {
    const migrations = service.all<{ name: string }>(
      'SELECT name FROM schema_migrations',
    );
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations[0].name).toBe('001_initial_bootstrap');
  });

  it('seeds backup_policy with exactly one row after bootstrap', () => {
    const rows = service.all<{ id: number; enabled: number; frequency: string }>(
      'SELECT * FROM backup_policy',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 1,
      enabled: 0,
      frequency: 'daily',
    });
  });

  it('rolls back transaction on error', () => {
    service.run(
      `INSERT INTO system_prompts (id, name, content, created_at, updated_at)
       VALUES ('sp_1', 'Prompt 1', 'Content 1', '2026-01-01', '2026-01-01')`,
    );

    expect(() => {
      service.transaction(() => {
        service.run(
          `INSERT INTO system_prompts (id, name, content, created_at, updated_at)
           VALUES ('sp_2', 'Prompt 2', 'Content 2', '2026-01-01', '2026-01-01')`,
        );
        throw new Error('Transaction abort!');
      });
    }).toThrow('Transaction abort!');

    const sp2 = service.get('SELECT * FROM system_prompts WHERE id = ?', [
      'sp_2',
    ]);
    expect(sp2).toBeUndefined();
  });

  it('round-trips binary BLOB values (provider_credentials)', () => {
    service.run(
      `INSERT INTO providers (id, name, kind, is_local, enabled, created_at, updated_at)
       VALUES ('prov_1', 'OpenAI', 'openai', 0, 1, '2026-01-01', '2026-01-01')`,
    );

    const secretKey = Buffer.from('my-super-secret-key-12345');
    const nonce = Buffer.from('random-nonce-123');

    service.run(
      `INSERT INTO provider_credentials (provider_id, encrypted_value, nonce, masked_preview, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['prov_1', secretKey, nonce, 'sk-...1234', '2026-01-01', '2026-01-01'],
    );

    const cred = service.get<{
      provider_id: string;
      encrypted_value: Buffer;
      nonce: Buffer;
      masked_preview: string;
    }>('SELECT * FROM provider_credentials WHERE provider_id = ?', ['prov_1']);

    expect(cred).toBeDefined();
    expect(Buffer.isBuffer(cred!.encrypted_value)).toBe(true);
    expect(cred!.encrypted_value.toString()).toBe('my-super-secret-key-12345');
    expect(cred!.nonce.toString()).toBe('random-nonce-123');
  });

  it('automatically creates database file and directories when given a file path', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'gb-db-test-'));
    const dbPath = join(tempDir, 'sub', 'test-glassbeetle.db');

    const fileService = new DatabaseService();
    try {
      fileService.connect(dbPath);

      expect(existsSync(dbPath)).toBe(true);
      const tables = fileService.all(
        "SELECT name FROM sqlite_master WHERE type='table'",
      );
      expect(tables.length).toBeGreaterThan(0);
    } finally {
      fileService.close();
    }
  });

  it('hooks into NestJS OnModuleInit and OnModuleDestroy via AppConfigService', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'gb-module-test-'));
    const dbPath = join(tempDir, 'nest-test.db');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseService,
        {
          provide: AppConfigService,
          useValue: { databasePath: dbPath },
        },
      ],
    }).compile();

    const nestService = moduleFixture.get<DatabaseService>(DatabaseService);
    await moduleFixture.init();

    expect(existsSync(dbPath)).toBe(true);
    const result = nestService.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM backup_policy',
    );
    expect(result?.cnt).toBe(1);

    await moduleFixture.close();
  });
});
