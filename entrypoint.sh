#!/bin/sh
set -e

# If GITHUB_REPO_URL is set and .git exists, pull latest code
if [ -n "$GITHUB_REPO_URL" ] && [ -d ".git" ]; then
  echo "Pulling latest code from $GITHUB_REPO_URL..."
  git pull origin main || echo "Git pull failed, continuing with existing code"
  npm install --production
  npm run build
fi

echo "Starting OpenClaw..."
exec node dist/index.js
