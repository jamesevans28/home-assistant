-- Sports fixture schedule system
CREATE TABLE IF NOT EXISTS sports_fixtures (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sport           TEXT NOT NULL,
    season          INTEGER NOT NULL,
    round           TEXT,
    home_team       TEXT,
    away_team       TEXT,
    event_name      TEXT,
    start_time      TEXT NOT NULL,
    venue           TEXT,
    status          TEXT NOT NULL DEFAULT 'scheduled',
    home_score      TEXT,
    away_score      TEXT,
    result_summary  TEXT,
    broadcast       TEXT,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(sport, season, round, home_team, away_team, event_name)
);

CREATE INDEX IF NOT EXISTS idx_fixtures_sport ON sports_fixtures(sport);
CREATE INDEX IF NOT EXISTS idx_fixtures_start_time ON sports_fixtures(start_time);
CREATE INDEX IF NOT EXISTS idx_fixtures_home_team ON sports_fixtures(home_team);
CREATE INDEX IF NOT EXISTS idx_fixtures_away_team ON sports_fixtures(away_team);
CREATE INDEX IF NOT EXISTS idx_fixtures_status ON sports_fixtures(status);
CREATE INDEX IF NOT EXISTS idx_fixtures_sport_season ON sports_fixtures(sport, season);

-- Team aliases for fuzzy matching
CREATE TABLE IF NOT EXISTS team_aliases (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    alias           TEXT NOT NULL UNIQUE,
    canonical_name  TEXT NOT NULL,
    sport           TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_team_aliases_alias ON team_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_team_aliases_sport ON team_aliases(sport);

-- Track when fixtures were last refreshed per sport
CREATE TABLE IF NOT EXISTS fixture_refresh_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sport           TEXT NOT NULL,
    season          INTEGER NOT NULL,
    refreshed_at    TEXT NOT NULL DEFAULT (datetime('now')),
    fixtures_count  INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'success',
    notes           TEXT,
    UNIQUE(sport, season)
);
