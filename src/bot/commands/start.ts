import { CommandContext, Context } from "grammy";
import { upsertUser } from "../../db/repositories/userRepo.js";
import { getConfig } from "../../config.js";

export function startCommand(ctx: CommandContext<Context>) {
  const config = getConfig();
  const from = ctx.from;
  if (!from) return;

  const isAdmin = from.id === config.ADMIN_TELEGRAM_ID;
  const name = from.first_name ?? from.username ?? "there";

  upsertUser(from.id, name, isAdmin);

  return ctx.reply(
    `Hey ${name}! I'm OpenClaw, your personal home & life assistant.\n\n` +
      `Here's what I can do:\n` +
      `• Chat naturally — just send me a message\n` +
      `• Set reminders — "remind me to pick up the kids at 3pm"\n` +
      `• Manage your schedule — "what's on today?"\n` +
      `• Track family members — /family\n` +
      `• Get suggestions — "suggest a dinner idea"\n\n` +
      `Type /help for all commands.`
  );
}
