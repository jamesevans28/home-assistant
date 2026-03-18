import { Bot } from "grammy";
import { getConfig } from "../config.js";
import { getLogger } from "../utils/logger.js";
import { formatInTimeZone } from "date-fns-tz";

// Anchor date: week of Mon 24 Mar 2026 is a RUBBISH week (green + rubbish).
// Weeks alternate: rubbish → recycling → rubbish → recycling …
const ANCHOR_RUBBISH_WEEK = new Date("2026-03-24T00:00:00+11:00");

type BinWeek = "rubbish" | "recycling";

export function getBinWeek(date: Date, timezone: string): BinWeek {
  // Get the Monday of the week containing `date` in the local timezone
  const localDateStr = formatInTimeZone(date, timezone, "yyyy-MM-dd");
  const localDate = new Date(localDateStr + "T00:00:00Z");

  // Get the Monday of the anchor week
  const anchorDateStr = formatInTimeZone(ANCHOR_RUBBISH_WEEK, timezone, "yyyy-MM-dd");
  const anchorDate = new Date(anchorDateStr + "T00:00:00Z");

  // Find the Monday of each week
  const dayOfWeekLocal = (localDate.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const localMonday = new Date(localDate.getTime() - dayOfWeekLocal * 86400000);

  const dayOfWeekAnchor = (anchorDate.getUTCDay() + 6) % 7;
  const anchorMonday = new Date(anchorDate.getTime() - dayOfWeekAnchor * 86400000);

  const weeksDiff = Math.round(
    (localMonday.getTime() - anchorMonday.getTime()) / (7 * 86400000)
  );

  // Anchor week is rubbish (0 = even), next week is recycling (1 = odd), etc.
  return weeksDiff % 2 === 0 ? "rubbish" : "recycling";
}

export function getBinMessage(week: BinWeek): string {
  if (week === "rubbish") {
    return "🗑️ *Bin night tonight!*\n\nPut out:\n• 🟢 Green waste\n• 🔴 Rubbish (red lid)";
  } else {
    return "♻️ *Bin night tonight!*\n\nPut out:\n• 🟢 Green waste\n• 🟡 Recycling (yellow lid)";
  }
}

export async function sendBinReminder(bot: Bot) {
  const log = getLogger();
  const config = getConfig();
  const chatId = config.GROUP_CHAT_ID ?? config.ADMIN_TELEGRAM_ID;
  const timezone = config.DEFAULT_TIMEZONE;

  const week = getBinWeek(new Date(), timezone);
  const msg = getBinMessage(week);

  try {
    await bot.api
      .sendMessage(chatId, msg, { parse_mode: "Markdown" })
      .catch(() => bot.api.sendMessage(chatId, msg));
    log.info({ week }, "Sent bin reminder");
  } catch (err) {
    log.error({ err }, "Failed to send bin reminder");
  }
}
