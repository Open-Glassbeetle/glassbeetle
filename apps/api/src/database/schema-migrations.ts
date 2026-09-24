import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';

/**
 * Ordered list of SQL files relative to the `data/` directory.
 *
 * Foreign-key ordering:
 * 1. system_prompts
 * 2. providers
 * 3. models (references providers)
 * 4. provider_credentials (references providers)
 * 5. agents (references system_prompts, models)
 * 6. agent_memories (references agents)
 * 7. teams
 * 8. team_members (references teams, agents)
 * 9. projects
 * 10. chats (references projects, agents, teams)
 * 11. messages (references chats, agents)
 * 12. shared_memories
 * 13. artifacts (references projects, chats, agents)
 * 14. usage_events (references agents, providers, models, chats)
 * 15. backups
 * 16. backup_policy
 * 17. seed (seeds backup_policy)
 * 18-23. index files for each area
 */
export const MIGRATION_FILE_SEQUENCE = [
  'system/gloabal.sql',
  'system/system_propmts.sql',
  'providers/providers.sql',
  'providers/models.sql',
  'providers/provider_credentials.sql',
  'agents/agents.sql',
  'agents/agents_memories.sql',
  'teams/teams.sql',
  'teams/team_members.sql',
  'projects/projects.sql',
  'chats/chats.sql',
  'chats/messages.sql',
  'memory/shared_memories.sql',
  'artifacts/artifacts.sql',
  'analytics/usage_events.sql',
  'backups/backups.sql',
  'backups/backup_policy.sql',
  'backups/seed.sql',
  'providers/index.sql',
  'agents/index.sql',
  'teams/index.sql',
  'chats/index.sql',
  'artifacts/index.sql',
  'analytics/index.sql',
];

