CREATE TABLE models (
    id                     TEXT PRIMARY KEY,
    provider_id            TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    model_identifier        TEXT NOT NULL,       -- exact string for the provider API, e.g., "claude-sonnet-5", "qwen2.5:14b"
    display_name           TEXT NOT NULL,
    source                 TEXT NOT NULL CHECK (source IN ('discovered', 'manual')),
    context_window         INTEGER,
    default_temperature    REAL,
    default_max_tokens     INTEGER,
    enabled                INTEGER NOT NULL DEFAULT 1,
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL,
    UNIQUE (provider_id, model_identifier)
);
