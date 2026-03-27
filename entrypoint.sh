#!/bin/sh
set -e

# Send an error message to the admin via Telegram (best-effort)
notify_error() {
  if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$ADMIN_TELEGRAM_ID" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${ADMIN_TELEGRAM_ID}" \
      --data-urlencode "text=$1" \
      >/dev/null 2>&1 || true
  fi
}

# Remove any stale update flag
rm -f /tmp/openclaw-updated

# Symlink migrations for backward compat (code may reference /app/migrations)
if [ -d "src/db/migrations" ] && [ ! -e "migrations" ]; then
  ln -s src/db/migrations migrations
  echo "Created migrations symlink"
fi

# Git config — safe directory + disable SSL verify (Synology CA certs issue)
if [ -d ".git" ]; then
  git config --global --add safe.directory /app
  git config --global http.sslVerify false
fi

# Set up git credentials from GITHUB_TOKEN if available
if [ -n "$GITHUB_TOKEN" ] && [ -n "$GITHUB_REPO_URL" ] && [ -d ".git" ]; then
  # Rewrite remote URL to include token for private repo access
  AUTH_URL=$(echo "$GITHUB_REPO_URL" | sed "s|https://|https://${GITHUB_TOKEN}@|")
  git remote set-url origin "$AUTH_URL" 2>/dev/null || true
fi

# Auto-update from GitHub FIRST (before anything else)
if [ -n "$GITHUB_REPO_URL" ] && [ -d ".git" ]; then
  echo "Checking for updates..."
  echo "Current version: $(node -p "require('./package.json').version" 2>/dev/null || echo 'unknown')"
  echo "Git remote: $(git remote get-url origin 2>/dev/null | sed 's|://[^@]*@|://***@|')"
  echo "Current commit: $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

  # Fetch latest from remote
  FETCH_OUTPUT=$(git fetch origin main 2>&1) || {
    echo "WARNING: git fetch failed: $FETCH_OUTPUT"
    notify_error "⚠️ Susie startup: git fetch failed
$FETCH_OUTPUT"
  }

  LOCAL_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo 'unknown')
  REMOTE_COMMIT=$(git rev-parse origin/main 2>/dev/null || echo 'unknown')
  echo "Local commit:  $LOCAL_COMMIT"
  echo "Remote commit: $REMOTE_COMMIT"

  if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
    echo "Already up to date."
  else
    echo "Update available, resetting to origin/main..."
    RESET_OUTPUT=$(git reset --hard origin/main 2>&1) || {
      echo "WARNING: git reset failed: $RESET_OUTPUT"
      notify_error "⚠️ Susie startup: git reset --hard failed
$RESET_OUTPUT"
    }
    git clean -fd 2>&1

    echo "Updated!"
    echo "New version: $(node -p "require('./package.json').version" 2>/dev/null || echo 'unknown')"
    echo "New commit: $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
    rm -f dist/index.js
    touch /tmp/openclaw-updated
  fi
fi

# Check if node_modules has the wrong platform binaries (e.g. macOS on Linux)
if [ -d "node_modules/better-sqlite3" ]; then
  if ! node -e "require('better-sqlite3')" 2>/dev/null; then
    echo "Native modules incompatible with this platform, reinstalling..."
    rm -rf node_modules
  fi
fi

# Ensure node_modules exist (first run or after wiping)
if [ ! -d "node_modules" ] || [ ! -d "node_modules/grammy" ]; then
  echo "Installing dependencies..."
  if ! npm install 2>&1; then
    notify_error "⚠️ Susie startup: npm install failed — check Docker logs"
    echo "ERROR: npm install failed"
    exit 1
  fi
fi

# Build if needed (first run, after update, or after wipe)
if [ ! -f "dist/index.js" ]; then
  echo "Building..."
  if ! npm run build 2>&1; then
    notify_error "⚠️ Susie startup: npm run build failed — check Docker logs"
    echo "ERROR: npm run build failed"
    exit 1
  fi
fi

echo "Starting OpenClaw..."
exec node dist/index.js
