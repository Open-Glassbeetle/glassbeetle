CREATE TABLE backups (
    id           TEXT PRIMARY KEY,
    file_path    TEXT NOT NULL,
    size_bytes   INTEGER NOT NULL,
    trigger      TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
    created_at   TEXT NOT NULL
);