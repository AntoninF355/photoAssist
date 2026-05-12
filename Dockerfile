# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx svelte-kit sync
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-slim AS runner

WORKDIR /app

# sharp uses native binaries — copy node_modules from builder to keep the same platform
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=3000
# ORIGIN must match the URL the browser uses to reach the app (CSRF check)
ENV ORIGIN=http://localhost:3000
# RAW files can exceed the 512KB default; no hard cap needed here
ENV BODY_SIZE_LIMIT=Infinity

EXPOSE 3000

CMD ["node", "build"]
