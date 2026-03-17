import { CommandContext, Context } from "grammy";
import { chat } from "../../ai/agent.js";
import { getUserByTelegramId } from "../../db/repositories/userRepo.js";
import { listFamilyMembers } from "../../db/repositories/familyRepo.js";
import { splitMessage } from "../../utils/telegram.js";

export async function familyCommand(ctx: CommandContext<Context>) {
  const from = ctx.from;
  if (!from) return;

  const user = getUserByTelegramId(from.id);
  if (!user) {
    return ctx.reply("Please send /start first.");
  }

  const action = ctx.match;

  // If no args, list family members directly
  if (!action) {
    const members = listFamilyMembers(user.id);
    if (members.length === 0) {
      return ctx.reply(
        "No family members added yet.\n\n" +
          "Tell me about your family, e.g.:\n" +
          '"Add my son Liam, age 7"'
      );
    }

    const list = members
      .map((m) => {
        let line = `- ${m.name}`;
        if (m.relationship) line += ` (${m.relationship})`;
        if (m.age) line += `, age ${m.age}`;
        return line;
      })
      .join("\n");

    return ctx.reply(`Your family:\n${list}`);
  }

  // Otherwise, pass to AI for handling
  await ctx.replyWithChatAction("typing");
  const response = await chat(user.id, from.id, `Family: ${action}`);
  const chunks = splitMessage(response);
  for (const chunk of chunks) {
    await ctx.reply(chunk, { parse_mode: "Markdown" }).catch(() => ctx.reply(chunk));
  }
}
