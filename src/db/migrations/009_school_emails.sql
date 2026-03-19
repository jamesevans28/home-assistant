CREATE TABLE IF NOT EXISTS school_emails (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    gmail_id         TEXT UNIQUE NOT NULL,
    subject          TEXT NOT NULL,
    received_at      TEXT NOT NULL,
    body_text        TEXT,
    linked_page_text TEXT,
    ai_summary       TEXT,
    expires_at       TEXT NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_school_emails_received ON school_emails(received_at);
CREATE INDEX IF NOT EXISTS idx_school_emails_expires ON school_emails(expires_at);
