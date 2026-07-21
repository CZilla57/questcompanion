# Never Lose a Thought — offline capture (Act VII, Quest 4)

**Date:** 2026-07-20
**Charter:** `2026-07-19-act7-consolidation-design.md` Quest 4
**Status:** Draft for review

## Overview

The PWA is installable but has zero offline behavior: `public/sw.js` carries an
intentional no-op `fetch` handler, and the query client runs with
`retry: false`. For a capture tool aimed at ADHD brains, the dead-zone moment —
parking garage, subway, airplane mode at 1am — is exactly when a thought most
needs catching. Today that moment fails four separate ways:

1. **White screen:** nothing is cached, so an offline open loads nothing.
2. **Login screen lie:** `useAuth` treats a failed `/api/auth/user` fetch as
   "logged out", so even a cached page would dead-end at "Log in to play" — with
   a login that can't work offline.
3. **Onboarding screen lie:** `OnboardingGate` reads `!stats?.onboardingComplete`,
   so a failed stats fetch would show a brand-new-user screen to a veteran.
4. **Blank Now screen:** `NowScreen` returns `null` without stats. (With React
   Query v5's default `networkMode: "online"`, offline queries sit *paused* —
   `isLoading` is false — so the page falls straight through the skeleton to
   `return null`.)

This quest makes one promise and keeps it narrowly: **a capture typed or spoken
into FocusQuest is never lost**, regardless of signal. Offline reads, offline
completes, and general request caching stay out of scope (charter law).

Four pieces deliver it:

1. **App-shell precache** — a hand-rolled service-worker precache of the built
   shell, so an offline open renders the app instead of a white screen.
2. **Offline-aware session gates** — auth/onboarding gates fall back to
   last-known-good state on *network* failure (never on a real 401).
3. **Capture outbox** — failed or offline quick-adds (text and voice) persist to
   IndexedDB and replay on reconnect/app-open, in order.
4. **Server idempotency** — a client-generated UUID per capture makes replays
   exactly-once no matter how many times they fire.

## Acceptance (charter, restated)

Airplane-mode test: open app → shell renders with offline banner → quick add
three quests (one by voice) → reconnect → all three exist server-side exactly
once, in order, with correct dates; the suite covers the idempotency key path.

## Non-goals

