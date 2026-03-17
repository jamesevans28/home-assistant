import { CommandContext, Context } from "grammy";
import { exec } from "child_process";
import { promisify } from "util";
import { getConfig } from "../../config.js";
import { getLogger } from "../../utils/logger.js";

const execAsync = promisify(exec);

export async function updateCommand(ctx: CommandContext<Context>) {
  const config = getConfig();
  const log = getLogger();
  const from = ctx.from;

  if (!from || from.id !== config.ADMIN_TELEGRAM_ID) {
    return ctx.reply("This command is admin-only.");
  }

  if (!config.GITHUB_REPO_URL) {
    return ctx.reply("GITHUB_REPO_URL is not configured. Cannot self-update.");
  }

  await ctx.reply("Updating... pulling latest code from GitHub.");

  try {
    const { stdout, stderr } = await execAsync(
      "git pull origin main && npm install && npm run build",
      { cwd: process.cwd(), timeout: 120_000 }
    );

    log.info({ stdout, stderr }, "Update completed");
    await ctx.reply("Update complete, restarting...");

    // Exit gracefully — Docker will restart the container
    setTimeout(() => process.exit(0), 1000);
  } catch (err) {
    log.error({ err }, "Update failed");
    const message = err instanceof Error ? err.message : "Unknown error";
    await ctx.reply(`Update failed: ${message}`);
  }
}
