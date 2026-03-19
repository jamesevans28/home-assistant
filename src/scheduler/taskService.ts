import { Bot } from "grammy";
import { getConfig } from "../config.js";
import { getLogger } from "../utils/logger.js";
import { getDatabase } from "../db/database.js";
import { getIncompleteTasks, updateMilestonesSent } from "../db/repositories/taskRepo.js";
import { formatInTimeZone } from "date-fns-tz";
import { differenceInCalendarDays } from "date-fns";

const MILESTONES = [
  { key: "30d", days: 30, label: "1 month" },
  { key: "14d", days: 14, label: "2 weeks" },
  { key: "7d", days: 7, label: "1 week" },
  { key: "3d", days: 3, label: "3 days" },
  { key: "1d", days: 1, label: "tomorrow" },
  { key: "0d", days: 0, label: "today" },
] as const;

export async function processTaskMilestones(bot: Bot) {
  const log = getLogger();
  const config = getConfig();
  const timezone = config.DEFAULT_TIMEZONE;
  const chatId = config.GROUP_CHAT_ID ?? config.ADMIN_TELEGRAM_ID;

  if (!chatId) return;

  const tasks = getIncompleteTasks();

  for (const task of tasks) {
    try {
      const sentMilestones: string[] = JSON.parse(task.milestones_sent || "[]");

      // Calculate days until due using the user's timezone for day boundaries
      const now = new Date();
      const nowLocal = formatInTimeZone(now, timezone, "yyyy-MM-dd");
      const dueLocal = formatInTimeZone(new Date(task.due_at + "Z"), timezone, "yyyy-MM-dd");
      const daysUntilDue = differenceInCalendarDays(new Date(dueLocal), new Date(nowLocal));

      // Find milestones that should fire but haven't
      const newMilestones = MILESTONES.filter(
        (m) => !sentMilestones.includes(m.key) && daysUntilDue <= m.days
      );

      if (newMilestones.length === 0) continue;

      // Pick the most urgent (smallest days value)
      const mostUrgent = newMilestones.reduce((a, b) => (a.days < b.days ? a : b));

      // Look up assigned family member name
      let assignedTo = "";
      if (task.family_member_id) {
        const db = getDatabase();
        const member = db
          .prepare("SELECT name FROM family_members WHERE id = ?")
          .get(task.family_member_id) as { name: string } | undefined;
        if (member) assignedTo = member.name;
      }

      const dueFormatted = formatInTimeZone(
        new Date(task.due_at + "Z"),
        timezone,
        "EEEE d MMM"
      );

      let message = `📋 *Task due ${mostUrgent.label}:* "${task.title}"`;
      if (assignedTo) message += ` (assigned to ${assignedTo})`;
      message += `\n📅 Due: ${dueFormatted}`;
      if (task.description) message += `\n${task.description}`;

      await bot.api
        .sendMessage(chatId, message, { parse_mode: "Markdown" })
        .catch(() => bot.api.sendMessage(chatId, message));

      // Mark all crossed milestones as sent
      const allSent = [...sentMilestones, ...newMilestones.map((m) => m.key)];
      updateMilestonesSent(task.id, allSent);

      log.info(
        { taskId: task.id, milestone: mostUrgent.key, title: task.title },
        "Sent task milestone reminder"
      );
    } catch (err) {
      log.error({ err, taskId: task.id }, "Failed to process task milestone");
    }
  }
}
