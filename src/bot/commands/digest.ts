import { Bot } from "grammy";
import { CommandContext, Context } from "grammy";
import { getConfig } from "../../config.js";
import { sendMorningDigest } from "../../scheduler/morningDigest.js";

export function createDigestCommand(bot: Bot) {
  return async (ctx: CommandContext<Context>) => {
    const config = getConfig();
    const from = ctx.from;

    if (!from || from.id !== config.ADMIN_TELEGRAM_ID) {
      return ctx.reply("Only the admin can trigger the digest.");
    }

    await ctx.reply("Generating digest... this may take a minute.");
    await sendMorningDigest(bot);
  };
}
