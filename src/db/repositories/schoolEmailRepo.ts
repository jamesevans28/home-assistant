import { getDatabase } from "../database.js";

export interface SchoolEmail {
  id: number;
  gmail_id: string;
  subject: string;
  received_at: string;
  body_text: string | null;
  linked_page_text: string | null;
  ai_summary: string | null;
  expires_at: string;
  created_at: string;
}

export function saveSchoolEmail(data: {
  gmailId: string;
  subject: string;
  receivedAt: string;
  bodyText?: string;
  linkedPageText?: string;
  aiSummary?: string;
}): void {
  const db = getDatabase();
  db.prepare(
    `INSERT OR IGNORE INTO school_emails (gmail_id, subject, received_at, body_text, linked_page_text, ai_summary, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime(?, '+6 months'))`
  ).run(
    data.gmailId,
    data.subject,
    data.receivedAt,
    data.bodyText ?? null,
    data.linkedPageText ?? null,
    data.aiSummary ?? null,
    data.receivedAt
  );
}

export function searchSchoolEmails(
  query: string,
  opts?: { fromDate?: string; toDate?: string; limit?: number }
): SchoolEmail[] {
  const db = getDatabase();
  const keywords = query.split(/\s+/).filter(Boolean);
  if (keywords.length === 0) return listRecentSchoolEmails(opts?.limit ?? 10);

  const conditions: string[] = [];
  const params: unknown[] = [];

  for (const keyword of keywords) {
    const pattern = `%${keyword}%`;
    conditions.push(
      "(subject LIKE ? OR ai_summary LIKE ? OR body_text LIKE ?)"
    );
    params.push(pattern, pattern, pattern);
  }

  if (opts?.fromDate) {
    conditions.push("received_at >= ?");
    params.push(opts.fromDate);
  }
  if (opts?.toDate) {
    conditions.push("received_at <= ?");
    params.push(opts.toDate);
  }

  const limit = opts?.limit ?? 10;
  params.push(limit);

  const sql = `SELECT * FROM school_emails
    WHERE ${conditions.join(" AND ")}
    ORDER BY received_at DESC
    LIMIT ?`;

  return db.prepare(sql).all(...params) as SchoolEmail[];
}

export function listRecentSchoolEmails(limit = 10): SchoolEmail[] {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM school_emails ORDER BY received_at DESC LIMIT ?")
    .all(limit) as SchoolEmail[];
}

export function deleteExpiredSchoolEmails(): number {
  const db = getDatabase();
  const result = db
    .prepare("DELETE FROM school_emails WHERE expires_at < datetime('now')")
    .run();
  return result.changes;
}
