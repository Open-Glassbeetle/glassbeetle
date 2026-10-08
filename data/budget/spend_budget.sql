CREATE TABLE spend_budget (
    id           TEXT PRIMARY KEY,
    singleton    INTEGER NOT NULL DEFAULT 1 CHECK (singleton = 1) UNIQUE,
    limit_usd    REAL,                     -- NULL: no budget set
    period       TEXT NOT NULL DEFAULT 'monthly'
                 CHECK (period IN ('daily', 'weekly', 'monthly')),
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