const FALLBACK_SQL: Record<string, string> = {
  'system/gloabal.sql': `PRAGMA foreign_keys = ON;`,
  'system/system_propmts.sql': `CREATE TABLE system_prompts (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);`,
  'providers/providers.sql': `CREATE TABLE providers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN (
                    'anthropic', 'openai', 'google',
                    'ollama', 'lmstudio', 'openai_compatible'
                )),
    is_local    INTEGER NOT NULL DEFAULT 0,
    base_url    TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);`,
  'providers/models.sql': `CREATE TABLE models (
    id                     TEXT PRIMARY KEY,
    provider_id            TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    model_identifier        TEXT NOT NULL,
    display_name           TEXT NOT NULL,
    source                 TEXT NOT NULL CHECK (source IN ('discovered', 'manual')),
    context_window         INTEGER,
    default_temperature    REAL,
    default_max_tokens     INTEGER,
    enabled                INTEGER NOT NULL DEFAULT 1,
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL,
    UNIQUE (provider_id, model_identifier)
);`,
  'providers/provider_credentials.sql': `CREATE TABLE provider_credentials (
    provider_id      TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
    encrypted_value  BLOB NOT NULL,
    nonce            BLOB NOT NULL,
    masked_preview   TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);`,
  'agents/agents.sql': `CREATE TABLE agents (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    personality        TEXT,
    instructions       TEXT,
    system_prompt_id   TEXT REFERENCES system_prompts(id) ON DELETE SET NULL,
    model_id           TEXT REFERENCES models(id) ON DELETE SET NULL,
    temperature        REAL,
    max_tokens         INTEGER,
    model_params       TEXT,
    picture_path       TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);`,
  'agents/agents_memories.sql': `CREATE TABLE agent_memories (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    tags        TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);`,
  'teams/teams.sql': `CREATE TABLE teams (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);`,
  'teams/team_members.sql': `CREATE TABLE team_members (
    team_id      TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    agent_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    role         TEXT,
    position     INTEGER,
    created_at   TEXT NOT NULL,
    PRIMARY KEY (team_id, agent_id)
);`,
  'projects/projects.sql': `CREATE TABLE projects (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT,
    image_path   TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);`,
  'chats/chats.sql': `CREATE TABLE chats (
    id               TEXT PRIMARY KEY,
    title            TEXT,
    project_id       TEXT REFERENCES projects(id) ON DELETE SET NULL,
    agent_id         TEXT REFERENCES agents(id) ON DELETE SET NULL,
    team_id          TEXT REFERENCES teams(id) ON DELETE SET NULL,
    context_summary  TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    CHECK (
        (agent_id IS NOT NULL AND team_id IS NULL)
        OR (agent_id IS NULL AND team_id IS NOT NULL)
    )
);`,
  'chats/messages.sql': `CREATE TABLE messages (
    id           TEXT PRIMARY KEY,
    chat_id      TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sequence     INTEGER NOT NULL,
    role         TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    agent_id     TEXT REFERENCES agents(id) ON DELETE SET NULL,
    content      TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'complete' CHECK (status IN (
                    'pending', 'streaming', 'complete', 'error'
                 )),
    token_count  INTEGER,
    created_at   TEXT NOT NULL,
    UNIQUE (chat_id, sequence)
);`,
  'memory/shared_memories.sql': `CREATE TABLE shared_memories (
    id          TEXT PRIMARY KEY,
    content     TEXT NOT NULL,
    tags        TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);`,
  'artifacts/artifacts.sql': `CREATE TABLE artifacts (
    id           TEXT PRIMARY KEY,
    project_id   TEXT REFERENCES projects(id) ON DELETE SET NULL,
    chat_id      TEXT REFERENCES chats(id) ON DELETE SET NULL,
    agent_id     TEXT REFERENCES agents(id) ON DELETE SET NULL,
    title        TEXT NOT NULL,
    type         TEXT NOT NULL,
    mime_type    TEXT,
    content      TEXT,
    file_path    TEXT,
    version      INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);`,
  'analytics/usage_events.sql': `CREATE TABLE usage_events (
    id            TEXT PRIMARY KEY,
    occurred_at   TEXT NOT NULL,
    event_type    TEXT NOT NULL,
    agent_id      TEXT REFERENCES agents(id) ON DELETE SET NULL,
    provider_id   TEXT REFERENCES providers(id) ON DELETE SET NULL,
    model_id      TEXT REFERENCES models(id) ON DELETE SET NULL,
    chat_id       TEXT REFERENCES chats(id) ON DELETE SET NULL,
    input_tokens  INTEGER,
    output_tokens INTEGER,
    cost_usd      REAL,
    metadata      TEXT
);`,
  'backups/backups.sql': `CREATE TABLE backups (
    id           TEXT PRIMARY KEY,
    file_path    TEXT NOT NULL,
    size_bytes   INTEGER NOT NULL,
    trigger      TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
    created_at   TEXT NOT NULL
);`,
  'backups/backup_policy.sql': `CREATE TABLE backup_policy (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    enabled           INTEGER NOT NULL DEFAULT 0,
    frequency         TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('hourly', 'daily', 'weekly')),
    retention_count   INTEGER NOT NULL DEFAULT 7,
    target_directory  TEXT,
    updated_at        TEXT NOT NULL
);`,
  'backups/seed.sql': `INSERT INTO backup_policy (id, enabled, frequency, retention_count, target_directory, updated_at)
VALUES (1, 0, 'daily', 7, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));`,
  'providers/index.sql': `CREATE INDEX idx_models_provider_id ON models(provider_id);`,
  'agents/index.sql': `CREATE INDEX idx_agents_system_prompt_id ON agents(system_prompt_id);
CREATE INDEX idx_agents_model_id ON agents(model_id);
CREATE INDEX idx_agent_memories_agent_id ON agent_memories(agent_id);`,
  'teams/index.sql': `CREATE INDEX idx_team_members_agent_id ON team_members(agent_id);`,
  'chats/index.sql': `CREATE INDEX idx_chats_project_id ON chats(project_id);
CREATE INDEX idx_chats_agent_id ON chats(agent_id);
CREATE INDEX idx_chats_team_id ON chats(team_id);
CREATE INDEX idx_messages_chat_id_sequence ON messages(chat_id, sequence);`,
  'artifacts/index.sql': `CREATE INDEX idx_artifacts_project_id ON artifacts(project_id);
CREATE INDEX idx_artifacts_chat_id ON artifacts(chat_id);
CREATE INDEX idx_artifacts_agent_id ON artifacts(agent_id);`,
  'analytics/index.sql': `CREATE INDEX idx_usage_events_occurred_at ON usage_events(occurred_at);
CREATE INDEX idx_usage_events_agent_id ON usage_events(agent_id);
CREATE INDEX idx_usage_events_provider_id ON usage_events(provider_id);
CREATE INDEX idx_usage_events_model_id ON usage_events(model_id);`,
};

/**
 * Resolves the location of the `data/` directory on disk.
 */
export function findDataDir(): string | null {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), 'data'),
    resolve(process.cwd(), '../data'),
    resolve(process.cwd(), '../../data'),
    resolve(currentDir, '../../../data'),
    resolve(currentDir, '../../data'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && existsSync(join(candidate, 'system', 'system_propmts.sql'))) {
      return candidate;
    }
  }
  return null;
}

/**
 * Loads SQL content for a relative path from the data directory if available,
 * otherwise falling back to the bundled DDL content.
 */
export function loadSqlContent(relativePath: string, dataDir: string | null): string {
  if (dataDir) {
    const fullPath = join(dataDir, relativePath);
    if (existsSync(fullPath)) {
      return readFileSync(fullPath, 'utf-8');
    }
  }
  return FALLBACK_SQL[relativePath] ?? '';
}

/**
 * Applies initial schema bootstrap and tracks migration execution in `schema_migrations`.
 */
export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);

  const initialMigrationName = '001_initial_bootstrap';

  const row = db
    .prepare('SELECT name FROM schema_migrations WHERE name = ?')
    .get(initialMigrationName);

  if (row) {
    return;
  }

  const dataDir = findDataDir();

  const applyMigration = db.transaction(() => {
    for (const relPath of MIGRATION_FILE_SEQUENCE) {
      const sql = loadSqlContent(relPath, dataDir);
      if (sql.trim()) {
        db.exec(sql);
      }
    }

    db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
      initialMigrationName,
      new Date().toISOString(),
    );
  });

  applyMigration();
}
