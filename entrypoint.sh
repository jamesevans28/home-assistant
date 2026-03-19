#!/bin/sh
set -e

# Remove any stale update flag
rm -f /tmp/openclaw-updated

# Check if node_modules has the wrong platform binaries (e.g. macOS on Linux)
# If better-sqlite3's prebuilds don't match this OS, wipe and reinstall
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

# Ensure dist exists (first run or after wiping)
if [ ! -f "dist/index.js" ]; then
  echo "Building..."
  npm run build
fi

# Auto-update from GitHub if configured
if [ -n "$GITHUB_REPO_URL" ] && [ -d ".git" ]; then
  # Mark git directory as safe (mounted volume ownership may differ)
  git config --global --add safe.directory /app

  echo "Checking for updates..."
  if git pull origin main 2>/dev/null | grep -q 'Already up to date'; then
    echo "Already up to date."
  else
    echo "Code updated, rebuilding..."
    npm install
    npm run build
    # Signal the app that an update occurred
    touch /tmp/openclaw-updated
  fi
fi

echo "Starting OpenClaw..."
exec node dist/index.js
