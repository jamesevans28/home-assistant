FROM node:23-slim AS builder

WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/ scripts/
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:23-slim

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY src/db/migrations ./migrations

# Copy external dependencies and their transitive deps
# better-sqlite3: native bindings, must be external
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
# @github/copilot-sdk: uses import.meta.resolve internally, must be external
COPY --from=builder /app/node_modules/@github ./node_modules/@github
COPY --from=builder /app/node_modules/vscode-jsonrpc ./node_modules/vscode-jsonrpc
# grammy: uses node-fetch with agent/compress options, breaks when bundled
COPY --from=builder /app/node_modules/grammy ./node_modules/grammy
COPY --from=builder /app/node_modules/@grammyjs ./node_modules/@grammyjs
COPY --from=builder /app/node_modules/node-fetch ./node_modules/node-fetch
COPY --from=builder /app/node_modules/abort-controller ./node_modules/abort-controller
COPY --from=builder /app/node_modules/debug ./node_modules/debug
COPY --from=builder /app/node_modules/ms ./node_modules/ms
COPY --from=builder /app/node_modules/whatwg-url ./node_modules/whatwg-url
COPY --from=builder /app/node_modules/tr46 ./node_modules/tr46
COPY --from=builder /app/node_modules/webidl-conversions ./node_modules/webidl-conversions
COPY --from=builder /app/node_modules/event-target-shim ./node_modules/event-target-shim

COPY package.json package-lock.json ./
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

ENV NODE_ENV=production
ENV NODE_OPTIONS="--experimental-sqlite"

VOLUME ["/app/data"]

ENTRYPOINT ["./entrypoint.sh"]
