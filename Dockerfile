FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Prune devDependencies so the final image only has production deps
RUN npm prune --omit=dev

FROM node:20-alpine

RUN apk add --no-cache git

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY src/db/migrations ./migrations
COPY --from=builder /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

ENV NODE_ENV=production

VOLUME ["/app/data"]

ENTRYPOINT ["./entrypoint.sh"]
