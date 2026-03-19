# Susie — House of Evans Telegram Home Assistant

A personal home and life assistant named **Susie**, delivered via Telegram, built with TypeScript and powered by GitHub Copilot SDK. Responds to @mentions, replies, or when "Susie" is mentioned by name in the group chat.

## What it does

- **Reminders & Tasks** - Create, list, complete reminders with optional daily/weekly/monthly recurrence
- **Calendar** - Local events + Google Calendar integration (all calendars, not just primary)
- **Family & Friends** - Store family/friend info (DOB, interests, dietary needs, etc.) with automatic birthday reminders (day before + on the day). Friends get private nudges; family get group announcements
- **Email** - Check Gmail, read, search, and send emails
- **Email Watcher** - Checks emails every 30 mins with rule-based processing:
  - **School (Compass)**: Follows news links, summarises to group chat, extracts events with reminders
  - **Coles orders**: Parses order confirmations, removes ordered items from shopping list
- **Shopping List** - Shared family list via natural language ("we need milk" → adds, "I got bread" → removes). Items from meals show their source (e.g. "mince (lasagne)")
- **Meal Planner** - Family meal library with tags (kid-friendly, quick, leftovers, GF), ingredient tracking, cook history. Suggests meals avoiding recent ones. Integrates with shopping list. Prompts for ingredients when adding new meals
- **Morning Digest** - Daily briefing with weather, calendar, reminders, upcoming events, birthdays, bin night, shopping list, sports/news
- **Bin Night Reminder** - Monday 6pm reminder with correct bins (green waste + recycling or rubbish, alternating weeks)
- **Birthday Reminders** - Day-before and on-the-day reminders for family and friends
- **Group Chat** - Responds to @mentions, replies, active conversations (2-min timeout), or when "Susie" is mentioned. Passive mode analyses messages for actionable items

## Tech Stack

- **Runtime**: Node.js 23 / TypeScript (ES2022, strict)
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
- **Container**: `node:23-slim` (Debian-based, NOT Alpine — the Copilot SDK bundles native `pty.node` compiled for glibc which doesn't work on Alpine/musl)
- **Node version**: Must be Node 23+ because the Copilot SDK's CLI subprocess requires `node:sqlite` (experimental, enabled via `NODE_OPTIONS=--experimental-sqlite`)
- **Timezone**: `Australia/Melbourne` (AEDT, GMT+11 in summer / AEST, GMT+10 in winter)
- **docker-compose**: single service, `restart: unless-stopped`, env from `.env`, data volume at `./data:/app/data`
- **Auto-update**: The entrypoint runs `git pull` on startup; if code changed, it runs `npm install` + `npm run build`
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
npm run build        # esbuild (bundles to dist/index.js, ~2.3MB)
npm start            # node dist/index.js
npm run dev          # tsx src/index.ts (dev mode, no build step)
```

### Build System

- **esbuild** is used instead of `tsc` for production builds — `tsc` OOMs on low-RAM systems due to large Google API types
- Output format is **ESM** (`.js`) with a banner shim that provides `require`, `__dirname`, and `__filename` for CJS compatibility
- The banner uses aliased imports (`__cr`, `__fu`, `__dn`) to avoid name collisions with bundled code
- Three external packages (not bundled, must be in `node_modules` at runtime):
  - `better-sqlite3` — native bindings, cannot be bundled
  - `@github/copilot-sdk` — uses `import.meta.resolve` internally which breaks when bundled
  - `grammy` — depends on `node-fetch` with `agent`/`compress` options; Node's native `fetch` doesn't support these, causing silent hanging when bundled
- A `postinstall` script (`scripts/fix-vscode-jsonrpc.js`) patches `vscode-jsonrpc` to add missing ESM export maps (the Copilot SDK imports `vscode-jsonrpc/node` without `.js` extension)
- `tsconfig.json` is still used for IDE type-checking and `tsx` dev mode, but not for production builds
- Do NOT switch back to `tsc` for builds — it will OOM on the Synology NAS
- Do NOT use the `googleapis` mega-package — it bundles ALL 300+ Google APIs (31MB). Use `@googleapis/calendar` and `@googleapis/gmail` instead
- Do NOT switch to Alpine-based Docker images — the Copilot SDK's bundled native modules require glibc
- Dockerfile only copies external dependencies to the final image (not the full `node_modules`), keeping the image small

### Environment Variables

Required: `TELEGRAM_BOT_TOKEN`, `GITHUB_TOKEN`, `ADMIN_TELEGRAM_ID`

Optional: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUGGESTION_CRON`, `DB_PATH`, `DEFAULT_TIMEZONE` (default: Australia/Melbourne), `GITHUB_REPO_URL`

## Versioning

- The version is stored in `package.json` `version` field
- **Bump the version every time changes are pushed to GitHub** — Claude should determine whether to increment patch (bug fixes, small tweaks) or minor (new features, significant changes) based on the size and complexity of the change
- On self-update (via `entrypoint.sh` git pull), the app sends a message to the group chat (or admin) announcing the new version
- The update flag file (`/tmp/openclaw-updated`) is set by the entrypoint and consumed by the app on startup

## Key Design Notes

- All dates stored in UTC, formatted with user's timezone via `date-fns-tz`
- The server runs in UTC (Docker default) — date parsing must convert to user's local timezone before resolving relative dates like "Thursday" or "tomorrow"
- Google Calendar queries all calendars (owned + shared), not just primary
- AI sessions cached per user with 30-minute TTL cleanup to prevent memory leaks
- Group chat conversations have a 2-minute active timeout
- The AI abstraction is kept clean enough to swap to OpenAI if Copilot SDK proves unstable
- Custom tools: reminders, events, family/friends, suggestions, shopping list, meal planner, Google Calendar, Gmail
- The bot is named **Susie** — responds to "Susie" in group chat (case-insensitive word boundary match)
