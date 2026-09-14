CREATE TABLE providers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,                 -- Display name, e.g., "My Anthropic Account"
    kind        TEXT NOT NULL CHECK (kind IN (
                    'anthropic', 'openai', 'google',
                    'ollama', 'lmstudio', 'openai_compatible'
                )),
    is_local    INTEGER NOT NULL DEFAULT 0,     -- 0 = remote, 1 = local Runtime
    base_url    TEXT,                           -- Required for local/custom endpoints
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);