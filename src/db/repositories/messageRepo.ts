import { getDatabase } from "../database.js";

export interface Message {
  id: number;
  user_id: number;
  role: string;
  content: string;
  tool_call_id: string | null;
  token_count: number | null;
  created_at: string;
}

export function saveMessage(
  userId: number,
  role: string,
  content: string,
  opts?: { toolCallId?: string; tokenCount?: number }
) {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO messages (user_id, role, content, tool_call_id, token_count)
     VALUES (?, ?, ?, ?, ?)`
  ).run(userId, role, content, opts?.toolCallId ?? null, opts?.tokenCount ?? null);
}

export function getRecentMessages(userId: number, limit = 50): Message[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT * FROM (
         SELECT * FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
       ) ORDER BY created_at ASC`
    )
    .all(userId, limit) as Message[];
}

export function getMessageCountsByDay(days: number): { date: string; count: number }[] {
  const db = getDatabase();
  const since = new Date();
  since.setDate(since.getDate() - days);
  return db
    .prepare(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM messages
       WHERE created_at >= ?
       GROUP BY DATE(created_at)
       ORDER BY date`
    )
    .all(since.toISOString()) as { date: string; count: number }[];
}

export function pruneOldMessages(userId: number, keepCount = 200) {
  const db = getDatabase();
  db.prepare(
    `DELETE FROM messages WHERE user_id = ? AND id NOT IN (
       SELECT id FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
     )`
  ).run(userId, userId, keepCount);
}
