CREATE TABLE backup_policy (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    enabled           INTEGER NOT NULL DEFAULT 0,
    frequency         TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('hourly', 'daily', 'weekly')),
    retention_count   INTEGER NOT NULL DEFAULT 7,
    target_directory  TEXT,
    updated_at        TEXT NOT NULL
);