# syntax=docker/dockerfile:1.7
# =====================================================================
# Solid Mini Growth Engine — image produksi (multi-stage)
#   target "api"       → NestJS API, juga dipakai worker BullMQ & job migrasi
#   target "dashboard" → Next.js (output standalone)
# Build dari root repository:
#   docker build -f infrastructure/docker/Dockerfile --target api -t smge-api .
# =====================================================================

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
# openssl dibutuhkan Prisma engine; ca-certificates untuk HTTPS keluar (OpenAI, TikTok)
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# ---------------------------------------------------------------- build
FROM base AS build
# Manifest dulu agar layer instalasi dependency ter-cache
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/
COPY packages/types/package.json packages/types/
COPY packages/database/prisma packages/database/prisma
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm build:packages \
 && pnpm --filter @smge/api build

# URL API internal "dibakukan" ke rewrite Next.js saat build (Nginx tetap meneruskan /api langsung ke API)
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL \
    NEXT_OUTPUT=standalone
RUN pnpm --filter @smge/dashboard build

# ---------------------------------------------------------------- api / worker / migrate
FROM base AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/api ./apps/api
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ---------------------------------------------------------------- dashboard
FROM node:22-bookworm-slim AS dashboard
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/dashboard/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/dashboard/server.js"]
