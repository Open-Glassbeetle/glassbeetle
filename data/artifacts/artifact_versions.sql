CREATE TABLE artifact_versions (
    id           TEXT PRIMARY KEY,
    artifact_id  TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    version      INTEGER NOT NULL,
    title        TEXT NOT NULL,
    type         TEXT NOT NULL,
    mime_type    TEXT,
    content      TEXT,
    file_path    TEXT,
    created_at   TEXT NOT NULL,
    UNIQUE (artifact_id, version)
);
