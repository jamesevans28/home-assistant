import { getDatabase } from "../database.js";

export interface FamilyMember {
  id: number;
  user_id: number;
  name: string;
  relationship: string | null;
  age: number | null;
  notes: string | null;
  created_at: string;
}

export function addFamilyMember(
  userId: number,
  name: string,
  opts?: { relationship?: string; age?: number; notes?: string }
): FamilyMember {
  const db = getDatabase();
  const result = db
    .prepare(
      `INSERT INTO family_members (user_id, name, relationship, age, notes)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(userId, name, opts?.relationship ?? null, opts?.age ?? null, opts?.notes ?? null);

  return db
    .prepare("SELECT * FROM family_members WHERE id = ?")
    .get(result.lastInsertRowid) as FamilyMember;
}

export function listFamilyMembers(userId: number): FamilyMember[] {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM family_members WHERE user_id = ? ORDER BY name")
    .all(userId) as FamilyMember[];
}

export function updateFamilyMember(
  memberId: number,
  userId: number,
  updates: { name?: string; relationship?: string; age?: number; notes?: string }
): boolean {
  const db = getDatabase();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    params.push(updates.name);
  }
  if (updates.relationship !== undefined) {
    sets.push("relationship = ?");
    params.push(updates.relationship);
  }
  if (updates.age !== undefined) {
    sets.push("age = ?");
    params.push(updates.age);
  }
  if (updates.notes !== undefined) {
    sets.push("notes = ?");
    params.push(updates.notes);
  }

  if (sets.length === 0) return false;

  params.push(memberId, userId);
  const result = db
    .prepare(`UPDATE family_members SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`)
    .run(...params);

  return result.changes > 0;
}

export function removeFamilyMember(memberId: number, userId: number): boolean {
  const db = getDatabase();
  const result = db
    .prepare("DELETE FROM family_members WHERE id = ? AND user_id = ?")
    .run(memberId, userId);
  return result.changes > 0;
}

export function findFamilyMemberByName(userId: number, name: string): FamilyMember | undefined {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM family_members WHERE user_id = ? AND LOWER(name) = LOWER(?)")
    .get(userId, name) as FamilyMember | undefined;
}
