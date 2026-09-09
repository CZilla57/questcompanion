# Technology Landscape

*Last Updated: 2026-09-08*

## Source-of-Truth Files

| Information | File |
|-------------|------|
| Workspace layout | `pnpm-workspace.yaml` (packages: `artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts`; also holds the shared dependency `catalog:` block) |
| Root scripts | `package.json` (`build`, `typecheck`, `typecheck:libs`) |
| Per-package scripts | each package's own `package.json` (`dev`/`build`/`test`/`typecheck`) |
| TS compiler baseline | `tsconfig.base.json` (extended by every TS package); `tsconfig.json` (root project-reference graph for `lib/*`) |
| API contract (single source of truth) | `lib/api-spec/openapi.yaml` — generates both `lib/api-client-react` and `lib/api-zod` via `lib/api-spec/orval.config.ts` (`pnpm --filter @workspace/api-spec codegen`) |
| Database schema | `lib/db/src/schema/*.ts` (Drizzle) ; migrations in `lib/db/drizzle/*.sql` ; config `lib/db/drizzle.config.ts` |
| Container build | `Dockerfile` (multi-stage: deps → build-frontend → build-api → production) |
| Deploy config | `render.yaml` (Render, primary), `railway.json` (Railway, alternate) |
| CI | `.github/workflows/ci.yml` (typecheck/build + iOS simulator build), `.github/workflows/backup-cron.yml` (backup scheduler) |
| Env var reference | `.env.example` (root, api-server-focused); `ios/Config.xcconfig` / `ios/Config.local.xcconfig` (iOS) |
| iOS project | `ios/FocusQuest.xcodeproj`, `ios/README.md` |
| Threat model | `threat_model.md` (repo root) |
| Live product/design specs | `docs/superpowers/plans/*.md` and `docs/superpowers/specs/*.md` (dated design docs — read the relevant one before touching a feature area) |
| Ops runbooks | `docs/ops/pocket-gate.md` (iOS Shortcuts integration), `docs/ops/steady-ground.md` (cron/backup/export/deletion) |

## Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| Language | TypeScript `~5.9.3` (web/API/mobile), Swift 5.9+ (iOS) | Root `tsconfig.base.json`: strict-ish (`strictNullChecks`, `noImplicitAny`, `alwaysStrict`), `moduleResolution: "bundler"`, ESM everywhere (`"type": "module"`) |
| Backend framework | Express 5 (`artifacts/api-server`) | Not Fastify/Hono despite some plan-doc mentions of "Hono" — `package.json` confirms `express: ^5.2.1` |
| Backend runtime | Node 24 (`node:24-slim` in `Dockerfile`, `actions/setup-node` in CI) | ESM build via esbuild (`artifacts/api-server/build.mjs`) |
| Web frontend | React 19 + Vite 7 (`artifacts/focusquest`) | Router: `wouter`; server state: TanStack React Query v5 over a generated client; styling: Tailwind CSS v4 (CSS-first config, no `tailwind.config.js`) + shadcn/ui ("new-york" style) on Radix primitives; hero sprite rendering via `pixi.js`; PWA (manifest + service worker) |
| Mobile (RN) | Expo SDK 53 + Expo Router (`artifacts/focusquest-mobile`) | Early-phase client (~33 files): PKCE auth, focus timer, deep-link routing, Expo push registration. Superseded in priority by the native iOS app; see `docs/superpowers/specs/2026-08-11-ios-app-roadmap.md` |
| Mobile (native iOS) | Swift/SwiftUI, iOS 17.0+, Xcode 16 (`ios/FocusQuest`) | No SPM dependencies — first-party Apple frameworks only (SwiftUI, AuthenticationServices, WidgetKit, ActivityKit, UserNotifications, AppIntents). Widget extension: `ios/FocusQuestWidgets` |
| Database | PostgreSQL | Accessed via `pg` + Drizzle ORM (`drizzle-orm/node-postgres`) in `lib/db` |
| ORM / migrations | Drizzle ORM + Drizzle Kit | Schema-first (`lib/db/src/schema/*.ts`), SQL migrations generated to `lib/db/drizzle/*.sql`, applied at container boot by `artifacts/api-server/src/migrate.ts` |
| API contract / codegen | OpenAPI 3.1 (`lib/api-spec/openapi.yaml`) → orval → `lib/api-client-react` (TanStack Query hooks) + `lib/api-zod` (Zod schemas/types) | Never hand-edit the generated output under either package's `src/generated/` |
| Auth | Auth0 (OIDC) via `openid-client`, PKCE on all clients | Session model is server-side (Postgres `sessions` table), not JWT; iOS/RN exchange an Auth0 code for an opaque FocusQuest bearer session token at `/api/mobile-auth/token-exchange` |
| AI — text | Google Gemini (`gemini-3.1-flash-lite` default), OpenAI-compatible endpoint | `artifacts/api-server/src/lib/ai/client.ts`; gated on `GEMINI_API_KEY`, degrades to 503 when unset |
| AI — voice | Groq Whisper (`whisper-large-v3-turbo`) | `artifacts/api-server/src/lib/ai/transcribe-audio.ts`; gated on `GROQ_API_KEY` |
| Push | Web Push (VAPID, `web-push` package) + Expo Push (RN) + on-device local notifications/Live Activities (iOS, no APNs backend yet) | See `communication.md` |
| Email | Resend | `artifacts/api-server/src/lib/email/send-email.ts`, gated on `RESEND_API_KEY` |
| Testing | Vitest across every TS package; co-located `*.test.ts` next to the module it tests | No `supertest`/live-DB unit tests — network/DB boundaries are injected and stubbed |
| Build tooling | pnpm 11 workspaces, esbuild (API server bundling), Vite (web/mockup-sandbox), Metro (mobile), xcodebuild (iOS) | `packageManager: pnpm@11.11.0` pinned; root `preinstall` hard-fails on npm/yarn |
| Linting/formatting | None configured | `prettier` is a root devDependency but has no config file — formatting is effectively default-prettier-on-demand, not CI-enforced. No ESLint config anywhere in the repo. |

## Infrastructure

- **Hosting:** Render (`render.yaml`, primary — service `questcompanion`, Docker runtime, health check `/api/healthz`, plan `free`, region `oregon`) and Railway (`railway.json`, same Dockerfile/health check) — both configs present; Render is the one referenced by the ops docs (`getfocusquest.com` domain, `questcompanion.onrender.com`).
- **Container:** single multi-stage `Dockerfile` — installs workspace deps once, builds the frontend (`@workspace/focusquest`) and API (`@workspace/api-server`) in parallel stages, then assembles a slim production image containing `dist/`, `dist/public` (built SPA), `dist/drizzle` (migration SQL, read at boot), and `lib/db/certs` (Supabase pooler's private CA cert).
- **Database hosting:** implied Postgres-as-a-service reachable via `DATABASE_URL`; SSL handled by `lib/db/src/ssl.ts` (`DATABASE_CA_CERT_PATH`), with a shipped cert for Supabase's pooler.
- **CI/CD:** GitHub Actions (`.github/workflows/ci.yml`) — typecheck + build the workspace on every push/PR to `main` and the active iOS integration branch, plus a conditional `ios` job (macOS runner, `xcodebuild` simulator build, no signing) gated to the iOS branch.
- **Scheduling:** external cron via cron-job.org (primary) hitting `POST /api/cron/tick`, with a GitHub Actions workflow (`backup-cron.yml`) as a 5-minute fallback tick, and a healthchecks.io dead-man's-switch ping from inside the tick itself (see `docs/ops/steady-ground.md`).
- **Observability:** `pino` + `pino-http` structured logging in the API server (`artifacts/api-server/src/lib/logger.ts`); no external APM/error-tracking service found in dependencies.
- **Legacy origin:** the codebase carries Replit-era artifacts (`attached_assets/`, threat-model notes about `*.replit.app` same-site risk) — the app was originally built/hosted on Replit before moving to Render/Railway.
