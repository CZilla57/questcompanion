# Weekly AI Recap Email (Act V, Quest 4 — closes Act V)

**Date:** 2026-07-17
**Status:** Approved
**Motivation:** The final Act V quest: once a week, FocusQuest writes the user a
warm, strengths-only recap of the week they actually had — quests done, focus
time, rhythms, story beats — and delivers it to their inbox Monday morning as
fuel for the new week. It is the "app that learns you" speaking in complete
sentences, outside the app, on the anti-shame terms the product is built on.

## Summary

A new `weeklyRecap` pass rides the existing every-minute cron `tick()`. On each
user's local Monday morning it claims a `weekly_recaps` row for the ISO week
that just closed (the unique constraint is the exactly-once gate), computes a
structured strengths-only `WeekStats` summary, asks Gemini for a short narrative
(deterministic fallback + guilt-word guard, LLM never inside a transaction),
renders an HTML email, and sends it through Resend's REST API. The same stored
rows power a "Weekly recaps" archive section on the insights page, so the
feature degrades gracefully to in-app-only when email is unconfigured, missing,
or declined. Delivery is default-on with a one-click tokenized unsubscribe link
in every email plus an in-app toggle.

Decisions made during brainstorming (Chad, 2026-07-17):

- **Delivery:** real email via Resend free tier **plus** an in-app archive.
- **Timing:** Monday morning, per-user local time, covering the just-closed ISO
  week (Mon–Sun) — aligns with `getWeekKey` and the boss-week reset.
- **Content blocks:** Wins & numbers, Rhythms, World & story beats. Reflection
  echoes explicitly **excluded** — reflection text never leaves the app.
- **Consent:** default-on for users with a stored email; one-click unsubscribe
  (signed by stored random token, no login) + settings toggle.
- **Architecture:** single-pass cron (generate + send in one pass with
  in-window retry), chosen over two-phase generate/send and teaser-link
  alternatives.

## Changes

### 1. Schema — `lib/db/src/schema/users.ts` (3 new columns)

- `email` (text, nullable) — captured from OIDC `claims.email` in
  `upsertGameUser` (`artifacts/api-server/src/routes/auth.ts`). The function
  currently early-returns for existing users; it gains an update step so an
  existing user's stored email refreshes on login when the claim differs.
  Existing users therefore backfill naturally on their next login.
- `recap_emails_enabled` (boolean, not null, default `true`) — the opt-out
  flag, honored at send time only (generation is unconditional).
- `recap_unsubscribe_token` (text, unique, nullable) — `crypto.randomUUID()`,
  generated in `upsertGameUser` whenever an email is captured/refreshed and the
  token is null. Stored-token over HMAC: simple, revocable, no crypto
  subtleties.

### 2. Schema — new table `lib/db/src/schema/weekly-recaps.ts`

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `user_id` | integer FK → users, not null | |
| `week_key` | text, not null | ISO week of the recapped week, e.g. `"2026-W29"` (shared `getWeekKey` format) |
| `stats` | jsonb, nullable | structured `WeekStats`; null between claim and fill |
| `subject` | text, nullable | deterministic email subject |
| `narrative` | text, nullable | LLM or fallback paragraph(s) |
| `skipped` | boolean, not null, default false | zero-signal week → silent skip |
| `sent_at` | timestamp, nullable | null = not delivered (yet, or ever) |
| `created_at` | timestamp, not null, default now | |

Constraint: `unique(user_id, week_key)` — concurrent cron ticks converge via
`onConflictDoNothing` + claim-winner semantics (reflections pattern).

### 3. Email seam — `artifacts/api-server/src/lib/email/send-email.ts`

- `isRecapEmailConfigured(): boolean` → `Boolean(process.env.RESEND_API_KEY)`.
- `sendEmail({to, subject, html, text, headers})` — plain `fetch` POST to
  `https://api.resend.com/emails`, `Authorization: Bearer ${RESEND_API_KEY}`,
  from `process.env.EMAIL_FROM` (e.g. `FocusQuest <recap@getfocusquest.com>`),
  10 s timeout, non-2xx → typed error. **No SDK dependency** — one REST
  endpoint, matching the codebase's minimal-deps style.
- Every recap send includes a `List-Unsubscribe` header pointing at the
  unsubscribe URL.

### 4. Cron pass — `artifacts/api-server/src/lib/weekly-recap.ts`, wired into `tick()`

Per user, per tick:

1. **Eligibility (pure `shouldStartRecap`)**: `timezone` known (null → skip,
   consistent with the nudge engine); local day is Monday; local hour ≥ 8;
   target week = the ISO week that ended Sunday (computed from the user's
   local Monday minus 1 day, keyed via `getWeekKey`).
2. **Atomic claim**: `INSERT (user_id, week_key) … onConflictDoNothing …
   returning`. No row returned → another tick owns it → stop. (The LLM is never
   inside a transaction; the claim is a single insert.)
3. **Compute `WeekStats`** → zero-signal → `UPDATE skipped = true`, stop.
   No email, no "quiet week!" message — the anti-shame silent skip.
4. **Generate narrative** (Gemini via `generateJson`, fallback on any failure)
   → `UPDATE` row with `stats`, `subject`, `narrative`.
5. **Send** — only if `isRecapEmailConfigured()` ∧ stored `email` ∧
   `recap_emails_enabled`. Success → stamp `sent_at`.

