CREATE TABLE usage_events (
    id            TEXT PRIMARY KEY,
    occurred_at   TEXT NOT NULL,
    event_type    TEXT NOT NULL,                 -- e. g. 'chat_completion', 'agent_created', 'artifact_created'
    agent_id      TEXT REFERENCES agents(id) ON DELETE SET NULL,
    provider_id   TEXT REFERENCES providers(id) ON DELETE SET NULL,
    model_id      TEXT REFERENCES models(id) ON DELETE SET NULL,
    chat_id       TEXT REFERENCES chats(id) ON DELETE SET NULL,
    input_tokens  INTEGER,
    output_tokens INTEGER,
    cost_usd      REAL,
    metadata      TEXT                            -- JSON, free additional data
);
