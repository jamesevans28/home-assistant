import { existsSync, unlinkSync } from "fs";
import { createRequire } from "module";
import { loadConfig } from "./config.js";
import { initLogger } from "./utils/logger.js";
import { initDatabase, closeDatabase } from "./db/database.js";
import { createBot } from "./bot/bot.js";
import { initAgent, stopAgent } from "./ai/agent.js";
import { startScheduler } from "./scheduler/cronRunner.js";
import { seedDefaultAliases } from "./db/repositories/fixtureRepo.js";
import { checkAndRefreshFixtures } from "./scheduler/fixtureRefresher.js";

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

  // Graceful shutdown
  const shutdown = async () => {
    log.info("Shutting down...");
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

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