**Resume/retry:** a claimed row with `sent_at IS NULL`, `skipped = false`, and
local time still Monday is resumed by later ticks — content missing →
regenerate from step 3; content present → retry the send only. After local
Monday ends, retries stop (no stale recap arriving Thursday); the row remains
in the archive, so a recap is never lost, only not emailed. Rows unsent for
benign reasons (no email / opted out / email unconfigured) look identical to
send-failures — acceptable, the archive is the source of truth.

### 5. Content — `computeWeekStats` (loader + pure summarizer, `derivePatterns` style)

- **Personal stats — user's local Mon 00:00 → Sun 24:00** (the week as the
  user lived it): quests completed, focus sessions + minutes, XP earned, coins
  earned, initiation starts (Celebrate Starting), level-ups, badges earned,
  questline claims.
- **World Boss block — UTC ISO `week_key`** (exactly how boss data is stored):
  the user's contribution damage and whether the boss fell. The 0–12 h boundary
  mismatch between local and UTC weeks is accepted and documented here.
- **Rhythms block — reuse `derivePatterns` as-is** (28-day window): power
  hours, best day, top helper chips, gated at the same confidence threshold
  the insights rhythms card uses (currently `ok`) — if the card's gate ever
  moves, the recap follows it. No weekly re-derivation variant (YAGNI).
- **Zero-signal definition:** all personal-stat counts zero and no boss
  contribution. Rhythms alone never justify a recap.
- `WeekStats` **structurally excludes** unfinished/missed work (the
  `DaySummary` trick) — shame is unrepresentable, not filtered.

### 6. Narrative — `artifacts/api-server/src/lib/ai/weekly-recap.ts`

- Prompt grounded ONLY in the `WeekStats` blocks; asks for 2–3 warm sentences
  in FocusQuest's voice, strengths-only, **no week-over-week comparisons**
  (nothing to compare against — prior weeks are not in the prompt).
- Reuses the reflection guilt-word guard (including curly-apostrophe
  normalization) on all LLM output; guard trip → deterministic fallback.
- Deterministic fallback template assembled from the same stats, seeded by
  `hash(userId:weekKey)` for variety — the email reads fine with the LLM
  entirely down.
- **Subject is always deterministic**, never LLM-written.

### 7. Email rendering — `renderRecapEmail(stats, narrative, unsubUrl)`

Pure function → `{html, text}`. Inline CSS only, no external images or web
fonts (email-client reality), emoji for flavor, unsubscribe link in the
footer. The plain-text part carries the same content.

### 8. API — `openapi.yaml` + orval codegen

- `GET /api/recaps` (authed) — past recaps `{weekKey, stats, narrative,
  sentAt}`, newest first, `skipped` rows excluded. Powers the archive.
- `PATCH /api/users/me/recap-emails` `{enabled: boolean}` — the toggle.
- `GET /api/recaps/unsubscribe?token=…` (**unauthenticated**) — token lookup →
  set `recap_emails_enabled = false` → tiny friendly HTML page ("You're
  unsubscribed — recaps still live on your Insights page"). Invalid/unknown
  token → the same page, no error detail (no token oracle). Not consumed by
  the orval client (browser-only endpoint).

### 9. UI — insights page (`artifacts/focusquest/src/pages/insights.tsx`)

A "Weekly recaps" section under the rhythms card: past recaps rendered
natively from `stats` + `narrative` (never the email HTML), the "Email me
weekly recaps" toggle inline, and a gentle empty state ("your first recap
arrives Monday morning"). No new page; no settings page gets built.

### 10. Error handling

- Gemini failure → deterministic fallback immediately; generation never
  blocks a send.
- Resend non-2xx/timeout → log, `sent_at` stays null, in-window retry (§4).
- `RESEND_API_KEY` absent → sends no-op; generation still runs (archive
  fills).
- No stored email / opted out → row generated, send skipped.

## Testing (vitest, pure-lib level — api-server has no route harness)

- Eligibility window across timezones and DST; target-week derivation.
- Claim convergence (`onConflictDoNothing` winner/loser paths) and
  resume/retry state machine (content-missing vs content-present vs
  window-expired).
- Zero-signal detection; local-week vs UTC-boss-week boundary math.
- Summarizer from fixture rows; structural absence of missed/unfinished work.
- Fallback determinism (`hash(userId:weekKey)` seed); guilt guard on
  narrative.
- Renderer: contains stats, narrative, unsubscribe URL in both parts.
- Unsubscribe: valid token flips the flag; invalid token changes nothing and
  returns the same page.
- `isRecapEmailConfigured` gate (RESEND key only — GEMINI/GROQ keys do not
  enable it).

## Rollout

1. Chad (guided): create Resend account → verify `getfocusquest.com` (add
   Resend's SPF/DKIM records in Cloudflare DNS) → set `RESEND_API_KEY` +
   `EMAIL_FROM` on Render and local `.env`.
2. Claude runs the drizzle push to Neon (after confirming no unmerged schema
   from another branch is live, per the shared-DB convention).
3. Merge deploys the rest; first sends occur the following Monday morning.

## Anti-shame invariants (design law)

- Strengths-only counts; no week-over-week comparisons, ever.
- Unfinished work structurally unrepresentable in `WeekStats`.
- Zero-signal weeks: total silence.
- Guilt-word guard on every LLM sentence; deterministic fallbacks everywhere.
- Unsubscribe is instant, one click, and shame-free.
- Reflection content never appears in email (block excluded by decision).
