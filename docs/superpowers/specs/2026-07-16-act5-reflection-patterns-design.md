# Act V Spine — End-of-Day AI Reflection + Pattern Substrate — Design

Opens **Act V — The App That Learns You**. One PR, two halves that feed each other:
the **End-of-day AI Reflection** (the act's first user-facing quest) and the
**pattern substrate** (the derivation layer that Energy Patterns & Prediction,
Context-Aware Notifications, and the Weekly AI Recap will all ride).

## Thesis

Act III taught the app to meet the brain where it is *right now*. Act V teaches it
who the user is *over time*. The reflection asks "what made today easier?" — never
"did you finish?" — and its structured answers, together with the passively
collected Act III data (check-ins, focus sessions, rescues, completions), become a
per-user `PatternSummary` the whole act consumes.

## Decisions locked in brainstorming

- **Scope:** spine PR = Reflection + pattern substrate + one small visible surface
  (the "Your rhythms" card). Context-Aware Notifications and Weekly Recap are
  separate later PRs.
- **Reflection UX:** LLM-personalized single question grounded in the day's actual
  events, answered by tap-chips (multi-select) + optional free text, closed by a
  warm one-line LLM acknowledgment. Static fallbacks everywhere.
- **Patterns v1 surface:** one gentle "Your rhythms" card, confidence-gated, on the
  **insights page** (top) — not the dashboard. The existing
  `GET /users/me/insights` endpoint already does descriptive chart analytics with
  correct tz bucketing; the substrate extends that foundation via the shared
  `date-buckets` helpers rather than duplicating it.
- **Substrate architecture:** pure derivation, computed on read (matches the Act III
  "derived-not-stored" invariant). No rollup table, no cron materialization —
  revisit only when the cron-driven Act V quests measurably need it.

## Non-goals (v1)

- No steering of hard quests into productive windows (Energy Patterns quest 2).
- No context-aware push suggestions ("bills take ~6 min") — quest 3.
- No weekly recap / email infrastructure — quest 4.
- No reflection streaks, reminders about missed reflections, or reflection history
  browsing UI (the data is kept; a history view can come with the recap).
- No coins for reflecting (avoids CoinReason enum churn; XP only).
- No editing of past days — today's reflection is the only writable one.

## 1. Data model

New table `reflections` (`lib/db/src/schema/reflections.ts`):

| column        | type      | notes                                                    |
|---------------|-----------|----------------------------------------------------------|
| id            | serial PK |                                                          |
| user_id       | integer   | NOT NULL → users                                         |
| local_date    | text      | NOT NULL, `YYYY-MM-DD` in the user's tz (UTC fallback)   |
| prompt        | text      | NOT NULL — the question shown                            |
| prompt_source | text      | NOT NULL — `'ai' \| 'fallback'`                          |
| chips         | jsonb     | NOT NULL default `[]` — array of chip keys               |
| free_text     | text      | nullable                                                 |
| ack           | text      | nullable — warm closing line shown after answering       |
| answered_at   | timestamp | nullable — drafted ≠ answered                            |
| created_at    | timestamp | NOT NULL defaultNow                                      |

Constraint: `unique(user_id, local_date)` — one reflection per local day. A row is
created when the prompt is first drafted; answering updates it in place.

New `users` column: `reflection_prompted_date` (text, nullable) — local-date string
of the last evening push, dedup mirror of the hyperfocus columns.

**Privacy invariant (same spirit as brain check-ins):** reflection *content*
(prompt, chips, free text, ack) never appears in the activity feed or any ally
surface. The XP grant writes one content-free activity row ("Evening reflection",
+5) so XP history stays consistent — the fact of reflecting is as shame-safe as a
quest completion; what was said is not, and never leaves the reflections table.

## 2. Chip taxonomy

Fixed enum, defined once in `lib/api-spec/openapi.yaml` so orval generates the
same type for client and server. Two groups:

- **What helped:** `timer`, `small_steps`, `body_double`, `right_time`,
  `low_stakes`, `treat_reward`
- **What got in the way:** `low_energy`, `too_many_switches`, `too_big`,
  `distractions`, `time_slipped`, `pressure`

Multi-select across both groups; empty selection with free text only is valid; a
fully empty answer (no chips, no text) is rejected client-side and server-side.
Chip keys are the machine-learnable signal; labels live client-side. The
key→group mapping (helped vs. hindered) is one shared constant next to the enum,
imported by both `patterns.ts` (for topHelpers/topBlockers) and the client chip
groups — one source of truth.

## 3. Pattern substrate (pure — the heart)

`artifacts/api-server/src/lib/patterns.ts`. One pure function; callers fetch rows.

```ts
interface PatternInputs {
  now: Date;
  timeZone: string;                 // resolved: users.timezone ?? query tz ?? 'UTC'
  completions: { completedAt: Date; category: string;
                 estimatedMinutes: number | null; actualMinutes: number | null }[];
  focusSessions: { startedAt: Date; focusedSeconds: number }[];
  checkins: { mode: string; createdAt: Date }[];
  reflections: { chips: string[] }[];
}

interface PatternSummary {
  windowDays: 28;
  sampleSize: { completions: number; focusMinutes: number;
                checkins: number; reflections: number };
  confidence: 'none' | 'low' | 'ok'; // none <5 completions, low <15, ok otherwise
  powerHours: { hour: number; score: number }[]; // top 3 local hours
  bestDay: number | null;           // 0=Sun…6=Sat, null below confidence 'low'
  medianQuestMinutes: number | null; // from actualMinutes, null if <3 samples
  categoryMinutes: { category: string; medianActual: number; count: number }[];
  modeByBlock: { block: 'morning'|'afternoon'|'evening'|'night';
                 dominantMode: string | null }[];
  topHelpers: string[];             // ≤3 most-picked helped-chips
  topBlockers: string[];            // ≤3 most-picked hindered-chips
}
```

Rules:

- 28-day window ending `now`; all hour/day bucketing through the existing
  `date-buckets` helpers (`localHour`, `localDateKey`) in the resolved tz.
- `powerHours` score = completions in that local hour + focus minutes/25 in that
  local hour (a completed pomodoro weighs about one quest). Ties break toward the
  earlier hour. Empty data ⇒ empty array.
- `bestDay` = weekday with most completions; requires confidence ≥ `low` and a
  strict maximum (ties ⇒ null).
- Category/duration stats use only rows with non-null `actualMinutes`.
- `modeByBlock` blocks match the insights endpoint's period buckets
  (morning 6–12, afternoon 12–17, evening 17–21, night 21–6). Dominant mode
  requires ≥2 check-ins in the block over the window, else null.
- `confidence` gates **all** downstream rendering; the function itself always
  returns a complete object (never throws on empty input).

Endpoint: `GET /users/me/patterns?tz=` → `PatternSummary`. Auth'd; resolves tz
like the insights endpoint (persisted `users.timezone` first, then `tz` query
param, then UTC). Later Act V quests import `derivePatterns` directly — the
endpoint is just the client's window into it.

## 4. Reflection prompt drafting (LLM, fallback-first design)

`artifacts/api-server/src/lib/ai/reflection.ts`, on the existing `generateJson`
Groq seam (15s timeout, JSON mode).

**Day summary builder** (pure): assembles what the LLM may know about today —
completed quest titles + categories (max 6), focus minutes, modes seen (with
coarse time blocks), rescue count ("unblocked yourself N times"), current streak.
**Only positive/neutral facts. Incomplete, overdue, missed, or deleted quests are
structurally absent** — the builder never queries them, so no prompt-engineering
mistake can leak them. This is the anti-shame law enforced at the data boundary,
and a unit test asserts the summary object contains no such fields.

**Question generation:** day summary + `PatternSummary` → one warm, curious
question, ≤140 chars, about process ("what helped / what got in the way"), never
about output or unfinished work. Response contract `{ "question": string }`.
Validation: non-empty, length cap, must not contain banned guilt-words
(`should have`, `didn't`, `only`, `just`, `missed`, `failed`, `behind`). Any LLM
error, timeout, or validation failure ⇒ fallback.

**Fallback rotation:** 12 curated static questions (e.g. "What made starting
easier today?", "When did today feel lightest?"), picked by
`hash(userId + localDate) % 12` so re-opens are stable and consecutive days vary.
`prompt_source` records which path ran.

**Ack generation:** chips + free text → one warm line, ≤120 chars, same banned-word
validation; static fallback pool (~6 lines, e.g. "Noted for your rhythms — rest
well 🌙."). Never blocks the answer from saving: the answer commits first, then the
ack is generated and stored; on failure the fallback ack is stored and returned.

## 5. API routes

`artifacts/api-server/src/routes/reflections.ts`, mounted like the other routers.

**`GET /reflections/today?tz=`** → `{ reflection: Reflection }`
Resolves tz → `localDate`. Returns the existing row, or drafts one: builds day
summary + patterns, generates the question, inserts with
`onConflictDoNothing` + re-select (idempotent under the unique constraint —
concurrent first-opens converge on one row). Draft-on-GET is a deliberate,
documented side effect: it pins the question so re-opens show the same prompt,
and it costs at most one LLM call per user per day.

**`POST /reflections/today`** body `{ chips: ChipKey[], freeText?: string, tz?: string }`
→ `{ reflection: Reflection, xpAwarded: number }`
Validates every chip against the enum (400 on unknown); rejects empty
chips+freeText (400). Upserts today's row (creates with fallback prompt if the
client somehow skipped GET), sets `chips`/`free_text`/`answered_at`, generates
the ack. **First answer of the day** awards +5 XP via the existing points helpers
(`activity` row `type: 'reflection'` with points but a generic description — the
reflection content itself never appears in the feed); re-answers update content,
`xpAwarded: 0`. XP-once is decided by `answered_at IS NULL` inside the same
transaction as the update.

Free text longer than 500 chars is rejected with 400 — no silent truncation.

## 6. Evening push (cron pass)

Inside the existing `POST /api/cron/tick`, a new `reflection-prompt` branch
following the hyperfocus pass's shape. For each user, send when **all** hold:

1. has ≥1 push subscription,
2. has a persisted `users.timezone` (no tz ⇒ silently skip — consistent with
   hyperfocus deep-night handling; reflecting manually still works),
3. local hour ∈ `[19, 22)`,
4. `reflection_prompted_date ≠ localToday` (set it in the same pass — dedup),
5. no answered reflection for `localToday` yet,
6. **≥1 signal today**: a completion, a focus session with ≥1 completed interval,
   or a brain check-in, all bucketed to the user's local day. Zero-signal days get
   no push — nothing to reflect on, and pinging someone about an empty day is a
   guilt vector (anti-shame).

Push copy: title "🌙 How did today feel?", body "1-minute reflection — what worked
today?", deep link `/reflection` (existing per-device push + deep-link machinery).
Send failures go through the existing dead-subscription cleanup.

The push does **not** pre-draft the reflection row; drafting stays lazy on first
open (avoids paying LLM calls for pushes that are never tapped).

## 7. Client UI

- **`/reflection` page** (new route, sheet-style like emergency mode's focused
  layouts): the question, "What helped?" chip group, "What got in the way?" chip
  group, optional textarea ("Anything else? (optional)"), one submit. After
  answering: the ack line + selected chips, calm styling, no metrics. Revisiting
  an answered day shows this closed state (chips remain editable until local
  midnight; edits re-save, no extra XP).
- **Dashboard evening card:** compact CTA ("🌙 Evening reflection · 1 minute")
  visible only while local time ∈ [17:00, 24:00) **and** today is unanswered.
  Answered or past-midnight ⇒ gone. An unanswered day simply disappears — no
  badge, no backlog, no "you missed it" (anti-shame).
- **"Your rhythms" card** at the top of the insights page, fed by
  `GET /users/me/patterns`: power hours ("You're strongest 9–11am"), best day,
  typical quest size ("Most quests take you ~20 min"), top helper ("Small steps
  help you most"). `confidence: 'none'` ⇒ warm empty state ("Still learning your
  rhythms — a few more days of quests will unlock this"); `'low'` ⇒ render only
  powerHours with a "early read" hint; `'ok'` ⇒ full card. Only positive
  framings — the card never renders blockers as "you're bad at X"; `topBlockers`
  feeds the LLM grounding, not this card. (v1 implementation note: the question
  prompt grounds on powerHours and topHelpers only; topBlockers is derived and
  stored in the summary but not yet fed to the LLM - a deliberate
  anti-shame-conservative choice, revisit in a later Act V quest.)

## 8. Anti-shame guardrails (consolidated)

- Day summary structurally cannot contain unfinished/missed work (§4) — unit-tested.
- Banned guilt-word validation on every LLM output; fallback on violation.
- Zero-signal days: no push (§6).
- No reflection streaks, counts, or missed-day surfaces anywhere.
- Reflections and their XP activity rows never reveal content to allies (§1, §5).
- Rhythms card renders strengths only (§7).

## 9. Error handling & edge cases

- **LLM down/slow:** fallback question/ack; the flow never blocks or errors on
  Groq (`isAiConfigured()` false ⇒ straight to fallbacks, matching other AI
  features).
- **No timezone anywhere:** UTC local-date; push skipped; manual flow intact.
- **Concurrent first-GETs:** unique constraint + `onConflictDoNothing` + re-select.
- **Answer without prior GET:** POST self-heals by creating the row with a
  fallback prompt.
- **Local-midnight rollover mid-session:** POST resolves `localDate` at request
  time; an answer submitted after midnight lands on the new day's row (created
  fresh) — acceptable, rare, and never loses data.
- **DST:** all bucketing via `date-buckets` helpers, already DST-stable.
- **Clock skew between card visibility (client) and localDate (server):** cosmetic
  only; server date wins.

## 10. Testing strategy (pure-lib first, per repo convention)

- `patterns.test.ts`: empty input, confidence tiers, tz bucketing (incl. a
  non-UTC tz around midnight), powerHours scoring + tie-break, median rules,
  modeByBlock thresholds.
- `ai/reflection.test.ts`: day-summary builder never emits incomplete-task data
  (anti-shame assertion), question/ack validation + banned words, fallback
  determinism (`hash(userId+localDate)` stability), LLM-failure paths.
- `routes/reflections.test.ts`: GET drafts once (idempotent), unique per day,
  chip-enum validation, empty-answer 400, free-text cap, XP exactly once,
  re-answer updates without XP, tz resolution order.
- Cron branch tests: hour window, dedup column, zero-signal skip, no-tz skip,
  answered-today skip, push payload shape.
- Client component tests (per existing focusquest test conventions): chip
  selection state, submit flow with ack, evening-card visibility window,
  rhythms-card confidence gating.

## 11. Implementation notes / sequencing

1. Schema (reflections table + users column) → drizzle push to Neon (verify no
   other unmerged branch has live schema first, per shared-DB convention).
2. `patterns.ts` pure lib (TDD).
3. `ai/reflection.ts` prompt/ack builders + fallbacks (TDD).
4. Routes (`reflections.ts`, `patterns` endpoint) + OpenAPI spec + orval codegen
   (known conflict surface — regenerate, don't hand-edit).
5. Cron branch.
6. Client: `/reflection` page, dashboard evening card, rhythms card.
7. Full verify: vitest suites (api-server + focusquest), typecheck, manual
   browser pass.

Branch: `feat/act5-reflection-patterns`. Single PR into `main`.
