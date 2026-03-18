import { Bot } from "grammy";
import { getConfig } from "../config.js";
import { getLogger } from "../utils/logger.js";
import { getDatabase } from "../db/database.js";
import { getAllFavouriteTeams } from "../db/repositories/familyRepo.js";
import { chat } from "../ai/agent.js";
import { splitMessage } from "../utils/telegram.js";
import { formatInTimeZone } from "date-fns-tz";

function getAdminUserId(): number {
  const db = getDatabase();
  const config = getConfig();
  const user = db
    .prepare("SELECT id FROM users WHERE telegram_id = ?")
    .get(config.ADMIN_TELEGRAM_ID) as { id: number } | undefined;
  return user?.id ?? 1;
}

export async function checkGameDay(bot: Bot) {
  const log = getLogger();
  const config = getConfig();
  const chatId = config.GROUP_CHAT_ID ?? config.ADMIN_TELEGRAM_ID;
  const timezone = config.DEFAULT_TIMEZONE;
  const adminUserId = getAdminUserId();

  const teams = getAllFavouriteTeams(adminUserId);
  if (teams.length === 0) {
    log.info("No favourite teams configured, skipping game day check");
    return;
  }

  const today = formatInTimeZone(new Date(), timezone, "EEEE d MMMM yyyy");

  const teamList = teams
    .map((t) => `- ${t.team} (followed by: ${t.members.join(", ")})`)
    .join("\n");

  const prompt = `Today is ${today}. Check if any of these teams are playing TODAY or TONIGHT:

${teamList}

For each team that IS playing today/tonight, provide:
- Who they are playing against
- What time the game starts (in Australian Eastern time)
- Where the game is (venue)
- What competition/league it is
- Which family members follow that team

Format your response as a group chat message starting with "🏟️ **Game Day!**"
Use bullet points for each game. Include the family member names who follow each team.
If a game is on TV, mention the channel if you can find it.

If NONE of the teams are playing today, respond with exactly: [NO_GAMES]

IMPORTANT: Search thoroughly — try multiple sources. Check official league sites, ESPN, Fox Sports, Google Sports. Do NOT give up after one failed search.`;

  try {
    const response = await chat(adminUserId, config.ADMIN_TELEGRAM_ID, prompt);

    if (response.includes("[NO_GAMES]")) {
      log.info("No games today for tracked teams");
      return;
    }

    const chunks = splitMessage(response);
    for (const chunk of chunks) {
      await bot.api
        .sendMessage(chatId, chunk, { parse_mode: "Markdown" })
        .catch(() => bot.api.sendMessage(chatId, chunk));
    }

    log.info("Game day alert sent");
  } catch (err) {
    log.error({ err }, "Failed to send game day alert");
  }
}
