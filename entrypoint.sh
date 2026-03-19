#!/bin/sh
set -e

# Remove any stale update flag
rm -f /tmp/openclaw-updated

# Auto-update from GitHub if configured
if [ -n "$GITHUB_REPO_URL" ] && [ -d ".git" ]; then
  echo "Checking for updates..."
  if git pull origin main 2>/dev/null | grep -q 'Already up to date'; then
    echo "Already up to date."
  else
    echo "Code updated, rebuilding..."
    npm install
    npm run build
    # Copy updated migrations
    cp -r src/db/migrations/* migrations/ 2>/dev/null || true
    # Signal the app that an update occurred
    touch /tmp/openclaw-updated
  fi
fi

echo "Starting OpenClaw..."
exec node dist/index.js
