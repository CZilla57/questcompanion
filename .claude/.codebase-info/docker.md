# Containers / Local Dev Environment

*Last Updated: 2026-09-08*

## Overview

A single multi-stage `Dockerfile` (repo root) builds both the web frontend and the API server into one production image; there is no `docker-compose` for local dev (no local Postgres container is provided — point `DATABASE_URL` at a real/dev Postgres instance instead). The image is deployed to **Render** (primary, `render.yaml`) and can alternatively deploy to **Railway** (`railway.json`) from the same Dockerfile.

## Dockerfile Stages

| Stage | Base | What it does |
|---|---|---|
| `base` | `node:24-slim` | Enables corepack, prepares pnpm |
| `deps` | `base` | Copies every package's `package.json` (not full source) + lockfile, runs `pnpm install --frozen-lockfile` — cached independently of source changes |
| `build-frontend` | `deps` | Copies full source, sets `PORT=5173`/`BASE_PATH=/`, runs `pnpm --filter @workspace/focusquest run build` |
| `build-api` | `deps` | Copies full source, runs `pnpm --filter @workspace/api-server run build` (esbuild bundle) |
| `production` | `base` | Assembles the final image: `node_modules` (root + api-server), `dist/` (API bundle), `dist/public` (built SPA), `dist/drizzle` (migration SQL — read at runtime by `migrate.mjs`), `certs/` (Supabase pooler's private CA, since its pooler chains to a private root CA) |

The API server serves the built SPA itself in production (`express.static` + SPA fallback in `artifacts/api-server/src/app.ts`) — there is no separate frontend container/CDN in this setup.

## Deploy Targets

| Service | Config | Health check | Notes |
|---|---|---|---|
| Render (primary) | `render.yaml` — service `questcompanion`, `plan: free`, `region: oregon` | `/api/healthz` | Production domain `getfocusquest.com` / `questcompanion.onrender.com`; env vars listed as `sync: false` (set manually in the dashboard) except `PORT=8080`, `NODE_ENV=production` |
| Railway (alternate) | `railway.json` | `/api/healthz` | `restartPolicyType: ON_FAILURE`, max 3 retries |

## Common Commands

| Command | Purpose |
|---------|---------|
| `docker build -t focusquest .` | Build the production image locally |
| `pnpm install` (root) | Install the whole workspace — required before any local dev, no container needed |
| `pnpm --filter @workspace/api-server run dev` | Run the API server locally (builds then starts, `NODE_ENV=development`) |
| `pnpm --filter @workspace/focusquest run dev` | Run the web app locally against Vite dev server |
| `pnpm --filter @workspace/db run migrate` | Apply pending migrations to whatever `DATABASE_URL` points at |

## Environment Variables

*(Names only — see `.env.example` at the repo root for the authoritative, documented list; never commit real values.)*

| Variable | Area |
|---|---|
| `DATABASE_URL`, `DATABASE_CA_CERT_PATH` | Postgres connection + TLS |
| `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `ISSUER_URL` | Auth0/OIDC |
| `ALLOWED_ORIGINS` | CORS allowlist |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` | Web Push |
| `CRON_SECRET` | Protects `POST /api/cron/tick` |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Text AI (Gemini) — unset degrades those features to 503 |
| `GROQ_API_KEY` | Voice transcription (Groq Whisper) — unset degrades to 503 |
| `RESEND_API_KEY`, `EMAIL_FROM` | Weekly recap email delivery |
| `HEARTBEAT_URL` | healthchecks.io dead-man's-switch ping (unset = no-op) |
| `RENDER_API_KEY`, `RENDER_SERVICE_ID` | Local-only, read-only Render inspection via `scripts/render-status.ts` — never set on Render itself |
| `PORT`, `NODE_ENV` | Server runtime basics |
| iOS equivalents (`FQ_API_SCHEME`, `FQ_API_HOST`, `FQ_AUTH0_DOMAIN`, `FQ_AUTH0_CLIENT_ID`) | Set via `ios/Config.xcconfig`/`Config.local.xcconfig`, not process env |