- **Offline reads.** No query-cache persistence; stats/kingdoms/task lists show
  a capture-first fallback offline, not stale data. (Queued outbox items *are*
  shown — they're local capture data, not cached reads.)
- **Offline mutations other than quick-add create.** Completing, editing,
  rescheduling offline are not queued — capture is append-only, so it needs no
  conflict resolution; everything else would.
- **Background Sync API.** Replay happens on app open / `online` event (charter
  baseline). iOS Safari has no Background Sync; building the SW-side replay
  path would duplicate the whole pipeline for one platform's convenience.
- **General request caching / stale-while-revalidate API caching.**
- **New UI surfaces** beyond an offline banner and a "waiting to sync" block
  (act rule: no new features — this is trust plumbing).

---

## Part 1 — App-shell precache (service worker)

### Approach

Hand-rolled, no new dependency. `public/sw.js` stays the single hand-written
worker (push + notificationclick untouched); a small build step injects the
precache manifest. Rationale: the repo's pattern is owning small primitives
(hand-written push SW, notification envelope, no game engine), the needs are
narrow (one shell, hashed assets, one fallback), and `vite-plugin-pwa` would
move sw.js into a plugin-managed build for ~60 lines of logic we can read.
(Alternative considered: `vite-plugin-pwa` in `injectManifest` mode — brings
Workbox's battle-tested lifecycle at the cost of a dependency and a
plugin-owned build path. Flagged in Decisions; cheap to swap later since the
SW surface is identical.)

### Build step

`artifacts/focusquest/scripts/inject-sw-precache.mjs`, run as part of the
package build: `"build": "vite build --config vite.config.ts && node scripts/inject-sw-precache.mjs"`.

- Scans `dist/public` and builds the precache list:
  - `/index.html`, `/manifest.webmanifest`, `/favicon.svg`
  - every file under `/assets/` (Vite's hashed bundles)
  - every file under `/icons/` (app icons, small)
  - **Excluded:** `/lpc/**`, `/avatars/**`, `/kingdoms/**`, `/opengraph.jpg`,
    `robots.txt`, `sw.js` itself. The art directories are megabytes of sprite
    sheets; offline is capture-mode, and missing hero/kingdom images degrade
    gracefully (broken-image-free: those components simply render without art).
- Computes `hash` = sha-256 (truncated) over the sorted asset list, so identical
  builds produce identical cache names and no needless churn.
- Replaces the template line in the *built* `dist/public/sw.js`:

  ```js
  const BUILD = { hash: "dev", assets: [] }; // replaced at build time
  ```

  Source `public/sw.js` keeps the dev value; `vite dev` therefore serves a
  worker whose precache is empty and inert — dev workflow unchanged.
- Warns (build log) if the precache total exceeds ~3 MB so bundle growth is
  visible; the plan verifies the current size on first run.

### Fetch strategy (in `sw.js`)

Order of checks; anything not matched falls through untouched (no
`respondWith`), exactly like today:

| Request | Strategy |
|---|---|
| Any `/api/*` (including navigations like `/api/login`) | **Never intercepted.** Network only. |
| Navigation (`request.mode === "navigate"`) | **Network-first**, fallback to cached `/index.html`. Deploys pick up new HTML immediately when online; offline gets the shell. |
| Same-origin GET in the precache list | **Cache-first** (assets are content-hashed, hence immutable). |
| `fonts.googleapis.com` / `fonts.gstatic.com` GET | **Cache-first** into a small persistent `fq-fonts-v1` cache, so type doesn't degrade offline. Failure falls back to network error → system font. |
| Everything else | Untouched (network). |

### Lifecycle

- `install`: `cache.addAll(BUILD.assets)` into `fq-shell-<hash>` (skipped when
  hash is `"dev"`), then `skipWaiting()` (already present).
- `activate`: delete every `fq-shell-*` cache whose hash isn't current; keep
  `fq-fonts-v1`; `clients.claim()` (already present).
- `sw.js` itself is never precached — the browser's own SW update flow
  (byte-compare on navigation) owns it. `express.static` defaults (ETag,
  no long max-age) already serve it correctly.

---

## Part 2 — Offline-aware session gates

New tiny module `src/lib/offline-session.ts` (pure decision core + a
localStorage record):

- On every *successful* auth check and stats load, persist
  `{ authed: true, onboardingComplete: boolean, savedAt }`.
- Cleared on logout and on any response that positively says "not logged in"
  (HTTP 401, or 200 with `user: null`).

Gate changes (both distinguish **network failure** — fetch rejection — from a
real server "no"):

- **`useAuth`** (`lib/auth-web`): on fetch rejection **or a 5xx** (offline,
  Render cold-start 502s, server down) with a cached `authed: true`, report
  `isAuthenticated: true` (offline grace). A real 401 — or a 200 with
  `user: null` — always wins and clears the record. The session cookie is very likely still
  valid; worst case, replay later meets a 401 and surfaces "log in to sync"
  (Part 3) — never a dead end at capture time.
- **`OnboardingGate`** (`App.tsx`): when the stats query failed on network or
  sits paused offline, and the cached record says `onboardingComplete: true`,
  render the app. The onboarding screen only ever shows on a positive
  server answer.

Pure logic (given: cached record, error kind, query state → gate verdict) lives
in `offline-session.ts` so it's unit-testable in the node vitest environment.

## Part 3 — Capture outbox (app layer)

The SW never touches POSTs. The outbox is an app-layer subsystem under
`src/lib/outbox/`, split for the repo's pure-core testing convention:

### `core.ts` (pure)

```ts
type OutboxEntry = {
  id: string;              // crypto.randomUUID() (tiny getRandomValues fallback) — doubles as the server clientKey
  kind: "text" | "voice";
  createdAt: string;       // ISO instant of capture
  captureDate: string;     // YYYY-MM-DD in the device's local tz at capture
  tz: string;              // IANA, for the record
  status: "queued" | "syncing" | "failed";
  attempts: number;
  lastError?: string;      // plain-language, for the UI
  payload: TextPayload | VoicePayload;
};
// TextPayload: the fully resolved CreateTaskInput from QuickAddBar at capture
//   (title, dueDate — already defaulted to captureDate, dueTime?, priority,
//   category?, questlineId?)
// VoicePayload: { blob: Blob (mime preserved — iOS records audio/mp4),
//   durationMs, questlineId? }
```

Pure helpers: entry construction (incl. the dueDate-defaults-to-captureDate
rule), status transitions, and the replay decision table below.

### `store.ts` (IndexedDB adapter)

Raw IndexedDB, no dependency (~80 lines): DB `fq-outbox`, object store
`entries` keyed by `id`, index on `createdAt`. Exposes an `OutboxStore`
interface (`add/list/update/remove`) so tests substitute an in-memory fake —
client vitest runs in node with no IDB. Blobs store natively via structured
clone. A same-tab change emitter feeds the `useOutbox()` hook; cross-tab
consistency is not chased (the server key dedupes, and drains take a Web Lock).

If IDB is unavailable or the write throws (private mode, quota): fall back to
an in-memory queue for the session and say so honestly — *"Can't save to this
browser — keep the app open until you're back online."* A capture is never
silently dropped.

### `replay.ts` (orchestrator)

Drains oldest-first, strictly sequential (the acceptance requires order).
Wrapped in `navigator.locks.request("fq-outbox-replay", { ifAvailable: true },…)`
where supported so two tabs don't double-drain; the server key is the real
guarantee.

Per entry:

- **text** → `POST /api/tasks` with the stored payload + `clientKey: entry.id`.
- **voice** → `POST /api/tasks/transcribe` (blob, stored mime) →
  - empty transcript → `failed` (*"Couldn't hear anything in this note"*), keep
    the blob for manual retry/discard;
  - else run the **deterministic** parser only —
    `parseQuickAdd(text, { now: entry.createdAt })` — then create with
    `clientKey`; `dueDate` = the parsed date if the transcript resolved one
    ("call Sam tomorrow", relative to capture time), else `captureDate`. No AI smart-parse on
    replay: deterministic, no cooldown exposure, and the charter's auto-create
    acceptance leaves no review step for an AI overlay anyway.

Failure policy (decision table in `core.ts`):

| Result | Action |
|---|---|
| Network error / timeout | Stay `queued`, **stop the drain** (still offline); next trigger resumes. |
| 401 | Stay `queued`, stop, surface *"Log in to sync your saved quests"*. Outbox survives the login redirect (IDB). |
| 429 (transcribe/parse cooldown) | Stay `queued`, stop (order preserved); next trigger resumes. |
| 422 questline gone | Retry once **without** `questlineId` — the capture outranks its grouping. |
| Other 4xx | `failed` — parked visibly with Retry / Discard, **drain continues** (a bad entry never blocks the rest). Never auto-dropped. |
| 5xx | Stay `queued`, stop the drain. |

Triggers: app open (a top-level effect inside the authed shell — mounts once
the gates resolve), the `online` event, and a manual "Sync now" in the outbox
block. On any successful create: invalidate the tasks
+ momentum query keys; when a drain finishes with successes, one toast —
*"Synced N quest(s) ✓"* (border-primary, same voice as "Quest added").

A replayed capture keeps its capture-day due date even if that's now in the
past ("correct dates" means the day you had the thought, not the day the sync
happened); it then shows up under that date like any other quest.

### Capture-path changes (`QuickAddBar`)

- Every create — online or off — sends `clientKey: crypto.randomUUID()`.
  Double-tap dedupe for free.
- The create call moves from the orval `useCreateTask` hook to a direct
  `customFetch` call (the transcribe endpoint already sets this precedent) so
  it can pass `AbortSignal.timeout(10_000)` and classify failures: an
  `ApiError` is a server answer (keep today's destructive toast); a fetch
  `TypeError`/abort — or `navigator.onLine === false` checked up front — is a
  dead zone. Generated types (`CreateTaskInput`, `Task`) still type the call.
- Dead zone → write outbox entry, clear the input, optimistic toast:
  *"Saved — will sync when you're back online ✓"*. (Thanks to the idempotency
  key, a timed-out request that actually landed server-side just dedupes on
  replay.)
- Voice offline: the mic is local and keeps working. `!navigator.onLine` (or a
  network-failed transcribe) → store the blob entry, toast *"Voice note saved —
  I'll transcribe it when you're back online"*. Online transcribe failures with
  a server answer (4xx/5xx) keep today's error toasts.

## Part 4 — Server idempotency

- **Migration 0002:** `client_key text` (nullable) on `tasks` + partial unique
  index `tasks_user_client_key_unique ON (user_id, client_key) WHERE client_key
  IS NOT NULL`. No backfill; existing rows stay null. Rides the shared-Neon
  rules (no live-but-unmerged schema right now; I apply `db generate` +
  `db migrate` myself per repo convention).
- **`POST /api/tasks`** accepts optional `clientKey` (string, 8–64 chars).
  Insert uses `onConflictDoNothing`; when no row returns, select the existing
  row by `(userId, clientKey)` and return it with **200** (fresh create stays
  **201**). Same-key retries are reads, not writes — exactly-once by
  construction. (This insert can't collide with the recurring-task unique
  constraint: quick-add creates never set `recurringTaskId`.)
- **`openapi.yaml`**: `clientKey` added to the create-task input; orval codegen
  refreshes `api-zod` / `api-client-react`.

## UI surfaces (minimal)

- **`OfflineBanner`** in `Layout`, under the header: thin, calm strip —
  *"You're offline — captures are saved and will sync."* Driven by a
  `useOnline()` hook (`online`/`offline` events + `navigator.onLine` seed).
  Neutral styling (muted border, no red); being offline is weather, not an
  error.
- **Outbox block** on Now and `/tasks`, above the pending list (on `/tasks`
  it shows regardless of the selected date — queued captures are global), only
  when non-empty: *"Waiting to sync (n)"* — each row shows the title (or
  *"Voice note · 0:42"*), a discard ✕, and, for `failed` entries, the
  plain-language `lastError` with Retry / Discard. "Sync now" appears when
  online. Entries are visually distinct from real `TaskItem`s (no checkbox —
  they can't be completed yet).
- **Now screen offline fallback:** when stats/tasks are unresolved because of
  network (error or paused) — not while genuinely loading — render the
  capture-first shell instead of `return null`: prompt chips and TodaysFocus
  simply don't render, QuickAddBar and the outbox block do, with one line of
  gentle copy: *"Capture now — sort it out later."* The skeleton shows only
  while a fetch is actually in flight.

### Anti-shame law, applied

Offline copy never implies user error; queued items are never silently evicted
or expired; every failure state a user can see comes with an action (Retry /
Discard) and plain language. The only celebration is on sync success.

## Testing

Repo convention: pure cores exhaustively unit-tested in node-env vitest;
orchestration thin; device flow verified manually.

**Web (`artifacts/focusquest`):**
- `lib/outbox/core.test.ts` — entry construction (captureDate/dueDate
  defaulting, tz recorded, mime preserved), transition legality, the full
  replay decision table.
- `lib/outbox/replay.test.ts` — in-memory store + stubbed api fns: drains in
  `createdAt` order; stops on network/401/429/5xx keeping order; 422 retries
  once without questline; 4xx parks as failed and continues; voice pipeline
  (transcribe → deterministic parse → create) incl. empty-transcript parking;
  `clientKey` passed through on every create; lock-unavailable skips cleanly.
- `lib/offline-session.test.ts` — gate verdict matrix: network error × cached
  flags × real 401 (401 always wins; empty cache never grants grace).
- `scripts` test (pattern: existing `manifest.test.ts`) — run the inject script
  against a fixture dist: manifest lists hashed assets + shell files, excludes
  art dirs and sw.js, hash is deterministic, template line present in source
  `public/sw.js`, size warning fires on an oversized fixture.
- `use-online` seed/event logic if extracted; otherwise covered by banner
  render logic staying trivial.

**API (`artifacts/api-server`):**
- Idempotent-create decision helper (insert-returned-nothing → fetch-existing →
  200 path) unit-tested.
- Standing-guard-style test asserting migration 0002 contains the partial
  unique index on `(user_id, client_key)` — the schema fact the exactly-once
  claim rests on.
- `clientKey` validation (length bounds, optional).

**Manual (documented in the PR):** the airplane-mode acceptance run on Chad's
iPhone (installed PWA): offline open → shell + banner → three captures (one
voice) → reconnect → exactly-once, in order, capture-day dates; plus a
double-tap online create showing a single row.

## Build / integration order (for the plan)

1. Schema + API idempotency (migration, route, openapi, codegen) — independent,
   unblocks everything.
2. Outbox `core.ts` + `store.ts` (pure + adapter, fully tested).
3. `replay.ts` + QuickAddBar capture-path wiring (text, then voice).
4. SW precache: inject script + `sw.js` strategies + lifecycle.
5. Session gates + `useOnline` + `OfflineBanner` + Now-screen fallback.
6. Outbox UI block, toasts, polish; device acceptance run.

## Decisions taken (flag any on review)

1. **Hand-rolled SW precache** — no `vite-plugin-pwa`/Workbox dependency;
   matches the repo's own-the-primitive style and the charter's "build-time
   manifest" wording. Swap-friendly if you'd rather own less lifecycle code.
2. **App-layer outbox, no Background Sync v1** — SW never intercepts POSTs;
   replay on app-open/`online` (charter baseline; iOS has no Background Sync).
3. **Offline grace via cached last-known session flags** — required for the
   shell to be usable at all; a real 401 always wins.
4. **Voice replays auto-create** (charter acceptance) with deterministic parse
   only, anchored to capture time — no AI parse, no review step on replay.
5. **`clientKey` on every create, always** — not just replays; kills the
   double-tap dupe class for free.
6. **Shell-only precache** — big art dirs (`/lpc`, `/avatars`, `/kingdoms`)
   excluded; offline pages may show missing art. Google Fonts runtime-cached so
   text doesn't degrade.
7. **Failed entries are terminal-but-visible** — parked with Retry/Discard,
   never auto-dropped, no retry-count cap (retries only fire on real triggers,
   so there's no churn loop to cap).
8. **Capture create bypasses the orval hook** for timeout + error
   classification, keeping generated types (transcribe precedent).
