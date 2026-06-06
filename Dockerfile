# syntax=docker/dockerfile:1

# ── Builder ───────────────────────────────────────────────────────────────────
# Full toolchain so better-sqlite3 (a native addon) compiles, then build the TS.
FROM node:20-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
# Compile TS → dist, then copy the .sql migrations (tsc doesn't emit non-TS files),
# and drop dev dependencies so only the runtime closure is carried forward.
RUN npm run build \
  && cp -r src/db/migrations dist/db/migrations \
  && npm prune --omit=dev

# ── Runner ────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Non-default port (sits behind nginx). Override with -e PORT=… if needed.
ENV PORT=4001

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# SQLite file lives here; mount this as a volume so data survives container restarts.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 4001
CMD ["node", "dist/server.js"]
