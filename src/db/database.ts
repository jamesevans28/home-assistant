import Database from "better-sqlite3";
import { readFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { getConfig } from "../config.js";
import { getLogger } from "../utils/logger.js";

let _db: Database.Database | null = null;

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

  const migrationsDir = resolve(process.cwd(), "migrations");

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const name = file.replace(/\.sql$/, "");
    const applied = db
      .prepare("SELECT name FROM _migrations WHERE name = ?")
      .get(name) as { name: string } | undefined;

    if (!applied) {
      const sql = readFileSync(resolve(migrationsDir, file), "utf-8");
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(name);
      log.info(`Applied migration: ${name}`);
    }
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
