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
- **Google APIs**: OAuth 2.0, Calendar, Gmail via `googleapis`
- **Scheduling**: node-cron for reminders (every 60s) and daily suggestions
- **Date Parsing**: chrono-node for natural language dates
- **Deployment**: Docker on Synology NAS with auto-update via `/update` command

## Project Structure

```
src/
├── index.ts              # Entry point
├── config.ts             # Env config (Zod schema)
├── ai/                   # Copilot SDK agent, system prompt, tools
├── bot/                  # grammY bot, commands, message handlers
├── db/                   # SQLite database, migrations, repositories
├── scheduler/            # Cron jobs for reminders and suggestions
├── google/               # Google OAuth, Calendar, Gmail wrappers
└── utils/                # Logger, date parsing, message splitting
```

## Development

```bash
npm install
npm run build        # tsc
npm start            # node dist/index.js
```

### Environment Variables

Required: `TELEGRAM_BOT_TOKEN`, `GITHUB_TOKEN`, `ADMIN_TELEGRAM_ID`

Optional: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUGGESTION_CRON`, `DB_PATH`, `DEFAULT_TIMEZONE` (default: Australia/Melbourne), `GITHUB_REPO_URL`

## Key Design Notes

- All dates stored in UTC, formatted with user's timezone
- AI sessions cached per user for context continuity
- Group chat conversations have a 2-minute active timeout
- The AI abstraction is kept clean enough to swap to OpenAI if Copilot SDK proves unstable
- Custom tools: reminders, events, family, suggestions, Google Calendar, Gmail
