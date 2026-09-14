CREATE TABLE chats (
    id               TEXT PRIMARY KEY,
    title            TEXT,
    project_id       TEXT REFERENCES projects(id) ON DELETE SET NULL,
    agent_id         TEXT REFERENCES agents(id) ON DELETE SET NULL,
    team_id          TEXT REFERENCES teams(id) ON DELETE SET NULL,
    context_summary  TEXT,                       -- Result of POST /chats/:id/compact
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    CHECK (
        (agent_id IS NOT NULL AND team_id IS NULL)
        OR (agent_id IS NULL AND team_id IS NOT NULL)
    )
);
