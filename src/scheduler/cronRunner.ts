import cron from "node-cron";
import { Bot } from "grammy";
import { getConfig } from "../config.js";
import { getLogger } from "../utils/logger.js";
import { processReminders } from "./reminderService.js";
import { sendDailySuggestions } from "./suggestionEngine.js";
import { sendMorningDigest } from "./morningDigest.js";
import { checkEmails } from "./emailWatcher.js";
import { checkBirthdays } from "./birthdayChecker.js";
import { sendBinReminder } from "./binReminder.js";
import { checkGameDay } from "./gameDayChecker.js";

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

  // Morning digest
  cron.schedule(
    config.MORNING_DIGEST_CRON,
    async () => {
      try {
        await sendMorningDigest(bot);
      } catch (err) {
        log.error({ err }, "Morning digest cron error");
      }
    },
    { timezone: config.DEFAULT_TIMEZONE }
  );

  log.info(
    { cron: config.MORNING_DIGEST_CRON },
    "Morning digest scheduler started"
  );

  // Email watcher
  cron.schedule(
    config.EMAIL_CHECK_CRON,
    async () => {
      try {
        await checkEmails(bot);
      } catch (err) {
        log.error({ err }, "Email watcher cron error");
      }
    },
    { timezone: config.DEFAULT_TIMEZONE }
  );

  log.info(
    { cron: config.EMAIL_CHECK_CRON },
    "Email watcher scheduler started"
  );

  // Birthday checker — runs at 7am daily (before the digest)
  cron.schedule(
    "0 7 * * *",
    async () => {
      try {
        await checkBirthdays(bot);
      } catch (err) {
        log.error({ err }, "Birthday checker cron error");
      }
    },
    { timezone: config.DEFAULT_TIMEZONE }
  );

  log.info("Birthday checker started (7am daily)");

  // Bin reminder — Monday at 6pm
  cron.schedule(
    "0 18 * * 1",
    async () => {
      try {
        await sendBinReminder(bot);
      } catch (err) {
        log.error({ err }, "Bin reminder cron error");
      }
    },
    { timezone: config.DEFAULT_TIMEZONE }
  );

  log.info("Bin reminder started (Monday 6pm)");

  // Game day checker — runs at midday daily
  cron.schedule(
    "0 12 * * *",
    async () => {
      try {
        await checkGameDay(bot);
      } catch (err) {
        log.error({ err }, "Game day checker cron error");
      }
    },
    { timezone: config.DEFAULT_TIMEZONE }
  );

  log.info("Game day checker started (12pm daily)");
}
