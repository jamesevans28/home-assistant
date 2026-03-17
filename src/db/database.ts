import Database from "better-sqlite3";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { getConfig } from "../config.js";
import { getLogger } from "../utils/logger.js";

let _db: Database.Database | null = null;

const __dirname = dirname(fileURLToPath(import.meta.url));

export function initDatabase(): Database.Database {
  const config = getConfig();
  const log = getLogger();

  const dbDir = dirname(config.DB_PATH);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  _db = new Database(config.DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  log.info({ path: config.DB_PATH }, "Database initialized");

  runMigrations(_db);

  return _db;
}

function runMigrations(db: Database.Database) {
  const log = getLogger();

  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const migrationsDir = resolve(__dirname, "migrations");
  const migrationFile = resolve(migrationsDir, "001_initial.sql");

  if (!existsSync(migrationFile)) {
    log.warn("Migration file not found: 001_initial.sql");
    return;
  }

  const applied = db
    .prepare("SELECT name FROM _migrations WHERE name = ?")
    .get("001_initial") as { name: string } | undefined;

  if (!applied) {
    const sql = readFileSync(migrationFile, "utf-8");
    db.exec(sql);
    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run("001_initial");
    log.info("Applied migration: 001_initial");
  }
}

export function getDatabase(): Database.Database {
  if (!_db) throw new Error("Database not initialized. Call initDatabase() first.");
  return _db;
}

export function closeDatabase() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
