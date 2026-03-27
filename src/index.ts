import { existsSync, unlinkSync } from "fs";
import { createRequire } from "module";
import { loadConfig, getConfig } from "./config.js";
import { initLogger } from "./utils/logger.js";
import { initDatabase, closeDatabase } from "./db/database.js";
import { createBot } from "./bot/bot.js";
import { initAgent, stopAgent } from "./ai/agent.js";
import { startScheduler } from "./scheduler/cronRunner.js";
import { seedDefaultAliases } from "./db/repositories/fixtureRepo.js";
import { checkAndRefreshFixtures } from "./scheduler/fixtureRefresher.js";
import { startDashboard } from "./web/server.js";

/** Send a message to admin via Telegram HTTP API (works before bot is started) */
async function notifyAdmin(text: string): Promise<void> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.ADMIN_TELEGRAM_ID;
    if (!token || !chatId) return;

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: Number(chatId), text }),
    });
  } catch {
    // Best-effort — don't throw if notification itself fails
  }
}

function getVersion(): string {
  const require = createRequire(import.meta.url);
  const pkg = require("../package.json");
  return pkg.version;
}

async function notifyUpdateIfNeeded(
  bot: ReturnType<typeof createBot>,
  log: ReturnType<typeof initLogger>,
) {
  const flagPath = "/tmp/openclaw-updated";
  if (!existsSync(flagPath)) return;

  unlinkSync(flagPath);

  const config = loadConfig();
  const chatId = config.GROUP_CHAT_ID ?? config.ADMIN_TELEGRAM_ID;
  const version = getVersion();

  try {
    await bot.api.sendMessage(chatId, `🤖 Susie has been updated to v${version}`);
    log.info({ version, chatId }, "Sent update notification");
  } catch (err) {
    log.error({ err }, "Failed to send update notification");
  }
}

async function main() {
  // Foundation
  loadConfig();
  const log = initLogger();
  initDatabase();

  log.info("OpenClaw starting...");

  // AI Agent
  await initAgent();

  // Bot
  const bot = createBot();

  // Scheduler
  startScheduler(bot);

  // Seed team aliases and check if fixtures need loading
  seedDefaultAliases();
  await checkAndRefreshFixtures(bot);

  // Dashboard web server
  const dashboardServer = startDashboard(getConfig().DASHBOARD_PORT);

  // Graceful shutdown
  const shutdown = async () => {
    log.info("Shutting down...");
    dashboardServer.close();
    await bot.stop();
    await stopAgent();
    closeDatabase();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start bot (don't await — bot.start() resolves when bot stops)
  bot
    .start({
      onStart: async (info) => {
        log.info({ username: info.username }, "OpenClaw bot is running");
        await notifyUpdateIfNeeded(bot, log);
      },
    })
    .catch((err) => {
      log.error({ err }, "Bot polling error");
    });
}

// Global handlers for uncaught errors — notify admin before crashing
process.on("uncaughtException", async (err) => {
  console.error("Uncaught exception:", err);
  await notifyAdmin(`🔴 Susie crashed (uncaught exception):\n${err.message}`);
  process.exit(1);
});

process.on("unhandledRejection", async (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error("Unhandled rejection:", reason);
  await notifyAdmin(`🔴 Susie unhandled rejection:\n${msg}`);
});

main().catch(async (err) => {
  console.error("Fatal error:", err);
  const msg = err instanceof Error ? err.message : String(err);
  await notifyAdmin(`🔴 Susie failed to start:\n${msg}`);
  process.exit(1);
});
