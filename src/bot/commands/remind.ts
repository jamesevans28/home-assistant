import { CommandContext, Context } from "grammy";
import { chat } from "../../ai/agent.js";
import { getUserByTelegramId } from "../../db/repositories/userRepo.js";
import { splitMessage } from "../../utils/telegram.js";

export async function remindCommand(ctx: CommandContext<Context>) {
  const from = ctx.from;
  if (!from) return;

  const user = getUserByTelegramId(from.id);
  if (!user) {
    return ctx.reply("Please send /start first.");
  }

  const text = ctx.match;
  if (!text) {
    return ctx.reply("Usage: /remind pick up the kids at 3pm");
  }

  await ctx.replyWithChatAction("typing");

  const response = await chat(user.id, from.id, `Remind me to ${text}`);
  const chunks = splitMessage(response);
  for (const chunk of chunks) {
    await ctx.reply(chunk, { parse_mode: "Markdown" }).catch(() => ctx.reply(chunk));
  }
}
