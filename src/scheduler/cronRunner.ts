import cron from "node-cron";
import { Bot } from "grammy";
import { getConfig } from "../config.js";
import { getLogger } from "../utils/logger.js";
import { processReminders } from "./reminderService.js";
import { sendDailySuggestions } from "./suggestionEngine.js";

export function startScheduler(bot: Bot) {
  const config = getConfig();
  const log = getLogger();

  // Check reminders every 60 seconds
  cron.schedule("* * * * *", async () => {
    try {
      await processReminders(bot);
    } catch (err) {
      log.error({ err }, "Reminder cron error");
    }
  });

  log.info("Reminder scheduler started (every 60s)");

  // Daily suggestions
  cron.schedule(config.SUGGESTION_CRON, async () => {
    try {
      await sendDailySuggestions(bot);
    } catch (err) {
      log.error({ err }, "Suggestion cron error");
    }
  });

  log.info({ cron: config.SUGGESTION_CRON }, "Suggestion scheduler started");
}
