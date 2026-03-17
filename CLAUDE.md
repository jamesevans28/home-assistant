# OpenClaw - Telegram Home Assistant

A personal home and life assistant delivered via Telegram, built with TypeScript and powered by GitHub Copilot SDK.

## What it does

- **Reminders & Tasks** - Create, list, complete reminders with optional daily/weekly/monthly recurrence
- **Calendar** - Local events + Google Calendar integration (all calendars, not just primary)
- **Family Tracking** - Store family member info (names, relationships, ages, notes)
- **Email** - Check Gmail, read, search, and send emails
- **Daily Suggestions** - Scheduled suggestions for meals, activities, chores
- **Group Chat** - Passive mode in group chats; analyzes messages for actionable items without spamming

## Tech Stack

- **Runtime**: Node.js 20 / TypeScript (ES2022, strict)
- **Bot Framework**: grammY (Telegram)
- **AI**: GitHub Copilot SDK (`@github/copilot-sdk`) — uses existing subscription, no extra API costs
- **Database**: SQLite via better-sqlite3 (WAL mode)
- **Google APIs**: `@googleapis/calendar` and `@googleapis/gmail` (individual packages, NOT the `googleapis` mega-package)
- **Google Auth**: `google-auth-library` (OAuth2Client directly, not via `google.auth`)
- **Scheduling**: node-cron for reminders (every 60s) and daily suggestions
- **Date Parsing**: chrono-node for natural language dates
- **Deployment**: Docker on Synology NAS with auto-update via `/update` command

## Deployment Environment

- **Host**: Synology NAS running Docker (low RAM — typically 1-2GB available)
- **Container**: `node:20-alpine` — must keep memory usage low
- **Timezone**: `Australia/Melbourne` (AEDT, GMT+11 in summer / AEST, GMT+10 in winter)
- **docker-compose**: single service, `restart: unless-stopped`, env from `.env`, data volume at `./data:/app/data`
- **Auto-update**: The entrypoint skips `npm ci` + rebuild if git reports "Already up to date"
- **Database file**: Stored in the `/app/data` volume so it persists across container rebuilds
- **SQL migrations**: Stored in `/app/migrations/` (copied from `src/db/migrations/` during Docker build), resolved via `process.cwd()` at runtime

## Project Structure

```
src/
├── index.ts              # Entry point
├── config.ts             # Env config (Zod schema)
├── ai/                   # Copilot SDK agent, system prompt, tools
├── bot/                  # grammY bot, commands, message handlers
├── db/                   # SQLite database, migrations, repositories
│   └── migrations/       # .sql migration files (copied to /app/migrations in Docker)
├── scheduler/            # Cron jobs for reminders and suggestions
├── google/               # Google OAuth, Calendar, Gmail wrappers
└── utils/                # Logger, date parsing, message splits
```

## Development

```bash
npm install
npm run build        # esbuild (bundles to dist/index.cjs, ~2.5MB)
npm start            # node dist/index.cjs
npm run dev          # tsx src/index.ts (dev mode, no build step)
```

### Build System

- **esbuild** is used instead of `tsc` for production builds — `tsc` OOMs on Alpine due to large Google API types
- Output format is **CJS** (`.cjs`) because several dependencies (`dotenv`, `vscode-jsonrpc`) use dynamic `require()` which breaks in ESM bundles
- `better-sqlite3` is the only external — it has native bindings and must be resolved from `node_modules` at runtime
- `tsconfig.json` is still used for IDE type-checking and `tsx` dev mode, but not for production builds
- Do NOT switch back to `tsc` for builds — it will OOM on the Synology NAS
- Do NOT use the `googleapis` mega-package — it bundles ALL 300+ Google APIs (31MB). Use `@googleapis/calendar` and `@googleapis/gmail` instead (~2.5MB total)
- Dockerfile prunes devDependencies (`npm prune --omit=dev`) before copying to the final image

### Environment Variables

Required: `TELEGRAM_BOT_TOKEN`, `GITHUB_TOKEN`, `ADMIN_TELEGRAM_ID`

Optional: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUGGESTION_CRON`, `DB_PATH`, `DEFAULT_TIMEZONE` (default: Australia/Melbourne), `GITHUB_REPO_URL`

## Key Design Notes

- All dates stored in UTC, formatted with user's timezone via `date-fns-tz`
- The server runs in UTC (Docker default) — date parsing must convert to user's local timezone before resolving relative dates like "Thursday" or "tomorrow"
- Google Calendar queries all calendars (owned + shared), not just primary
- AI sessions cached per user with 30-minute TTL cleanup to prevent memory leaks
- Group chat conversations have a 2-minute active timeout
- The AI abstraction is kept clean enough to swap to OpenAI if Copilot SDK proves unstable
- Custom tools: reminders, events, family, suggestions, Google Calendar, Gmail
