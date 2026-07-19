FROM node:24-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# ── Install dependencies ─────────────────────────────────
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY lib/db/package.json lib/db/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY lib/api-spec/package.json lib/api-spec/
COPY lib/auth-web/package.json lib/auth-web/
COPY artifacts/api-server/package.json artifacts/api-server/
COPY artifacts/focusquest/package.json artifacts/focusquest/
COPY scripts/package.json scripts/
RUN pnpm install --frozen-lockfile

# ── Build frontend ───────────────────────────────────────
FROM deps AS build-frontend
COPY . .
ENV PORT=5173
ENV BASE_PATH=/
RUN pnpm --filter @workspace/focusquest run build

# ── Build API server ─────────────────────────────────────
FROM deps AS build-api
COPY . .
RUN pnpm --filter @workspace/api-server run build

# ── Production image ─────────────────────────────────────
FROM base AS production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/artifacts/api-server/node_modules ./artifacts/api-server/node_modules

COPY --from=build-api /app/artifacts/api-server/dist ./dist
COPY --from=build-frontend /app/artifacts/focusquest/dist/public ./dist/public
# Migration SQL must ship with the image — dist/migrate.mjs reads it at runtime.
COPY --from=build-api /app/lib/db/drizzle ./dist/drizzle

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Migrate before serving: a failed migration exits non-zero and aborts the boot
# rather than leaving a server running against a half-migrated database.
CMD ["sh", "-c", "node dist/migrate.mjs && exec node --enable-source-maps dist/index.mjs"]
