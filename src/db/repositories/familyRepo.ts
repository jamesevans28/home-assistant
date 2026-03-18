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
  profile_json: string;
  created_at: string;
}

export type ProfileData = Record<string, string | string[] | number | boolean | null>;

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

export function getProfile(memberId: number): ProfileData {
  const db = getDatabase();
  const row = db
    .prepare("SELECT profile_json FROM family_members WHERE id = ?")
    .get(memberId) as { profile_json: string } | undefined;
  try {
    return JSON.parse(row?.profile_json || "{}");
  } catch {
    return {};
  }
}

export function updateProfile(
  memberId: number,
  userId: number,
  updates: ProfileData
): boolean {
  const db = getDatabase();
  const existing = getProfile(memberId);
  const merged = { ...existing, ...updates };
  const result = db
    .prepare("UPDATE family_members SET profile_json = ? WHERE id = ? AND user_id = ?")
    .run(JSON.stringify(merged), memberId, userId);
  return result.changes > 0;
}

export function getProfileField(memberId: number, key: string): unknown {
  const profile = getProfile(memberId);
  return profile[key] ?? null;
}

export function getFamilyMembersWithTelegramId(userId: number): FamilyMember[] {
  const db = getDatabase();
  return db
    .prepare(
      "SELECT * FROM family_members WHERE user_id = ? AND telegram_id IS NOT NULL ORDER BY name"
    )
    .all(userId) as FamilyMember[];
}

/** All profile field names that Susie can ask about during check-ins */
export const PROFILE_FIELDS = [
  "favourite_colour", "favourite_food", "favourite_movie", "favourite_book",
  "favourite_music", "favourite_tv_shows", "favourite_restaurant",
  "love_language", "personality_type", "morning_person_or_night_owl",
  "comfort_food", "go_to_drink", "go_to_snack",
  "current_goals", "dreams", "bucket_list", "stressors",
  "hobbies_active", "skills", "learning",
  "best_friends", "social_preferences",
  "job_title", "work_schedule",
  "exercise_routine", "sleep_schedule",
  "anniversary", "important_dates",
  "shoe_size", "clothing_size",
  "best_friends_at_school", "after_school_activities",
  "pet_peeves", "quirks", "fun_facts",
  "gift_ideas", "wish_list", "recent_wins",
  "holiday_destination_dream", "last_holiday",
  "guilty_pleasure", "hidden_talent",
  "childhood_memory", "proudest_moment",
  "biggest_fear", "superpower_choice",
  "ideal_weekend", "favourite_season",
  "cooking_specialty", "takeaway_order",
] as const;
