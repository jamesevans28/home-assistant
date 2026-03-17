# Installing OpenClaw on Synology NAS (Docker / Container Manager)

## Prerequisites

- Synology NAS with **Container Manager** (DSM 7.2+) or **Docker** package (DSM 7.1 and below)
- SSH access enabled on your NAS
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- A GitHub token with Copilot access (via `gh auth token` or a PAT)
- Your Telegram user ID (message [@userinfobot](https://t.me/userinfobot) to find it)

---

## Option A: Using Container Manager UI (Recommended)

### 1. Transfer the project to your NAS

Copy the project folder to your NAS via SMB/SSH. A good location is:

```
/volume1/docker/openclaw/
```

You can use `scp` from your Mac:

```bash
scp -r ~/home-assistant/ your-nas-user@your-nas-ip:/volume1/docker/openclaw/
```

### 2. Create the environment file

SSH into your NAS and create the `.env` file:

```bash
ssh your-nas-user@your-nas-ip
cd /volume1/docker/openclaw
cp .env.example .env
```

Edit `.env` with your values:

```bash
vi .env
```

Fill in the **required** values:

```env
TELEGRAM_BOT_TOKEN=your-bot-token-here
GITHUB_TOKEN=your-github-token-here
ADMIN_TELEGRAM_ID=your-telegram-id-here
```

Optional — for Google Calendar/Gmail integration:

```env
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

Optional — for automatic updates from GitHub on restart:

```env
GITHUB_REPO_URL=https://github.com/jamesevans28/home-assistant.git
```

### 3. Build and run with Container Manager

1. Open **Container Manager** in DSM
2. Go to **Project** → **Create**
3. Set the project name to `openclaw`
4. Set the path to `/volume1/docker/openclaw`
5. Container Manager will detect the `docker-compose.yml` automatically
6. Click **Build** then **Start**

### 4. Verify it's running

In Container Manager, check that the `openclaw` container shows as **Running**.

Then open Telegram and message your bot with `/start`.

---

## Option B: Using SSH + Docker Compose (Advanced)

### 1. Enable SSH on your NAS

**DSM** → **Control Panel** → **Terminal & SNMP** → **Enable SSH service**

### 2. SSH in and set up the project

```bash
ssh your-nas-user@your-nas-ip

# Create directory
sudo mkdir -p /volume1/docker/openclaw
cd /volume1/docker/openclaw
```

### 3. Clone the repo (or copy files)

```bash
# Option 1: Clone from GitHub
git clone https://github.com/jamesevans28/home-assistant.git .

# Option 2: Or just scp from your Mac (see Option A step 1)
```

### 4. Create and configure .env

```bash
cp .env.example .env
vi .env
```

Fill in the same values as Option A step 2.

### 5. Build and start

```bash
sudo docker compose up -d --build
```

### 6. Check logs

```bash
sudo docker compose logs -f openclaw
```

You should see:
```
Bot started successfully
Connected to database
```

---

## Data Persistence

The container stores all persistent data in the `data/` folder, which is mounted as a volume:

| File | Purpose |
|------|---------|
| `data/openclaw.db` | SQLite database (users, messages, reminders) |
| `data/google-token.json` | Google OAuth tokens (after linking Google account) |

**Back up the `data/` folder regularly** — it contains all your bot's state.

---

## Auto-Updates on Restart

If you set `GITHUB_REPO_URL` in your `.env`, the container will automatically pull the latest code from GitHub every time it restarts. This means you can push updates from your Mac and just restart the container on your NAS.

To restart after pushing new code:

```bash
# Via SSH
sudo docker compose restart openclaw

# Or via Container Manager UI: select container → Stop → Start
```

---

## Google Calendar / Gmail Setup

1. Message the bot with `/google`
2. Click the authorization link it sends you
3. Sign in with your Google account and copy the authorization code
4. Paste the code back to the bot in Telegram

> **Note:** Your Google Cloud project must be in "Testing" mode with your Gmail added as a test user. See the [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → OAuth consent screen → Audience → Test users.

---

## Updating the Container

When you make changes to the code:

```bash
# On your Mac — push changes
cd ~/home-assistant
git add -A && git commit -m "update" && git push

# On your NAS — rebuild and restart
ssh your-nas-user@your-nas-ip
cd /volume1/docker/openclaw
sudo docker compose up -d --build
```

Or if you have `GITHUB_REPO_URL` set, just restart the container — it auto-pulls.

---

## Troubleshooting

### Container won't start
```bash
sudo docker compose logs openclaw
```
Check for missing environment variables (ZodError means a required `.env` value is missing).

### Bot not responding in groups
1. Message [@BotFather](https://t.me/BotFather) → `/mybots` → select your bot
2. **Bot Settings** → **Group Privacy** → **Turn off**

### Google auth "Access blocked" error
Add your Gmail as a test user in Google Cloud Console (see Google section above).

### Permission issues on Synology
Synology Docker sometimes has permission issues with mounted volumes:
```bash
sudo chown -R 1000:1000 /volume1/docker/openclaw/data
```

### Check container status
```bash
sudo docker compose ps
```
