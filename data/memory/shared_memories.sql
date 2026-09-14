CREATE TABLE shared_memories (
    id          TEXT PRIMARY KEY,
    content     TEXT NOT NULL,
    tags        TEXT,                            -- JSON-Array
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);