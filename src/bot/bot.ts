import { Bot } from "grammy";
import { getConfig } from "../config.js";
import { getLogger } from "../utils/logger.js";
import { upsertUser } from "../db/repositories/userRepo.js";
import { startCommand } from "./commands/start.js";
import { helpCommand } from "./commands/help.js";
import { remindCommand } from "./commands/remind.js";
import { scheduleCommand } from "./commands/schedule.js";
import { familyCommand } from "./commands/family.js";
import { updateCommand } from "./commands/update.js";
import { googleCommand, handleGoogleAuthCode } from "./commands/google.js";
import { chatHandler } from "./handlers/chat.js";

export function createBot(): Bot {
  const config = getConfig();
  const log = getLogger();

  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  // Auth middleware — ensure user exists in DB for every message
  bot.use(async (ctx, next) => {
    const from = ctx.from;
    if (from) {
      const isAdmin = from.id === config.ADMIN_TELEGRAM_ID;
      const name = from.first_name ?? from.username ?? null;
      upsertUser(from.id, name, isAdmin);
    }
    await next();
  });

  // Commands
  bot.command("start", startCommand);
  bot.command("help", helpCommand);
  bot.command("remind", remindCommand);
  bot.command("schedule", scheduleCommand);
  bot.command("family", familyCommand);
  bot.command("update", updateCommand);
  bot.command("google", googleCommand);

  // Default: check for Google auth code first, then AI chat
  bot.on("message:text", async (ctx) => {
    const handled = await handleGoogleAuthCode(ctx);
    if (!handled) {
      await chatHandler(ctx);
    }
  });

  // Error handler
  bot.catch((err) => {
    log.error({ err: err.error, update: err.ctx.update }, "Bot error");
  });

  return bot;
}
