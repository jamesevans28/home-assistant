import { CommandContext, Context } from "grammy";
import { getConfig } from "../../config.js";
import {
  isGoogleConfigured,
  isGoogleAuthenticated,
  getAuthUrl,
  handleAuthCode,
} from "../../google/auth.js";
import { getLogger } from "../../utils/logger.js";

// Track users waiting to paste an auth code
const pendingAuth = new Set<number>();

export async function googleCommand(ctx: CommandContext<Context>) {
  const config = getConfig();
  const from = ctx.from;
  if (!from || from.id !== config.ADMIN_TELEGRAM_ID) {
    return ctx.reply("This command is admin-only.");
  }

  if (!isGoogleConfigured()) {
    return ctx.reply(
      "Google integration is not configured.\n\n" +
        "Add these to your .env:\n" +
        "GOOGLE_CLIENT_ID=...\n" +
        "GOOGLE_CLIENT_SECRET=...\n\n" +
        "Get them from Google Cloud Console → Credentials → OAuth 2.0 Client ID (Desktop app)"
    );
  }

  if (isGoogleAuthenticated()) {
    return ctx.reply(
      "Google is already connected! You can:\n" +
        '• Ask "what\'s on my Google Calendar today?"\n' +
        '• Ask "check my email"\n' +
        '• Ask "send an email to ..."'
    );
  }

  const authUrl = getAuthUrl();
  pendingAuth.add(from.id);

  await ctx.reply(
    "Let's connect your Google account.\n\n" +
      "1. Click the link below\n" +
      "2. Sign in and grant access\n" +
      "3. Copy the authorization code\n" +
      "4. Paste it back here\n\n" +
      authUrl
  );
}

export async function handleGoogleAuthCode(ctx: Context): Promise<boolean> {
  const from = ctx.from;
  const text = ctx.message?.text?.trim();

  if (!from || !text || !pendingAuth.has(from.id)) return false;

  // Auth codes are typically 40-100 chars, start with "4/"
  if (!text.startsWith("4/") && text.length < 20) return false;

  const log = getLogger();

  try {
    await handleAuthCode(text);
    pendingAuth.delete(from.id);
    await ctx.reply(
      "Google connected successfully!\n\n" +
        "You can now:\n" +
        '• "What\'s on my calendar today?"\n' +
        '• "Check my emails"\n' +
        '• "Send an email to john@example.com about ..."\n' +
        '• "Add a meeting to my Google Calendar"'
    );
    return true;
  } catch (err) {
    log.error({ err }, "Google OAuth code exchange failed");
    pendingAuth.delete(from.id);
    await ctx.reply(
      "Failed to authenticate. The code may have expired.\n" +
        "Try /google again to get a fresh link."
    );
    return true;
  }
}
