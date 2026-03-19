import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  GITHUB_TOKEN: z.string().min(1, "GITHUB_TOKEN is required"),
  DB_PATH: z.string().default("./data/openclaw.db"),
  ADMIN_TELEGRAM_ID: z.coerce.number().int().positive(),
  DEFAULT_TIMEZONE: z.string().default("Australia/Melbourne"),
  SUGGESTION_CRON: z.string().default("0 8 * * *"),
  GITHUB_REPO_URL: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().default("urn:ietf:wg:oauth:2.0:oob"),
  GOOGLE_TOKEN_PATH: z.string().default("./data/google-token.json"),
  MORNING_DIGEST_CRON: z.string().default("30 6 * * *"),
  GROUP_CHAT_ID: z.coerce.number().int().optional(),
  OPENWEATHER_API_KEY: z.string().optional(),
  WEATHER_LOCATION: z.string().default("Melbourne,AU"),
  EMAIL_CHECK_CRON: z.string().default("*/30 * * * *"),
  ALLOWED_TELEGRAM_IDS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((id) => parseInt(id.trim(), 10)).filter((id) => !isNaN(id) && id > 0)),
  FIXTURE_REFRESH_CRON: z.string().default("0 4 * * 1"),
  RESULTS_REFRESH_CRON: z.string().default("0 6 * * *"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;
  _config = envSchema.parse(process.env);
  return _config;
}

export function getConfig(): Config {
  if (!_config) throw new Error("Config not loaded. Call loadConfig() first.");
  return _config;
}

// Hardcoded allowed users (move to ALLOWED_TELEGRAM_IDS env var later)
const HARDCODED_ALLOWED_IDS = [
  8275392588, // James
  8696245346, // Kristy
];

/**
 * Check if a Telegram user ID is allowed to use the bot.
 * The admin is always allowed. Hardcoded IDs are always allowed.
 * If ALLOWED_TELEGRAM_IDS env var is set, those are also allowed.
 */
export function isAllowedUser(telegramId: number): boolean {
  const config = getConfig();
  if (telegramId === config.ADMIN_TELEGRAM_ID) return true;
  if (HARDCODED_ALLOWED_IDS.includes(telegramId)) return true;
  if (config.ALLOWED_TELEGRAM_IDS.length > 0) {
    return config.ALLOWED_TELEGRAM_IDS.includes(telegramId);
  }
  return false;
}
