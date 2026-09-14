CREATE TABLE team_members (
    team_id      TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    agent_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    role         TEXT,
    position     INTEGER,
    created_at   TEXT NOT NULL,
    PRIMARY KEY (team_id, agent_id)
);