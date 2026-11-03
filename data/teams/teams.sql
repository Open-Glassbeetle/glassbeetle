CREATE TABLE teams (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT,
    strategy     TEXT NOT NULL DEFAULT 'sequential',
    max_turns_per_interaction INTEGER DEFAULT 5,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
