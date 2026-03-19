FROM node:23-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_OPTIONS="--experimental-sqlite"

# Source code and .git come from volume mount (.:/app)
# entrypoint.sh handles: npm install, npm run build, then starts the app

ENTRYPOINT ["./entrypoint.sh"]
