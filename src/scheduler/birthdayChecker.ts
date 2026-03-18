import { Bot } from "grammy";
import { getConfig } from "../config.js";
import { getLogger } from "../utils/logger.js";
import { getDatabase } from "../db/database.js";
import { listFamilyMembers, type FamilyMember } from "../db/repositories/familyRepo.js";
import { formatInTimeZone } from "date-fns-tz";

function getAdminUserId(): number {
  const db = getDatabase();
  const config = getConfig();
  const user = db
    .prepare("SELECT id FROM users WHERE telegram_id = ?")
    .get(config.ADMIN_TELEGRAM_ID) as { id: number } | undefined;
  return user?.id ?? 1;
}

function birthdayMatchesDate(dob: string, mmdd: string): boolean {
  // dob is YYYY-MM-DD, mmdd is MM-DD
  return dob.slice(5) === mmdd;
}

function getAge(dob: string, year: number): number {
  const birthYear = parseInt(dob.slice(0, 4), 10);
  return year - birthYear;
}

export function getTodayAndTomorrowBirthdays(userId: number, timezone: string): {
  today: Array<FamilyMember & { turningAge: number | null }>;
  tomorrow: Array<FamilyMember & { turningAge: number | null }>;
} {
  const members = listFamilyMembers(userId).filter((m) => m.date_of_birth);

  const now = new Date();
  const todayMmDd = formatInTimeZone(now, timezone, "MM-dd");
  const todayYear = parseInt(formatInTimeZone(now, timezone, "yyyy"), 10);

  const tomorrowDate = new Date(now.getTime() + 86400000);
  const tomorrowMmDd = formatInTimeZone(tomorrowDate, timezone, "MM-dd");
  const tomorrowYear = parseInt(formatInTimeZone(tomorrowDate, timezone, "yyyy"), 10);

  const today = members
    .filter((m) => birthdayMatchesDate(m.date_of_birth!, todayMmDd))
    .map((m) => ({
      ...m,
      turningAge: m.date_of_birth ? getAge(m.date_of_birth, todayYear) : null,
    }));

  const tomorrow = members
    .filter((m) => birthdayMatchesDate(m.date_of_birth!, tomorrowMmDd))
    .map((m) => ({
      ...m,
      turningAge: m.date_of_birth ? getAge(m.date_of_birth, tomorrowYear) : null,
    }));

  return { today, tomorrow };
}

export async function checkBirthdays(bot: Bot) {
  const log = getLogger();
  const config = getConfig();
  const chatId = config.GROUP_CHAT_ID ?? config.ADMIN_TELEGRAM_ID;
  const timezone = config.DEFAULT_TIMEZONE;
  const adminUserId = getAdminUserId();

  const { today, tomorrow } = getTodayAndTomorrowBirthdays(adminUserId, timezone);

  for (const member of today) {
    const ageStr = member.turningAge !== null ? ` — turning ${member.turningAge} today!` : "!";
    const msg = `🎂 *Happy Birthday, ${member.name}!* 🎉\n\nToday is ${member.name}'s birthday${ageStr} Wishing them a wonderful day! 🎈`;
    try {
      await bot.api
        .sendMessage(chatId, msg, { parse_mode: "Markdown" })
        .catch(() => bot.api.sendMessage(chatId, msg));
      log.info({ name: member.name }, "Sent birthday message");
    } catch (err) {
      log.error({ err, name: member.name }, "Failed to send birthday message");
    }
  }

  for (const member of tomorrow) {
    const ageStr = member.turningAge !== null ? ` (turning ${member.turningAge})` : "";
    const msg = `🎁 *Reminder:* Tomorrow is ${member.name}'s birthday${ageStr}! Don't forget to wish them well 🎂`;
    try {
      await bot.api
        .sendMessage(chatId, msg, { parse_mode: "Markdown" })
        .catch(() => bot.api.sendMessage(chatId, msg));
      log.info({ name: member.name }, "Sent birthday eve reminder");
    } catch (err) {
      log.error({ err, name: member.name }, "Failed to send birthday eve reminder");
    }
  }
}
