import { CommandContext, Context } from "grammy";
import { chat } from "../../ai/agent.js";
import { getUserByTelegramId } from "../../db/repositories/userRepo.js";
import { splitMessage } from "../../utils/telegram.js";

export async function scheduleCommand(ctx: CommandContext<Context>) {
  const from = ctx.from;
  if (!from) return;

  const user = getUserByTelegramId(from.id);
  if (!user) {
    return ctx.reply("Please send /start first.");
  }

  await ctx.replyWithChatAction("typing");

  const query = ctx.match || "today";
  const response = await chat(
    user.id,
    from.id,
    `Show me my schedule for ${query}`
  );

  const chunks = splitMessage(response);
  for (const chunk of chunks) {
    await ctx.reply(chunk, { parse_mode: "Markdown" }).catch(() => ctx.reply(chunk));
  }
}
