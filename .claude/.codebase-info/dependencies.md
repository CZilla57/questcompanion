# Dependencies

*Last Updated: 2026-09-08*

Full manifests live in each package's own `package.json`; this is the shape, not a lockfile transcription. Versions pinned once in `pnpm-workspace.yaml`'s `catalog:` block apply across `artifacts/*`/`lib/*` (kept in sync with `pnpm.overrides` in the root `package.json`).

## Runtime

### Core
| Package | Purpose |
|---------|---------|
| `express` (`artifacts/api-server`, v5) | HTTP server/router |
| `react` / `react-dom` (catalog, v19) | Web + mockup-sandbox UI |
| `vite` (catalog, v7) | Web/mockup-sandbox dev server + bundler |
| `wouter` (catalog) | Web router |
| `@tanstack/react-query` (catalog, v5) | Server-state layer, driving the generated API hooks |
| `expo` / `expo-router` (`artifacts/focusquest-mobile`) | Mobile app shell + file-based routing |
| `tailwindcss` (catalog, v4) + `@tailwindcss/vite` | Styling (web + mockup-sandbox), CSS-first config |
| Radix UI primitives (`@radix-ui/react-*`) | Headless components underlying the shadcn/ui set |
| `class-variance-authority` / `clsx` / `tailwind-merge` (catalog) | Component variant/class-merging utilities (shadcn/ui plumbing) |
| `pixi.js` (`artifacts/focusquest`) | WebGL hero sprite rendering |
| `zod` (catalog) | Runtime schema validation (hand-written + generated) |

### Data / External
| Package | Purpose |
|---------|---------|
| `drizzle-orm` (catalog) + `drizzle-kit` + `drizzle-zod` | ORM, migration generation, insert-schema derivation (`lib/db`) |
| `pg` | Postgres driver (`lib/db`) |
| `openid-client` | OIDC/Auth0 login flow (`artifacts/api-server`) |
| `web-push` | VAPID Web Push delivery (`artifacts/api-server`) |
| `orval` | OpenAPI → React Query hooks + Zod schemas codegen (`lib/api-spec`) |
| `expo-auth-session` / `expo-secure-store` / `expo-notifications` | Mobile auth/storage/push (`artifacts/focusquest-mobile`) |
| Auth0, Google Gemini, Groq, Resend, cron-job.org, healthchecks.io, Render/Railway | External services called over plain `fetch`/REST, not SDKs — see `communication.md` |

### Logging
| Package | Purpose |
|---------|---------|
| `pino` + `pino-http` | Structured request/app logging (`artifacts/api-server`) |

## Development

| Package | Purpose |
|---------|---------|
| `typescript` (~5.9.3, root) | Compiler for every TS package |
| `vitest` (per-package, ^2.1.9) | Test runner everywhere in TS |
| `esbuild` (pinned `0.28.1` via override) + `esbuild-plugin-pino` | API server production bundling (`artifacts/api-server/build.mjs`) |
| `drizzle-kit` (^0.31.10) | Migration generation/check (`push` intentionally unused — see `database.md`) |
| `tsx` (catalog) | Run TS scripts directly (`scripts/`, `lib/db` migrate CLI) |
| `prettier` (^3.8.3, root) | Present as a devDependency but **unconfigured** — no `.prettierrc*`, not wired into any script |
| `@vitejs/plugin-react` (catalog) | React Fast Refresh in Vite |

## Notes

- **Pinned/overridden versions worth knowing about** (`pnpm-workspace.yaml` → `overrides`, mirrored in root `package.json`'s `pnpm.overrides`): `esbuild` pinned to `0.28.1`; `@esbuild-kit/esm-loader` redirected to `tsx`; `@babel/core >=7.29.6`, `js-yaml >=4.2.0`, `markdown-it >=14.2.0`, `qs >=6.15.2` — the latter four read as security-advisory bumps for transitive deps.
- **`minimumReleaseAge: 1440`** (pnpm-workspace.yaml) — any dependency version younger than 24h is refused at install time; if `pnpm install` rejects a brand-new release, pin to a slightly older patch instead of fighting the setting.
- **`autoInstallPeers: false` / `strict-peer-dependencies=false`** (`.npmrc`) — peer deps are not auto-installed and mismatches don't hard-fail; install explicitly when adding a package that needs one.
- **pnpm only, enforced by the root `preinstall` script** — it hard-fails under any user agent other than `pnpm/*` and deletes any stray `package-lock.json`/`yarn.lock`.
- **`onlyBuiltDependencies`** (pnpm-workspace.yaml): `@swc/core`, `esbuild`, `msw`, `unrs-resolver`, `sharp` — these are the packages pnpm is allowed to run install/postinstall scripts for; a new native dependency will silently not build until added here.
- **iOS has zero third-party dependencies** — no Swift Package Manager packages at all; everything is first-party Apple frameworks (see `modules.md`).
