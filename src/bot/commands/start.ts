import { CommandContext, Context } from "grammy";
import { upsertUser } from "../../db/repositories/userRepo.js";
import { getConfig, isAllowedUser } from "../../config.js";

export function startCommand(ctx: CommandContext<Context>) {
  const config = getConfig();
  const from = ctx.from;
  if (!from) return;

  // Only allowed users can register
  if (!isAllowedUser(from.id)) {
    return ctx.reply("Sorry, this bot is private. Contact the admin if you need access.");
  }

  const isAdmin = from.id === config.ADMIN_TELEGRAM_ID;
  const name = from.first_name ?? from.username ?? "there";

  upsertUser(from.id, name, isAdmin);

  return ctx.reply(
    `Hey ${name}! I'm Susie, your friendly household assistant for the Evans family.\n\n` +
      `I'm here to help keep things running smoothly! Here's a few things I can help with:\n\n` +
      `• Just chat with me — ask me anything!\n` +
      `• Reminders — "remind me to pick up the kids at 3pm"\n` +
      `• Calendar — "what's on today?" or "what's happening this week?"\n` +
      `• Family info — /family\n` +
      `• Meal & activity ideas — "what should we have for dinner?"\n` +
      `• Email — "check my emails" or "send an email to..."\n\n` +
      `Just send me a message anytime — I'm always here! Type /help if you want to see all the commands.`
  );
}
