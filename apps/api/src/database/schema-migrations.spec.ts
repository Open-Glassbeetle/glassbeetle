import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  INITIAL_MIGRATION_NAME,
  MIGRATIONS_AFTER_BOOTSTRAP,
  runMigrations,
} from './schema-migrations.js';

describe('runMigrations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  function appliedMigrations(): string[] {
    return db
      .prepare('SELECT name FROM schema_migrations ORDER BY id')
      .all()
      .map((row) => (row as { name: string }).name);
  }

  function tableExists(name: string): boolean {
    return (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        )
        .get(name) !== undefined
    );
  }

  it('records the bootstrap and every incremental migration on an empty database', () => {
    runMigrations(db);

    expect(appliedMigrations()).toEqual([
      INITIAL_MIGRATION_NAME,
      ...MIGRATIONS_AFTER_BOOTSTRAP.map((migration) => migration.name),
    ]);
  });

  it('is idempotent: a second run applies and records nothing new', () => {
    runMigrations(db);
    const first = appliedMigrations();

    runMigrations(db);

    expect(appliedMigrations()).toEqual(first);
  });

  it('creates user_profile on a fresh database', () => {
    runMigrations(db);

    expect(tableExists('user_profile')).toBe(true);
  });

  it('upgrades a database that already recorded only the bootstrap', () => {
    // What every installation that exists today looks like: the bootstrap ran
    // before `user_profile` was part of the sequence, so appending the file
    // reaches this database through the incremental migration or not at all.
    db.exec(`
      CREATE TABLE schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      );
    `);
    db.prepare(
      'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
    ).run(INITIAL_MIGRATION_NAME, '2026-01-01T00:00:00.000Z');

    runMigrations(db);

    expect(tableExists('user_profile')).toBe(true);
    expect(appliedMigrations()).toEqual([
      INITIAL_MIGRATION_NAME,
      '002_user_profile',
    ]);
  });

  it('leaves an already-applied incremental migration alone', () => {
    runMigrations(db);

    db.prepare(
      `INSERT INTO user_profile (id, singleton, created_at, updated_at)
       VALUES (?, 1, ?, ?)`,
    ).run('018f3a9e-0000-7000-8000-000000000001', '2026-01-01', '2026-01-01');

    runMigrations(db);

    const count = db
      .prepare('SELECT COUNT(*) AS cnt FROM user_profile')
      .get() as { cnt: number };
    expect(count.cnt).toBe(1);
  });
});

describe('user_profile schema', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  function insert(id: string, singleton = 1): void {
    db.prepare(
      `INSERT INTO user_profile (id, singleton, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run(id, singleton, '2026-01-01', '2026-01-01');
  }

  it('accepts the first row', () => {
    expect(() => insert('018f3a9e-0000-7000-8000-000000000001')).not.toThrow();
  });

  it('refuses a second row, so the single-user property is enforced by the database', () => {
    insert('018f3a9e-0000-7000-8000-000000000001');

    expect(() => insert('018f3a9e-0000-7000-8000-000000000002')).toThrow(
      /UNIQUE/i,
    );
  });

  it('refuses a singleton value other than 1, which is what makes the UNIQUE index a limit of one', () => {
    expect(() => insert('018f3a9e-0000-7000-8000-000000000001', 2)).toThrow(
      /CHECK/i,
    );
  });

  it('defaults include_in_prompts to enabled', () => {
    insert('018f3a9e-0000-7000-8000-000000000001');

    const row = db
      .prepare('SELECT include_in_prompts FROM user_profile')
      .get() as { include_in_prompts: number };
    expect(row.include_in_prompts).toBe(1);
  });
});
