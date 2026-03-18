import { getDatabase } from "../database.js";

export interface Meal {
  id: number;
  user_id: number;
  name: string;
  tags: string | null;
  ingredients: string | null;
  notes: string | null;
  is_gluten_free: number;
  created_at: string;
}

export interface MealWithHistory extends Meal {
  last_cooked: string | null;
  times_cooked: number;
}

export interface MealLogEntry {
  id: number;
  meal_id: number;
  meal_name: string;
  cooked_at: string;
}

export interface MealOpts {
  tags?: string;
  ingredients?: string;
  notes?: string;
  isGlutenFree?: boolean;
}

export function addMeal(
  userId: number,
  name: string,
  opts?: MealOpts
): Meal {
  const db = getDatabase();
  const result = db
    .prepare(
      `INSERT INTO meals (user_id, name, tags, ingredients, notes, is_gluten_free)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      name,
      opts?.tags ?? null,
      opts?.ingredients ?? null,
      opts?.notes ?? null,
      opts?.isGlutenFree ? 1 : 0
    );

  return db
    .prepare("SELECT * FROM meals WHERE id = ?")
    .get(result.lastInsertRowid) as Meal;
}

export function updateMeal(
  mealId: number,
  userId: number,
  updates: Partial<MealOpts> & { name?: string }
): boolean {
  const db = getDatabase();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    params.push(updates.name);
  }
  if (updates.tags !== undefined) {
    sets.push("tags = ?");
    params.push(updates.tags);
  }
  if (updates.ingredients !== undefined) {
    sets.push("ingredients = ?");
    params.push(updates.ingredients);
  }
  if (updates.notes !== undefined) {
    sets.push("notes = ?");
    params.push(updates.notes);
  }
  if (updates.isGlutenFree !== undefined) {
    sets.push("is_gluten_free = ?");
    params.push(updates.isGlutenFree ? 1 : 0);
  }

  if (sets.length === 0) return false;

  params.push(mealId, userId);
  const result = db
    .prepare(
      `UPDATE meals SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`
    )
    .run(...params);

  return result.changes > 0;
}

export function removeMeal(mealId: number, userId: number): boolean {
  const db = getDatabase();
  // Delete log entries first
  db.prepare("DELETE FROM meal_log WHERE meal_id = ?").run(mealId);
  const result = db
    .prepare("DELETE FROM meals WHERE id = ? AND user_id = ?")
    .run(mealId, userId);
  return result.changes > 0;
}

export function listMeals(userId: number): Meal[] {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM meals WHERE user_id = ? ORDER BY name")
    .all(userId) as Meal[];
}

export function findMealByName(
  userId: number,
  name: string
): Meal | undefined {
  const db = getDatabase();
  return db
    .prepare(
      "SELECT * FROM meals WHERE user_id = ? AND LOWER(name) = LOWER(?)"
    )
    .get(userId, name) as Meal | undefined;
}

export function logMeal(mealId: number): MealLogEntry {
  const db = getDatabase();
  const result = db
    .prepare("INSERT INTO meal_log (meal_id) VALUES (?)")
    .run(mealId);

  return db
    .prepare(
      `SELECT ml.id, ml.meal_id, m.name as meal_name, ml.cooked_at
       FROM meal_log ml JOIN meals m ON ml.meal_id = m.id
       WHERE ml.id = ?`
    )
    .get(result.lastInsertRowid) as MealLogEntry;
}

export function getMealHistory(
  userId: number,
  limit = 14
): MealLogEntry[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT ml.id, ml.meal_id, m.name as meal_name, ml.cooked_at
       FROM meal_log ml
       JOIN meals m ON ml.meal_id = m.id
       WHERE m.user_id = ?
       ORDER BY ml.cooked_at DESC
       LIMIT ?`
    )
    .all(userId, limit) as MealLogEntry[];
}

export function getMealsWithLastCooked(
  userId: number
): MealWithHistory[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT m.*,
              MAX(ml.cooked_at) as last_cooked,
              COUNT(ml.id) as times_cooked
       FROM meals m
       LEFT JOIN meal_log ml ON m.id = ml.meal_id
       WHERE m.user_id = ?
       GROUP BY m.id
       ORDER BY m.name`
    )
    .all(userId) as MealWithHistory[];
}
