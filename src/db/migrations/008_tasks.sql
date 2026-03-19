CREATE TABLE IF NOT EXISTS tasks (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id),
    family_member_id INTEGER REFERENCES family_members(id),
    title            TEXT NOT NULL,
    description      TEXT,
    due_at           TEXT NOT NULL,
    is_completed     INTEGER NOT NULL DEFAULT 0,
    completed_at     TEXT,
    milestones_sent  TEXT NOT NULL DEFAULT '[]',
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at, is_completed);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, is_completed);
