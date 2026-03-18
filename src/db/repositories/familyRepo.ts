import { getDatabase } from "../database.js";

export interface FamilyMember {
  id: number;
  user_id: number;
  name: string;
  relationship: string | null;
  age: number | null;
  notes: string | null;
  date_of_birth: string | null;
  interests: string | null;
  dietary: string | null;
  allergies: string | null;
  school_or_work: string | null;
  medical_notes: string | null;
  favourite_teams: string | null;
  telegram_id: number | null;
  created_at: string;
}

export interface FamilyMemberOpts {
  relationship?: string;
  age?: number;
  notes?: string;
  date_of_birth?: string;
  interests?: string;
  dietary?: string;
  allergies?: string;
  school_or_work?: string;
  medical_notes?: string;
  favourite_teams?: string;
  telegram_id?: number;
}

export function addFamilyMember(
  userId: number,
  name: string,
  opts?: FamilyMemberOpts
): FamilyMember {
  const db = getDatabase();
  const result = db
    .prepare(
      `INSERT INTO family_members (user_id, name, relationship, age, notes, date_of_birth, interests, dietary, allergies, school_or_work, medical_notes, favourite_teams, telegram_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      name,
      opts?.relationship ?? null,
      opts?.age ?? null,
      opts?.notes ?? null,
      opts?.date_of_birth ?? null,
      opts?.interests ?? null,
      opts?.dietary ?? null,
      opts?.allergies ?? null,
      opts?.school_or_work ?? null,
      opts?.medical_notes ?? null,
      opts?.favourite_teams ?? null,
      opts?.telegram_id ?? null
    );

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
  updates: FamilyMemberOpts & { name?: string }
): boolean {
  const db = getDatabase();
  const sets: string[] = [];
  const params: unknown[] = [];

  const fields = [
    "name", "relationship", "age", "notes", "date_of_birth",
    "interests", "dietary", "allergies", "school_or_work", "medical_notes",
    "favourite_teams", "telegram_id",
  ] as const;

  for (const field of fields) {
    if ((updates as Record<string, unknown>)[field] !== undefined) {
      sets.push(`${field} = ?`);
      params.push((updates as Record<string, unknown>)[field]);
    }
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

export function getAllFavouriteTeams(userId: number): Array<{ team: string; members: string[] }> {
  const members = listFamilyMembers(userId);
  const teamMap = new Map<string, string[]>();

  for (const m of members) {
    if (!m.favourite_teams) continue;
    for (const team of m.favourite_teams.split(",").map((t) => t.trim()).filter(Boolean)) {
      const lower = team.toLowerCase();
      if (!teamMap.has(lower)) teamMap.set(lower, []);
      teamMap.get(lower)!.push(m.name);
    }
  }

  return Array.from(teamMap.entries()).map(([team, members]) => ({ team, members }));
}

export function findFamilyMemberByName(userId: number, name: string): FamilyMember | undefined {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM family_members WHERE user_id = ? AND LOWER(name) = LOWER(?)")
    .get(userId, name) as FamilyMember | undefined;
}
