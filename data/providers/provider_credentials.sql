CREATE TABLE provider_credentials (
    provider_id      TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
    encrypted_value  BLOB NOT NULL,
    nonce            BLOB NOT NULL,
    masked_preview   TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);