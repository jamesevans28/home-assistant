import { getDatabase } from "../database.js";

export interface User {
  id: number;
  telegram_id: number;
  telegram_name: string | null;
  timezone: string;
  is_admin: number;
  created_at: string;
  updated_at: string;
}

export function upsertUser(
  telegramId: number,
  telegramName: string | null,
  isAdmin: boolean
): User {
  const db = getDatabase();

  db.prepare(
    `INSERT INTO users (telegram_id, telegram_name, is_admin)
     VALUES (?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET
       telegram_name = excluded.telegram_name,
       updated_at = datetime('now')`
  ).run(telegramId, telegramName, isAdmin ? 1 : 0);

  return db
    .prepare("SELECT * FROM users WHERE telegram_id = ?")
    .get(telegramId) as User;
}

export function getUserByTelegramId(telegramId: number): User | undefined {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM users WHERE telegram_id = ?")
    .get(telegramId) as User | undefined;
}

export function updateTimezone(userId: number, timezone: string) {
  const db = getDatabase();
  db.prepare("UPDATE users SET timezone = ?, updated_at = datetime('now') WHERE id = ?").run(
    timezone,
    userId
  );
}
