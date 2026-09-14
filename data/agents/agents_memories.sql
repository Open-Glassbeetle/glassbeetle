CREATE TABLE agent_memories (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    tags        TEXT,                            -- JSON-Array, e.g., ["project-x","preference"]
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);