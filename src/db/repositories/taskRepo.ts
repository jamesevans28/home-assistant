import { getDatabase } from "../database.js";

export interface Task {
  id: number;
  user_id: number;
  family_member_id: number | null;
  title: string;
  description: string | null;
  due_at: string;
  is_completed: number;
  completed_at: string | null;
  milestones_sent: string;
  created_at: string;
}

export function createTask(
  userId: number,
  title: string,
  dueAt: string,
  opts?: { description?: string; familyMemberId?: number }
): Task {
  const db = getDatabase();
  const result = db
    .prepare(
      `INSERT INTO tasks (user_id, title, description, due_at, family_member_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(userId, title, opts?.description ?? null, dueAt, opts?.familyMemberId ?? null);

  return db
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(result.lastInsertRowid) as Task;
}

export function listTasks(
  userId: number,
  opts?: {
    familyMemberId?: number;
    includeCompleted?: boolean;
    fromDate?: string;
    toDate?: string;
  }
): Task[] {
  const db = getDatabase();
  let sql = "SELECT * FROM tasks WHERE user_id = ?";
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
  return db.prepare(sql).all(...params) as Task[];
}

export function completeTask(taskId: number, userId: number): boolean {
  const db = getDatabase();
  const result = db
    .prepare(
      "UPDATE tasks SET is_completed = 1, completed_at = datetime('now') WHERE id = ? AND user_id = ?"
    )
    .run(taskId, userId);
  return result.changes > 0;
}

export function getIncompleteTasks(): Task[] {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM tasks WHERE is_completed = 0 ORDER BY due_at")
    .all() as Task[];
}

export function updateMilestonesSent(taskId: number, milestones: string[]) {
  const db = getDatabase();
  db.prepare("UPDATE tasks SET milestones_sent = ? WHERE id = ?").run(
    JSON.stringify(milestones),
    taskId
  );
}

export function getTasksDueInRange(startUTC: string, endUTC: string): Task[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT * FROM tasks
       WHERE due_at >= ? AND due_at <= ? AND is_completed = 0
       ORDER BY due_at`
    )
    .all(startUTC, endUTC) as Task[];
}

export function getTaskById(taskId: number, userId: number): Task | undefined {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM tasks WHERE id = ? AND user_id = ?")
    .get(taskId, userId) as Task | undefined;
}
