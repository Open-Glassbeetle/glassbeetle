CREATE TABLE artifacts (
    id           TEXT PRIMARY KEY,
    project_id   TEXT REFERENCES projects(id) ON DELETE SET NULL,
    chat_id      TEXT REFERENCES chats(id) ON DELETE SET NULL,
    agent_id     TEXT REFERENCES agents(id) ON DELETE SET NULL,
    title        TEXT NOT NULL,
    type         TEXT NOT NULL,                  -- e. g. 'document', 'code', 'file', 'structured'
    mime_type    TEXT,
    content      TEXT,                            -- Inline-content for small/text artifacts (e. g. JSON, text, code snippets). For large artifacts, use file_path instead.
    file_path    TEXT,                            -- local path for large/binary artifacts (see .../content)
    version      INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
