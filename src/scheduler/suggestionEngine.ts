import { Bot } from "grammy";
import { getDatabase } from "../db/database.js";
import { chat } from "../ai/agent.js";
import { getLogger } from "../utils/logger.js";
import { splitMessage } from "../utils/telegram.js";

export async function sendDailySuggestions(bot: Bot) {
  const log = getLogger();
  const db = getDatabase();

  // Get all admin users (for now, suggestions go to admins only)
  const users = db
    .prepare("SELECT id, telegram_id FROM users WHERE is_admin = 1")
    .all() as Array<{ id: number; telegram_id: number }>;

  for (const user of users) {
    try {
      const response = await chat(
        user.id,
        user.telegram_id,
        "Give me a helpful suggestion for today. Consider what day of the week it is, " +
          "any upcoming events or reminders, and my family. Keep it brief and actionable."
      );

      const chunks = splitMessage(response);
      for (const chunk of chunks) {
        await bot.api.sendMessage(user.telegram_id, `💡 Daily suggestion:\n\n${chunk}`);
      }
    } catch (err) {
      log.error({ err, userId: user.id }, "Failed to send daily suggestion");
    }
  }
}
