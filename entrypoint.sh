#!/bin/sh
set -e

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
  if git pull origin main 2>/dev/null | grep -q 'Already up to date'; then
    echo "Already up to date."
  else
    echo "Code updated, will rebuild..."
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
  npm install
fi

# Build if needed (first run, after update, or after wipe)
if [ ! -f "dist/index.js" ]; then
  echo "Building..."
  npm run build
fi

echo "Starting OpenClaw..."
exec node dist/index.js
