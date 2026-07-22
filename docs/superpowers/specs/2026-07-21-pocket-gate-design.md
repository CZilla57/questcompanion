# The Pocket Gate — add & complete quests from the iPhone home screen (side-quest)

**Date:** 2026-07-21 · **Status:** awaiting Chad's approval (merge = approved; decisions D1–D9 below have defaults pre-applied)
**Parent:** side-quest extending Act VII q4 "Never Lose a Thought" ([[project-never-lose-a-thought]]). Not one of the campaign 38 — a standalone increment on the capture story.

## 1. Problem

Capturing a thought or ticking off a quest currently costs: unlock phone → find the
FocusQuest icon → wait for the PWA shell → (occasionally) re-auth → navigate → type.
For an ADHD brain that's four chances to lose the thought — and "Never Lose a Thought"
only removed the *network* obstacle, not the *launch* obstacle. Chad wants widget-style
one-tap **add** and **mark-done** straight from the iPhone home screen, with no login.

## 2. Platform reality — why Apple Shortcuts (D1)

True iOS home-screen widgets are native-only, and the platform can't be argued with:

| Route | Verdict |
|---|---|
| PWA manifest widgets | Exist on Windows 11; **Safari/iOS has never shipped them** (still true as of iOS 26). |
| Native WidgetKit widget | Needs a wrapper app: Mac + Xcode + $99/yr + App Store review — and even native interactive widgets (iOS 17+) **cannot show a keyboard**; text entry always bounces into an app. Chad develops on Windows. High cost, partial win. |
| **Apple Shortcuts** | Free, on every iPhone. Shortcuts placed in the home-screen Shortcuts widget call our API directly over HTTPS with a bearer token. Input prompts (`Ask for Input`, `Choose from List`) pause the run for entry — an overlay card or a brief bounce through the Shortcuts app depending on iOS version, but never a FocusQuest launch or login. Same shortcuts also mount on the Lock Screen, Control Center, Action Button, and "Hey Siri" (fully hands-free). |

**D1: Shortcuts + a scoped personal access token. No native app, no new infra.**
The server stays stateless request/response — the standing free-tier design law.

## 3. Design principles (anti-shame law, applied)

- **Capture must never fail.** A tap that ends in an error loses the thought — the one
  unforgivable outcome. The capture endpoint has no LLM in the loop, no required
  fields beyond text, and a graceful fallback for every parse outcome (worst case:
  raw text becomes the title, dated today).
- **An empty list is an all-clear, not an emptiness.** "Nothing waiting on you today 🌤"
  — never "no quests found", never "0 results".
- **No deadline pressure by side effect.** Quick-captured quests are *not* auto-anchored
  (anchoring gates the daily bonus — that's a deliberate choice the user makes in-app,
  not something a capture shortcut silently opts them into).
- **Completion celebrates.** The done-flow notification carries the same payout the app
  shows (`+N XP`), because the shortcut reuses the app's real completion path.

## 4. Concept & scope (D2)

Two shortcuts the user builds once (~3 minutes, guided by an in-app recipe), backed by
three small server additions:

- **"New Quest"** — tap → type or dictate → `POST /api/shortcuts/capture` → notification
  confirms. Natural-language dates work ("call dentist tomorrow 3pm") via the existing
  deterministic `parseQuickAdd`.
- **"Quest Done"** — tap → today's open quests appear as a native picker →
  `POST /api/tasks/:id/complete` → notification shows the XP payout.
- **Auth** — a revocable **shortcut token** minted in Settings, pasted into each
  shortcut once, valid *only* for the three whitelisted calls above.

Out of scope for v1: everything in §14.

## 5. Auth — shortcut tokens (D3, D4)

### Token design (D3)

- Format: `fqs_` + 43 chars base64url (32 random bytes, `crypto.randomBytes`). Total 47 chars.
- Storage: **sha256 hex digest only** (`token_hash`, unique). Plaintext is shown exactly
  once at mint. Lookup by digest — constant-time by construction, and 256-bit entropy
  makes online guessing a non-issue.
