import { getDatabase } from "../database.js";

export interface Reminder {
  id: number;
  user_id: number;
  family_member_id: number | null;
  title: string;
  description: string | null;
  due_at: string;
  recurrence: string | null;
  is_completed: number;
  notified: number;
  created_at: string;
}

export function createReminder(
  userId: number,
  title: string,
  dueAt: string,
  opts?: {
    description?: string;
    recurrence?: string;
    familyMemberId?: number;
  }
): Reminder {
  const db = getDatabase();
  const result = db
    .prepare(
      `INSERT INTO reminders (user_id, title, description, due_at, recurrence, family_member_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      title,
      opts?.description ?? null,
      dueAt,
      opts?.recurrence ?? null,
      opts?.familyMemberId ?? null
    );

  return db
    .prepare("SELECT * FROM reminders WHERE id = ?")
    .get(result.lastInsertRowid) as Reminder;
}

export function listReminders(
  userId: number,
  opts?: { fromDate?: string; toDate?: string; familyMemberId?: number; includeCompleted?: boolean }
): Reminder[] {
  const db = getDatabase();
  let sql = "SELECT * FROM reminders WHERE user_id = ?";
  const params: unknown[] = [userId];

  if (!opts?.includeCompleted) {
    sql += " AND is_completed = 0";
  }
  if (opts?.fromDate) {
    sql += " AND due_at >= ?";
    params.push(opts.fromDate);
  }
  if (opts?.toDate) {
    sql += " AND due_at <= ?";
    params.push(opts.toDate);
  }
  if (opts?.familyMemberId) {
    sql += " AND family_member_id = ?";
    params.push(opts.familyMemberId);
  }

  sql += " ORDER BY due_at";
  return db.prepare(sql).all(...params) as Reminder[];
}

export function completeReminder(reminderId: number, userId: number): boolean {
  const db = getDatabase();
  const result = db
    .prepare("UPDATE reminders SET is_completed = 1 WHERE id = ? AND user_id = ?")
    .run(reminderId, userId);
  return result.changes > 0;
}

export function getDueReminders(beforeTime: string): Reminder[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT * FROM reminders
       WHERE due_at <= ? AND is_completed = 0 AND notified = 0
       ORDER BY due_at`
    )
    .all(beforeTime) as Reminder[];
}

export function markNotified(reminderId: number) {
  const db = getDatabase();
  db.prepare("UPDATE reminders SET notified = 1 WHERE id = ?").run(reminderId);
}
