CREATE TABLE agents (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    personality        TEXT,                     -- Free-text character description
    instructions       TEXT,                     -- Agent-specific instructions (in addition to the system_prompt)
    system_prompt_id   TEXT REFERENCES system_prompts(id) ON DELETE SET NULL,
    model_id           TEXT REFERENCES models(id) ON DELETE SET NULL,
    temperature        REAL,
    max_tokens         INTEGER,
    model_params       TEXT,                     -- JSON: provider-specific additional parameters
    picture_path       TEXT,                     -- local path to the profile picture
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);