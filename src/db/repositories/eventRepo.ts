import { getDatabase } from "../database.js";

export interface CalendarEvent {
  id: number;
  user_id: number;
  family_member_id: number | null;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  location: string | null;
  recurrence: string | null;
  created_at: string;
}

export function createEvent(
  userId: number,
  title: string,
  startAt: string,
  opts?: {
    description?: string;
    endAt?: string;
    location?: string;
    recurrence?: string;
    familyMemberId?: number;
  }
): CalendarEvent {
  const db = getDatabase();
  const result = db
    .prepare(
      `INSERT INTO events (user_id, title, description, start_at, end_at, location, recurrence, family_member_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      title,
      opts?.description ?? null,
      startAt,
      opts?.endAt ?? null,
      opts?.location ?? null,
      opts?.recurrence ?? null,
      opts?.familyMemberId ?? null
    );

  return db
    .prepare("SELECT * FROM events WHERE id = ?")
    .get(result.lastInsertRowid) as CalendarEvent;
}

export function listEvents(
  userId: number,
  opts?: { fromDate?: string; toDate?: string; familyMemberId?: number }
): CalendarEvent[] {
  const db = getDatabase();
  let sql = "SELECT * FROM events WHERE user_id = ?";
  const params: unknown[] = [userId];

  if (opts?.fromDate) {
    sql += " AND start_at >= ?";
    params.push(opts.fromDate);
  }
  if (opts?.toDate) {
    sql += " AND start_at <= ?";
    params.push(opts.toDate);
  }
  if (opts?.familyMemberId) {
    sql += " AND family_member_id = ?";
    params.push(opts.familyMemberId);
  }

  sql += " ORDER BY start_at";
  return db.prepare(sql).all(...params) as CalendarEvent[];
}

export function getUpcomingEvents(beforeTime: string, afterTime: string): CalendarEvent[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT * FROM events
       WHERE start_at >= ? AND start_at <= ?
       ORDER BY start_at`
    )
    .all(afterTime, beforeTime) as CalendarEvent[];
}
