CREATE TABLE user_profile (
    id                  TEXT PRIMARY KEY,
    singleton           INTEGER NOT NULL DEFAULT 1 CHECK (singleton = 1) UNIQUE,
    display_name        TEXT,                     -- What the UI greets and what agents call the user
    pronouns            TEXT,                     -- Goes into the prompt so an agent does not have to guess
    about               TEXT,                     -- Free text: what agents should know about the user
    locale              TEXT,                     -- BCP-47, e.g. 'de-CH'
    timezone            TEXT,                     -- IANA, e.g. 'Europe/Zurich'
    include_in_prompts  INTEGER NOT NULL DEFAULT 1,
    picture_path        TEXT,                     -- storage-relative reference, never serialised
    picture_updated_at  TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);
