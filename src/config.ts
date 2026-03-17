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
