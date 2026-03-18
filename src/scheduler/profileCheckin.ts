import { Bot } from "grammy";
import { getConfig } from "../config.js";
import { getLogger } from "../utils/logger.js";
import { getDatabase } from "../db/database.js";
import {
  getFamilyMembersWithTelegramId,
  getProfile,
  updateProfile,
  PROFILE_FIELDS,
} from "../db/repositories/familyRepo.js";
import { chat } from "../ai/agent.js";
import { formatInTimeZone } from "date-fns-tz";

function getAdminUserId(): number {
  const db = getDatabase();
  const config = getConfig();
  const user = db
    .prepare("SELECT id FROM users WHERE telegram_id = ?")
    .get(config.ADMIN_TELEGRAM_ID) as { id: number } | undefined;
  return user?.id ?? 1;
}

function getMissingFields(profile: Record<string, unknown>): string[] {
  return PROFILE_FIELDS.filter(
    (f) => profile[f] == null || profile[f] === ""
  );
}

export async function sendProfileCheckins(bot: Bot) {
  const log = getLogger();
  const config = getConfig();
  const adminUserId = getAdminUserId();
  const timezone = config.DEFAULT_TIMEZONE;

  const members = getFamilyMembersWithTelegramId(adminUserId);
  if (members.length === 0) {
    log.info("No family members with telegram_id, skipping check-ins");
    return;
  }

  const today = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");

  for (const member of members) {
    const profile = getProfile(member.id);

    // Skip if already checked in today
    if (profile.last_check_in_date === today) {
      log.info({ name: member.name }, "Already checked in today, skipping");
      continue;
    }

    const missing = getMissingFields(profile);
    if (missing.length === 0) {
      log.info({ name: member.name }, "Profile is complete, skipping check-in");
      continue;
    }

    // Pick a random missing field
    const field = missing[Math.floor(Math.random() * missing.length)];

    // Use AI to craft a natural question
    const prompt = `You are Susie, a friendly family assistant. You need to ask ${member.name} (${member.relationship ?? "family member"}) a casual question to learn about them.

The profile field you want to fill is: "${field.replace(/_/g, " ")}"

Rules:
- Make it feel like a casual, friendly check-in — NOT a survey or interview
- Use their first name
- Add a relevant emoji
- Keep it to 1-2 sentences max
- Make it feel natural and conversational
- Don't explain WHY you're asking
- Vary the style — sometimes playful, sometimes curious, sometimes sharing-related

${member.age && member.age < 13 ? "This is a child — keep the question age-appropriate and fun." : ""}

Examples of good questions:
- "Hey James! Quick one — what's your go-to coffee order? ☕"
- "Kristy! If you could go on holiday anywhere next year, where would it be? ✈️"
- "Random question — what's everyone's favourite movie at the moment? 🎬"

Write ONLY the message to send. Nothing else.`;

    try {
      const message = await chat(adminUserId, config.ADMIN_TELEGRAM_ID, prompt);

      await bot.api.sendMessage(member.telegram_id!, message);

      // Record check-in
      updateProfile(member.id, adminUserId, {
        last_check_in_date: today,
        last_check_in_field: field,
      });

      log.info(
        { name: member.name, field },
        "Sent profile check-in"
      );
    } catch (err) {
      log.error(
        { err, name: member.name, telegramId: member.telegram_id },
        "Failed to send profile check-in"
      );
    }
  }
}

/**
 * Schedule check-ins at a random time between 1pm and 6pm.
 * Called once from the cron runner at 1pm; uses setTimeout for the random delay.
 */
export function scheduleRandomCheckin(bot: Bot) {
  const log = getLogger();
  const delayMs = Math.floor(Math.random() * 5 * 60 * 60 * 1000); // 0-5 hours
  const delayMins = Math.round(delayMs / 60000);

  log.info({ delayMins }, "Profile check-in scheduled");

  setTimeout(async () => {
    try {
      await sendProfileCheckins(bot);
    } catch (err) {
      log.error({ err }, "Profile check-in error");
    }
  }, delayMs);
}
