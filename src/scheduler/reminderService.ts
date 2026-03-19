import { Bot } from "grammy";
import { getDueReminders, markNotified, createReminder } from "../db/repositories/reminderRepo.js";
import { getDatabase } from "../db/database.js";
import { getLogger } from "../utils/logger.js";
import { addDays, addWeeks, addMonths } from "date-fns";
import { toISOUTC } from "../utils/dateParser.js";
import { isQuietHours } from "../utils/quietHours.js";

export async function processReminders(bot: Bot) {
  const log = getLogger();

  // Don't send reminders during quiet hours (10pm–6am)
  if (isQuietHours()) return;

  const now = new Date();
  const nowUTC = toISOUTC(now);

  const dueReminders = getDueReminders(nowUTC);

  for (const reminder of dueReminders) {
    const db = getDatabase();
    const user = db
      .prepare("SELECT telegram_id, timezone FROM users WHERE id = ?")
      .get(reminder.user_id) as { telegram_id: number; timezone: string } | undefined;

    if (!user) continue;

    try {
      await bot.api.sendMessage(
        user.telegram_id,
        `🔔 Reminder: ${reminder.title}`
      );

      markNotified(reminder.id);

      // Handle recurrence — create next occurrence
      if (reminder.recurrence) {
        const dueDate = new Date(reminder.due_at + "Z");
        let nextDate: Date;

        switch (reminder.recurrence) {
          case "daily":
            nextDate = addDays(dueDate, 1);
            break;
          case "weekly":
            nextDate = addWeeks(dueDate, 1);
            break;
          case "monthly":
            nextDate = addMonths(dueDate, 1);
            break;
          default:
            continue;
        }

        createReminder(reminder.user_id, reminder.title, toISOUTC(nextDate), {
          description: reminder.description ?? undefined,
          recurrence: reminder.recurrence,
          familyMemberId: reminder.family_member_id ?? undefined,
        });

        log.info(
          { reminderId: reminder.id, nextDate: toISOUTC(nextDate) },
          "Created recurring reminder"
        );
      }
    } catch (err) {
      log.error({ err, reminderId: reminder.id }, "Failed to send reminder notification");
    }
  }
}
