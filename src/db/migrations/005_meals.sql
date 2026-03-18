-- Meal library
CREATE TABLE IF NOT EXISTS meals (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    name            TEXT NOT NULL,
    tags            TEXT,
    ingredients     TEXT,
    notes           TEXT,
    is_gluten_free  INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_meals_user ON meals(user_id);

-- Meal cook log
CREATE TABLE IF NOT EXISTS meal_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    meal_id     INTEGER NOT NULL REFERENCES meals(id),
    cooked_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_meal_log_meal ON meal_log(meal_id);

-- Add meal reference to shopping items
ALTER TABLE shopping_items ADD COLUMN meal_ref TEXT;
