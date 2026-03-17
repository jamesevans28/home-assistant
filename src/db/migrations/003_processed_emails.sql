CREATE TABLE IF NOT EXISTS processed_emails (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    gmail_id        TEXT UNIQUE NOT NULL,
    rule_name       TEXT NOT NULL,
    processed_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_processed_emails_gmail ON processed_emails(gmail_id);
