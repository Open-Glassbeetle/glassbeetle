CREATE TABLE messages (
    id           TEXT PRIMARY KEY,
    chat_id      TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sequence     INTEGER NOT NULL,               -- sequence number of the message in the chat (starting from 1)
    role         TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    agent_id     TEXT REFERENCES agents(id) ON DELETE SET NULL, -- which Agent responded (relevant for Teams)
    content      TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'complete' CHECK (status IN (
                    'pending', 'streaming', 'complete', 'error'
                 )),
    token_count  INTEGER,
    created_at   TEXT NOT NULL,
    UNIQUE (chat_id, sequence)
);