- Per-user cap: **5 active tokens** (labelled, e.g. "iPhone"), friendly 400 beyond that.
- Revocation: soft (`revoked_at` set), effective immediately. `last_used_at` updated on
  successful auth, throttled to once per hour, fire-and-forget.

### Middleware branch — default-deny (D4)

[authMiddleware.ts](../../../artifacts/api-server/src/middlewares/authMiddleware.ts) gets a
branch *before* the session path: if the bearer value starts with `fqs_`, it is a
shortcut token, never a session id.

```
Bearer fqs_…  →  sha256 → active-token lookup
              →  request matches the WHITELIST?  → attach identity, next()
              →  no match / unknown / revoked    → next() unauthenticated (routes 401 as usual)
```

**Whitelist (exact method + path, checked against the full app-level `req.path`):**

| Method | Path pattern |
|---|---|
| `POST` | `^/api/shortcuts/capture$` |
| `GET`  | `^/api/shortcuts/today$` |
| `POST` | `^/api/tasks/\d+/complete$` |

A shortcut token authenticates **nothing else** — not token management (§7, session-only,
so a leaked token can't mint or list tokens), not export/delete, not any other route.
Identity attachment mirrors the session path: load the users row, set `req.gameUserId`,
and synthesize the minimal `AuthUser` (`id` ← `externalId`, `firstName` ← `displayName ?? username`,
rest null) so `req.isAuthenticated()` holds. The existing origin/CSRF check already
exempts bearer requests (Shortcuts sends no Origin header); no change there.

## 6. Data model (additive migration `0005_pocket_gate`)

```
api_tokens
  id            serial PK
  user_id       integer NOT NULL → users.id
  token_hash    text NOT NULL UNIQUE
  label         text
  created_at    timestamp NOT NULL default now()
  last_used_at  timestamp
  revoked_at    timestamp
  index on user_id
```

New schema file `lib/db/src/schema/api-tokens.ts`, exported from the db index. Generated
with `drizzle-kit generate`, applied to Neon via `db migrate` (I run it — standing
agreement [[feedback-run-drizzle-push]]; nothing unmerged is live on the shared DB today).

## 7. API surface

### Token management (session-auth only, new `routes/shortcut-tokens.ts`)

| Endpoint | Behaviour |
|---|---|
| `POST /api/shortcut-tokens` `{label?}` | Mint. Returns `{id, label, createdAt, token}` — `token` appears in this response only. 400 past the 5-active cap. |
| `GET /api/shortcut-tokens` | Active tokens: `[{id, label, createdAt, lastUsedAt}]`. Never hashes. |
| `DELETE /api/shortcut-tokens/:id` | Revoke (idempotent 200). |

### Shortcut-facing (token-auth, new `routes/shortcuts.ts`)

**`POST /api/shortcuts/capture` `{text}`** (D5)

1. Validate: non-empty, ≤500 chars (mirrors `/tasks/parse`).
2. Resolve the user's local "today" from persisted `users.timezone` via the existing
   `resolveTimeZone` + `localDateKey` ([date-buckets](../../../artifacts/api-server/src/lib/date-buckets.ts));
   null tz falls back to UTC, same as cron.
3. Run **deterministic** `parseQuickAdd(text, {now: localNoon})` — the same parser the
   in-app quick-add uses for its non-LLM path. It already handles "tomorrow",
   weekdays, times. **No AI call** (D5): capture must be sub-second and unfailable;
   the LLM fallback's latency and 502 modes have no place in a one-tap loop.
4. Create via the same insert semantics as `POST /tasks` (auto points/category from
   `assignPoints`, parsed priority/dueDate/dueTime honored). **Parse found no date →
   `dueDate` = user's local today. Never auto-anchored** (§3).
5. Respond `201 {ok, id, title, dueDate, message}` where `message` is
   notification-ready: `Added for today: "Buy milk" ⚔️` / `Added for Fri, Jul 24: "Call dentist"`.

**`GET /api/shortcuts/today`** (D6)

Same buckets as the app's today view ([tasks.ts:120](../../../artifacts/api-server/src/routes/tasks.ts)):
quests dated local-today **plus** incomplete anchored quests; incomplete only; app
ordering (anchored first, then newest); capped at 25.

```json
{ "count": 3,
  "message": "Pick a quest to mark done",        // or the §3 all-clear when count = 0
  "quests": { "Buy milk": 42, "Email Sam": 57, "Email Sam (2)": 61 } }
```

`quests` is a flat title→id dictionary because that's the shape Shortcuts' native
`Choose from List` consumes with zero scripting; duplicate titles get " (2)" suffixes
server-side.

**Completion — reuse `POST /api/tasks/:id/complete` verbatim (D7).**
The completion transaction ([tasks.ts:522](../../../artifacts/api-server/src/routes/tasks.ts))
is the most delicate section in the app (atomic flip, XP monotonicity, coins, streaks,
badges, gear, kingdom growth, companion). It is not currently an extractable service,
and duplicating *any* of it is forbidden. Whitelisting the existing route gives the
shortcut the exact same rewards, races, and guarantees as an in-app tap for free; the
recipe reads `pointsAwarded` from the existing response for its notification.
*Rejected alternative:* extracting a `completeQuest()` service just to add a
message-shaped wrapper — a high-risk refactor of battle-tested code for cosmetic gain.

### Rate limits (D8)

Per-user in-memory cooldowns, same primitive as the existing `parseCooldown` family
(one call per interval): capture 2s (~30/min), today 2s (~30/min), mint 10s — pure
anti-spam, since the 5-active cap is the real bound and back-to-back "iPhone"/"iPad"
mints must stay pleasant. Token-miss requests fall through to plain 401s (entropy is
the real defense; no lockout bookkeeping).

## 8. Account lifecycle (D9)

*(Revised during planning.)* The `account-data` standing guard detects user tables by
**walking FKs to `users.id`** — sessions dodge it only because their userId hides in
jsonb. `api_tokens` carries a real FK, so the honest move is registering it in
`USER_DATA_TABLES` like any user-keyed table: deletion comes free inside the existing
transaction, `/me/export` includes the rows (label, timestamps, and the sha256
`token_hash` — one-way, plaintext never stored, useless to an attacker), and the
guard stays unweakened. An exemption list would have traded guard strength for
export cosmetics.

## 9. Settings UI (`account-dialog.tsx`)

New section **"📱 Home Screen Shortcuts"** in the existing account dialog:

- One-line explainer: *"Add and complete quests from your iPhone home screen — no login,
  no waiting for the app."*
- **Create token** → label field (default "iPhone") → reveal-once panel with the token,
  a copy button, and "This is the only time it's shown."
- Token list: label · created · last used · Revoke (with confirm).
- Collapsible **Set-up guide** rendering both recipes from §10 — the guide lives in-app
  because setup happens *on the phone*: copy token → switch to Shortcuts app → paste.

## 10. The on-phone recipes (shipped as the in-app guide + `docs/ops/pocket-gate.md`)

**Recipe A — "New Quest"** (≈4 actions)

1. `Ask for Input` (Text) — prompt: *"What's the quest?"* — or `Dictate Text` for a voice variant.
2. `Get Contents of URL` — `POST https://<app-domain>/api/shortcuts/capture` ·
   Header `Authorization: Bearer fqs_…` · Request Body (JSON): `text` = Provided Input.
3. `Get Dictionary Value` — `message`.
4. `Show Notification` — the message.

**Recipe B — "Quest Done"** (≈6 actions)

1. `Get Contents of URL` — `GET …/api/shortcuts/today` · same auth header.
2. `Get Dictionary Value` — `quests` → `Choose from List` (shows titles as a native picker).
3. `Get Dictionary Value` — chosen title from `quests` → the id.
4. `Get Contents of URL` — `POST …/api/tasks/<id>/complete` · same header · empty JSON body.
5. `Get Dictionary Value` — `pointsAwarded`.
6. `Show Notification` — *"Quest complete! +{pointsAwarded} XP"*.

Then: long-press home screen → Shortcuts widget (both fit a medium widget) — and the
same shortcuts are automatically available from the Lock Screen, Control Center, the
Action Button, and "Hey Siri, New Quest" (Siri collects the input by voice, zero screens).

## 11. OpenAPI & codegen

All six paths (3 token-management + 2 shortcut endpoints + the token-auth note on
`/tasks/{id}/complete`) go into [openapi.yaml](../../../lib/api-spec/openapi.yaml) as the
single source of truth, then the standard codegen refreshes `api-client-react` /
`api-zod`. The settings card consumes the generated mint/list/revoke hooks; the
shortcut endpoints are documented for the recipe but consumed by Shortcuts, not the web client.

## 12. Security notes

- Hash-at-rest (sha256 of a 256-bit secret); plaintext shown once; revocable; capped.
- Token usable only on the three whitelisted routes — a leaked token can capture and
  complete quests, and nothing else: it cannot read the account, export data, mint
  tokens, or touch settings. Blast radius stated in the UI copy.
- Header-only transport (never query strings), HTTPS only (Render terminates TLS).
- Mint/list/revoke require a full session — token possession never escalates.

## 13. Testing plan (vitest, house patterns)

- **Middleware:** valid token on each whitelisted route authenticates; valid token on a
  non-whitelisted route → 401; revoked / unknown / malformed → 401; session flow
  untouched (regression); `last_used_at` throttle.
- **Token routes:** mint returns plaintext once and stores only the hash; cap at 5;
  list never leaks hashes; revoke idempotent; all three 401 under token auth.
- **Capture:** parsed date/time honored; dateless → local today under a fake tz (and
  UTC fallback when tz null); never anchored; length/empty validation; auto
  points/category applied.
- **Today:** dated + anchored buckets; incomplete only; dedup suffixes; 25 cap;
  all-clear message at zero.
- **Account:** deletion removes `api_tokens` rows; export includes them; completeness
  guard passes with the new classification.

## 14. Non-goals / phase 2

- **Scriptable glance widget** — a free JS-rendered home-screen widget *displaying*
  today's quests (taps hand off to Recipe B). Nice, display-only, deferred.
- **AI parse in capture** — v1.1 flag if deterministic parsing proves too thin.
- **Android / Windows widgets**, share-sheet capture targets, questline routing from
  the shortcut, `clientKey` idempotency in the recipe (a manual retry duplicating a
  quest is acceptable v1; the endpoint can grow the field later).

## 15. Rollout

1. Branch `feat/pocket-gate`, subagent-TDD, single PR (server + schema + UI + spec docs).
2. Post-merge: `db migrate` against Neon (me), Render auto-deploy, then live-verify by
   minting a token and driving capture/today/complete via `Invoke-RestMethod`.
3. Chad's part (~3 min, on-phone): mint token in Settings → build both recipes from the
   in-app guide → add the Shortcuts widget. Walkthrough checklist in the PR description.

## 16. Decisions index

| # | Decision |
|---|---|
| D1 | Apple Shortcuts + scoped token; no native app, no new infra |
| D2 | Two shortcuts (New Quest / Quest Done); token minted in Settings |
| D3 | `fqs_` 256-bit token, sha256 at rest, reveal-once, 5 active max, soft revoke |
| D4 | Default-deny: token authenticates exactly three routes, enforced in authMiddleware |
| D5 | Capture = deterministic `parseQuickAdd` only; dateless → local today; **never auto-anchored** |
| D6 | Today = app's dated+anchored buckets, title→id dict, " (2)" dedup, cap 25 |
| D7 | Completion reuses `POST /tasks/:id/complete` verbatim — zero duplication of the critical transaction |
| D8 | Cooldown-primitive rate limits (capture ~30/min, today ~30/min, mint 10s anti-spam — the 5-active cap is the real bound); capture 429 carries a Shortcut-visible `message` |
| D9 | *(revised)* `api_tokens` registered in `USER_DATA_TABLES`: deleted with the account **and** exported (hash is one-way); standing guard untouched |
