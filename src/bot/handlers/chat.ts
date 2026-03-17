import { Context } from "grammy";
import { chat } from "../../ai/agent.js";
import { getUserByTelegramId } from "../../db/repositories/userRepo.js";
import { saveMessage } from "../../db/repositories/messageRepo.js";
import { splitMessage } from "../../utils/telegram.js";
import { getLogger } from "../../utils/logger.js";
import { getConfig } from "../../config.js";

// Track active conversations in groups: "chatId:userId" -> expiry timestamp
// When the bot responds to someone, they can reply without @mentioning for 2 minutes
const CONVERSATION_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const activeConversations = new Map<string, number>();

function getConversationKey(chatId: number, userId: number): string {
  return `${chatId}:${userId}`;
}

function isInActiveConversation(chatId: number, userId: number): boolean {
  const key = getConversationKey(chatId, userId);
  const expiry = activeConversations.get(key);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    activeConversations.delete(key);
    return false;
  }
  return true;
}

function markConversationActive(chatId: number, userId: number): void {
  const key = getConversationKey(chatId, userId);
  activeConversations.set(key, Date.now() + CONVERSATION_TIMEOUT_MS);
}

const PASSIVE_PROMPT_PREFIX =
  `You are passively observing a family group chat message. ` +
  `The user did NOT address you directly. Analyze this message and decide: ` +
  `does it contain something actionable — a date, time, event, reminder, task, ` +
  `appointment, or schedule change? If YES, use your tools to create the appropriate ` +
  `reminder or event, then reply BRIEFLY confirming what you noted (e.g., "Got it — ` +
  `added soccer practice at 4pm to the calendar"). If NO, respond with exactly ` +
  `"[NO_ACTION]" and nothing else.\n\nMessage from {sender}: `;

export async function chatHandler(ctx: Context) {
  const log = getLogger();
  const config = getConfig();
  const from = ctx.from;
  const text = ctx.message?.text;

  if (!from || !text) return;

  const chatType = ctx.chat?.type;
  const isGroup = chatType === "group" || chatType === "supergroup";
  const botInfo = ctx.me;
  const chatId = ctx.chat!.id;
  const isMentioned = isGroup && text.includes(`@${botInfo.username}`);
  const isReply =
    isGroup && ctx.message?.reply_to_message?.from?.id === botInfo.id;
  const isInConvo = isGroup && isInActiveConversation(chatId, from.id);
  const isDirected = !isGroup || isMentioned || isReply || isInConvo;

  // Reset the timer on every message during an active conversation
  if (isInConvo) {
    markConversationActive(chatId, from.id);
  }

  // Get or create user — admin gets priority for group context
  const user = getUserByTelegramId(from.id);
  if (!user) {
    if (isDirected) {
      await ctx.reply("Please send /start first.");
    }
    return;
  }

  // Strip bot mention from message
  const cleanText = text.replace(`@${botInfo.username}`, "").trim();
  if (!cleanText) return;

  // Save every message for context
  const senderName = from.first_name ?? from.username ?? "Someone";
  saveMessage(user.id, "user", `[${senderName}]: ${cleanText}`);

  if (isDirected) {
    // Direct message or mention — full AI response
    await ctx.replyWithChatAction("typing");

    try {
      const response = await chat(user.id, from.id, cleanText);
      saveMessage(user.id, "assistant", response);

      // Keep the conversation active so user can reply without @mentioning
      if (isGroup) {
        markConversationActive(chatId, from.id);
      }

      const chunks = splitMessage(response);
      for (const chunk of chunks) {
        const opts: Parameters<Context["reply"]>[1] = {};
        if (isGroup) {
          opts.reply_parameters = { message_id: ctx.message!.message_id };
        }
        await ctx
          .reply(chunk, { ...opts, parse_mode: "Markdown" })
          .catch(() => ctx.reply(chunk, opts));
      }
    } catch (err) {
      log.error({ err, telegramId: from.id }, "Chat handler error");
      await ctx.reply("Sorry, something went wrong. Please try again.");
    }
  } else {
    // Passive group message — check if actionable
    // Use admin user for context (reminders go to the family)
    const adminUser = getUserByTelegramId(config.ADMIN_TELEGRAM_ID);
    const targetUser = adminUser ?? user;

    try {
      const prompt =
        PASSIVE_PROMPT_PREFIX.replace("{sender}", senderName) + cleanText;

      const response = await chat(targetUser.id, targetUser.telegram_id, prompt);

      // Only reply if the AI found something actionable
      if (response && !response.includes("[NO_ACTION]")) {
        saveMessage(targetUser.id, "assistant", response);

        const chunks = splitMessage(response);
        for (const chunk of chunks) {
          await ctx
            .reply(chunk, {
              reply_parameters: { message_id: ctx.message!.message_id },
              parse_mode: "Markdown",
            })
            .catch(() =>
              ctx.reply(chunk, {
                reply_parameters: { message_id: ctx.message!.message_id },
              })
            );
        }
      }
    } catch (err) {
      // Silently fail for passive messages — don't spam the group with errors
      log.error({ err, telegramId: from.id }, "Passive chat analysis error");
    }
  }
}
