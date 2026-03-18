import { getDatabase } from "../database.js";

export interface ShoppingItem {
  id: number;
  user_id: number;
  item: string;
  added_by: string | null;
  is_checked: number;
  created_at: string;
}

export function addShoppingItem(
  userId: number,
  item: string,
  addedBy?: string
): ShoppingItem {
  const db = getDatabase();
  const result = db
    .prepare(
      "INSERT INTO shopping_items (user_id, item, added_by) VALUES (?, ?, ?)"
    )
    .run(userId, item.trim(), addedBy ?? null);

  return db
    .prepare("SELECT * FROM shopping_items WHERE id = ?")
    .get(result.lastInsertRowid) as ShoppingItem;
}

export function listShoppingItems(userId: number): ShoppingItem[] {
  const db = getDatabase();
  return db
    .prepare(
      "SELECT * FROM shopping_items WHERE user_id = ? AND is_checked = 0 ORDER BY created_at"
    )
    .all(userId) as ShoppingItem[];
}

export function removeShoppingItemByName(
  userId: number,
  name: string
): boolean {
  const db = getDatabase();
  // Case-insensitive exact match first, then LIKE fallback
  let result = db
    .prepare(
      "DELETE FROM shopping_items WHERE user_id = ? AND is_checked = 0 AND LOWER(item) = LOWER(?)"
    )
    .run(userId, name.trim());

  if (result.changes > 0) return true;

  // Fallback: partial match (e.g. "bread" matches "sourdough bread")
  result = db
    .prepare(
      "DELETE FROM shopping_items WHERE user_id = ? AND is_checked = 0 AND LOWER(item) LIKE ?"
    )
    .run(userId, `%${name.trim().toLowerCase()}%`);

  return result.changes > 0;
}

export function removeShoppingItem(
  itemId: number,
  userId: number
): boolean {
  const db = getDatabase();
  const result = db
    .prepare("DELETE FROM shopping_items WHERE id = ? AND user_id = ?")
    .run(itemId, userId);
  return result.changes > 0;
}

export function clearShoppingList(userId: number): number {
  const db = getDatabase();
  const result = db
    .prepare("DELETE FROM shopping_items WHERE user_id = ? AND is_checked = 0")
    .run(userId);
  return result.changes;
}

export function getShoppingCount(userId: number): number {
  const db = getDatabase();
  const row = db
    .prepare(
      "SELECT COUNT(*) as count FROM shopping_items WHERE user_id = ? AND is_checked = 0"
    )
    .get(userId) as { count: number };
  return row.count;
}
