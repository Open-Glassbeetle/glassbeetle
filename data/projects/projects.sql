CREATE TABLE projects (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT,
    image_path   TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);