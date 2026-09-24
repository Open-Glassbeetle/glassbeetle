import type { DatabaseService } from '../../src/database/database.service.js';

/**
 * Resets all application tables in the SQLite database to a clean, empty state,
 * preserving schema_migrations and re-seeding default system data.
 */
export function resetDatabase(databaseService: DatabaseService): void {
  const db = databaseService.db;

  // Temporarily disable foreign keys so tables can be cleared in any order
  db.pragma('foreign_keys = OFF');

  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'`,
    )
    .all() as { name: string }[];

  for (const { name } of tables) {
    db.prepare(`DELETE FROM ${name}`).run();
  }

  db.pragma('foreign_keys = ON');

  // Re-seed default backup_policy (as created during initial migration)
  db.prepare(
    `INSERT OR REPLACE INTO backup_policy (id, enabled, frequency, retention_count, target_directory, updated_at)
     VALUES (1, 0, 'daily', 7, NULL, ?)`,
  ).run(new Date().toISOString());
}
