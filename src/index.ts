import { loadConfig } from "./config.js";
import { initLogger } from "./utils/logger.js";
import { initDatabase, closeDatabase } from "./db/database.js";
import { createBot } from "./bot/bot.js";
import { initAgent, stopAgent } from "./ai/agent.js";
import { startScheduler } from "./scheduler/cronRunner.js";

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

  // Start bot
  await bot.start({
    onStart: (info) => {
      log.info({ username: info.username }, "OpenClaw bot is running");
    },
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
