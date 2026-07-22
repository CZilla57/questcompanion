# Quest Campaigns — Design

**Date:** 2026-07-22
**Parent:** Act VI "A Living World", quest 3 ([[project-feature-roadmap]]). Clearing this takes the
campaign to 36/38 = 95%, Act VI 3/5.
**Builds on:** [[project-questlines]] (PRs #29–#32), the Gentle Door ladder
([[project-gentle-door]]), the Steady Ground data registry ([[project-steady-ground]]).

## Problem

Questlines chain one-off quests toward a goal, but they are flat and finite. A goal that takes
weeks — "make the garage usable", "get back into shape" — needs several questlines, and nothing
in the app holds them together or says why they belong to each other. Worse, once a questline is
claimed the thread ends: there is no *next*, so long-horizon work quietly dissolves into a pile of
unrelated groups.

Quest Campaigns adds the tier above questlines **and** the narrative that makes finishing one
chapter pull you toward the next.

## What it is

A **Campaign** is one long-horizon goal, told as a story arc:

- **Campaign** → **Questlines (chapters)** → **Quests**
- The campaign carries an *arc premise* (why this matters, in fantasy framing) and an *ending beat*.
- Each chapter carries a *beat* — the line you get when that chapter clears.
- The work is entirely real. Only the framing is fantasy.

Exactly one campaign is **running** at a time. Everything else is set aside or completed.

## Decisions (locked with Chad, 2026-07-22)

| # | Decision | Choice |
|---|---|---|
| D1 | Core shape | A tier above questlines **plus** a story arc |
| D2 | Story source | AI-generated at creation, **curated fallback** so creation never fails |
| D3 | Creation | Both: create-from-goal (AI cascade) **and** adopt existing questlines |
| D4 | Chapter order | Ordered, **never gated** — every quest stays workable |
| D5 | Reward | Modest XP claim + the ending beat |
| D6 | Drift | Nothing changes, warm return; manual set-aside; **zero pushes** |
| D7 | Active limit | **One running campaign**, others set aside |
| D8 | World tie-in | Self-contained — no Life Kingdoms or hero coupling in v1 |
| D9 | Architecture | New `campaigns` table + chapter columns on `questlines` |

## Data model

### New table `campaigns` (`lib/db/src/schema/campaigns.ts`)

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `user_id` | int NOT NULL → users | denormalized ownership, matching `questlines` |
| `title` | text NOT NULL | the real goal, user-editable |
| `arc_premise` | text | story text, **snapshotted at creation** |
| `ending_beat` | text | finale text, snapshotted at creation |
| `story_source` | text NOT NULL | `'ai' \| 'curated'` — which path produced the text |
| `status` | text NOT NULL default `'running'` | `'running' \| 'set_aside' \| 'completed'` |
| `reward_xp_awarded` | int | claim snapshot, mirrors `questlines.reward_xp_awarded` |
| `completed_at` | timestamp | |
| `set_aside_at` | timestamp | |
| `created_at` | timestamp NOT NULL default now | |

**Partial unique index** `campaigns_one_running_per_user` on `(user_id) WHERE status = 'running'`.
The DB is the guard for D7, not just the route.

### Additive columns on `questlines`

- `campaign_id` int NULL → campaigns, **`onDelete: "set null"`**
- `chapter_order` int NULL
- `chapter_beat` text NULL

One migration, all additive. No backfill: every existing questline is simply campaign-less.

### Invariants

1. **`ready-to-claim` is derived at both tiers, never stored.** A campaign is ready ⟺
   `status = 'running'` ∧ chapters ≥ 1 ∧ every chapter questline `status = 'completed'`.
   Mirrors `isReadyToClaim` in `lib/questlines.ts`.
2. **At most one running campaign per user** — enforced by the partial unique index. Starting a
   second campaign sets the current one to `set_aside` inside the same transaction.
3. **Deleting a campaign never deletes work.** `set null` unlinks its questlines; they survive as
   ordinary questlines with their quests intact — the same promise questlines make to quests. The
   delete transaction also clears `chapter_order` and `chapter_beat`, so a freed questline never
   carries narration from a campaign it has left.

### Amendments ruled during implementation (2026-07-22)

These were not in the original design. They are load-bearing — read them before changing anything
about claiming or chapter membership.

- **ONE CAMPAIGN PER QUESTLINE, EVER.** Recycling completed questlines through fresh campaigns was
  an unlimited-XP hole. Three rules close it, with no migration: attaching a questline that already
  belongs to another campaign is a 409; a completed campaign's chapters can never be detached; a
  completed campaign can never be deleted (it is a permanent chronicle entry).
- **`completed` is terminal.** `canTransition(from, to)` refuses any transition out of `completed`,
  and `isCampaignReadyToClaim` additionally requires `reward_xp_awarded IS NULL`, so the claim is
  idempotent even if a future status path forgets the guard. Without this, a completed campaign
  could be reopened and re-claimed forever.
- **Lock order is campaign-before-questline on every path that touches both tables.** The claim
  locks user → campaign → chapters; the questline route peeks unlocked, locks the campaign, locks
  the questline, then re-verifies `campaign_id` under the lock. Deviating reintroduces either a
  race (a detach freeing a chapter mid-claim) or a deadlock.
- **The adopt path has a UI**, and chapters can be removed as well as added — add-only made one
  mis-added chapter block the claim forever.
- **The chapter cap is client-side only.** `PATCH /questlines/:id` has no chapter-count limit;
  the UI hides the add control at five. Exceeding five costs the user work for no extra reward.
4. **XP monotonicity holds** (standing guard from [[project-honest-coin]]): the claim only ever
   adds. No campaign path decrements XP.
5. **Registry:** `campaigns` is added to `USER_DATA_TABLES` **after** `questlines` in the delete
   order, since questlines reference it. The schema-walking guard test fails CI if omitted.

## Pure logic (`artifacts/api-server/src/lib/campaigns.ts`)

Mirrors the `lib/questlines.ts` style — pure, unit-tested, no DB:

- `computeCampaignProgress(chapters: { status: string }[]) → { total, done }`
- `isCampaignReadyToClaim(campaign, progress) → boolean`
- `computeCampaignRewardXp(chapterCount) → number` — **50 XP × chapters, capped at 5 chapters
  (250 XP max)**. Deliberately modest: the same work already pays per-quest XP and per-questline
  claim XP (up to 200).
- `nextChapter(chapters) → chapter | null` — first chapter that is not completed, by
  `chapter_order`. Drives the "current chapter" pointer and the Now-screen line.
- `renumber(orderedIds) → { id, chapterOrder }[]` — pure sequence normalizer used by reorder,
  detach, and delete.

## Story generation

### `lib/ai/campaign-arc.ts` (pure)

Same shape as `lib/ai/questline-quests.ts`:

- `buildCampaignArcPrompt(goal)` — asks for `{ arcPremise, endingBeat, chapters: [{title, beat}] }`,
  **3–5 chapters**, ADHD-first rules carried over: first chapter is a tiny no-decision start, no
  comfort rituals, no vague verbs, never restate the goal as a chapter.
- `parseCampaignArc(raw)` — throws `CampaignArcParseError` on shape mismatch; trims, caps lengths,
  clamps chapter count.
- `suggestCampaignArc(goal, generate)` — takes the existing `GenerateJson` seam.

### `lib/campaign-arc.ts` (pure, curated)

3–4 hand-written arcs (The Long Haul, The Reclamation, The Steady Climb) as chapter-count-indexed
beat sets, plus premise and ending. Goal-agnostic prose, so it reads correctly without knowing the
goal.

`buildArc(goal, chapterCount, ai?)` returns AI text when available and curated text otherwise —
**key unset, timeout, parse failure, or cooldown all land on curated**. The route stamps
`story_source` accordingly.

**Campaign creation never fails because of the model.** In the curated path the preview opens with
empty chapter *title* fields (you name your own chapters) and curated beats already attached — the
fallback degrades the prose, never the structure.

## API

| endpoint | behavior |
|---|---|
| `POST /campaigns/suggest-arc` | Side-effect-free. Returns `{ arcPremise, endingBeat, chapters }`. Reuses `suggest-cooldown` and the existing 400/503/429/502 ladder. |
| `POST /campaigns` | **Atomic**: campaign + chapter questlines in order + optional quests per chapter, one transaction. Zero chapters is legal — that is the adopt-only path (create an empty campaign, then attach existing questlines); a chapter-less campaign is simply never ready to claim. Extends the `POST /questlines` + `questTitles` pattern one tier up. Sets any prior running campaign to `set_aside` in the same tx. |
| `GET /campaigns` | Running + set-aside + completed, with rolled-up chapter progress. |
| `GET /campaigns/:id` | Detail: premise, ordered chapters, each chapter's quest progress, derived `readyToClaim` and `currentChapterId`. |
| `PATCH /campaigns/:id` | title / premise / ending edits; `status` transitions `running ↔ set_aside` (resume re-checks the single-running rule in-tx). |
| `PATCH /campaigns/:id/chapters` | Full ordered questline-id list — one write, so two rows can never disagree about position. |
| `POST /campaigns/:id/claim` | Row-locked tx (user row → campaign row, the existing lock order), grants XP, snapshots `reward_xp_awarded`, sets `completed`, emits `campaign_complete` activity. **409** when not-ready or already-claimed — no double award, no re-open. |
| `DELETE /campaigns/:id` | Unlinks chapters (`set null`), deletes the campaign row. |
| `PATCH /questlines/:id` | Learns `campaignId` + `chapterOrder`, exactly as `PATCH /tasks/:id` learned `questlineId`. Detaching nulls both and renumbers the rest. |

**Adopting an already-completed questline is allowed** and counts as a cleared chapter — if you did
the work, it counts.

## Surfaces

**Pages.** `/campaigns` (running one large; set-aside on a quiet shelf; completed in a
"chronicle") and `/campaigns/:id` (premise, ordered chapters with the current one marked, real
quest progress per chapter).

**Nav.** A third tab in the existing **Quests** tab-group, beside Quest Log and Questlines. No new
top-level entry — the 7/5 nav counts from [[project-now-screen]] are untouched.

**Gentle Door.** One new feature key, `campaigns`, at **L4** (the progress band), gating the tab.
Locked = invisible; pacing not authorization (API stays open); fails open when `unlockedFeatures`
is absent. Two-line addition to `api-server/src/lib/feature-gates.ts` and its client mirror.

**Beats reuse existing celebration moments — no new interrupt is introduced:**

- Chapter cleared → `chapter_beat` rides the **existing questline claim celebration**.
- Campaign cleared → `ending_beat` in the campaign claim celebration + a permanent chronicle entry.
- Activity: **only** `campaign_complete` is written (added to the spec's `ActivityItem.type`
  enum — see gotcha below). A chapter clear writes nothing extra, because chapters ARE
  questlines and already emit `questline_complete`; a second row would double-report the same
  work in the feed and fire ally cheers twice (decided 2026-07-22). `campaign_complete` joins
  `MILESTONE_TYPES` so allies can cheer it, the same hook `questline_complete` uses.

**Now screen.** One compact line when a running campaign exists — *"Chapter 2 of 4 — Clear the
back wall"* — linking through. Nothing when there is no running campaign. It sits under the
momentum suggestion as context, never competing with it.

## Anti-shame behavior (D6)

- No decay, no stalled state, no gap counters, and **no notifications of any kind** in v1.
- Set aside is one tap, reversible, worded as a choice you made — never as failure.
- Reopening after a long gap shows a waited-for-you line, following the Living Companion
  welcome-back precedent ([[project-living-companion]]).
- Chapters are ordered but never gated: the quest you have energy for today is always workable,
  whatever chapter it is in.
- Empty/abandoned campaigns delete quietly; the quests survive.

## Error handling

- AI unavailable → curated arc, `story_source='curated'`, no user-visible error.
- Cooldown hit on `suggest-arc` → 429, preview offers the curated arc immediately.
- Claim on a not-ready or already-claimed campaign → 409 (`apiErrorMessage` surfaces the server
  message; never sniff message text — branch on `ApiError.status`).
- Second running campaign via a race → unique-index violation (pg 23505), caught by the same
  cause-chain walk `lib/rename.ts` uses, returned as a clean 409.
- Attaching a recurring-spawned quest is impossible by construction: chapters are questlines, and
  `isQuestlineAssignable` already blocks recurring quests from questlines.

## Testing

- **Pure libs first (TDD):** `campaigns.ts` (progress, ready, reward curve incl. the 5-chapter cap,
  `nextChapter`, `renumber`), `campaign-arc.ts` (curated selection is deterministic and total),
  `ai/campaign-arc.ts` (prompt shape, parse happy/malformed/short/over-long).
- **No route-level harness exists** in this repo (no supertest; `api-server` tests are pure-lib
  vitest only). Route correctness is therefore proven the way Body-Doubling proved it: push every
  decision that can be tested into the pure libs above, then a **live authed drive** against the
  running server covering create → adopt → reorder → claim → 409 on re-claim, plus 401 probes on
  each new route. Do not invent a route-test harness as part of this quest.
- **Registry guard:** the existing schema-walking test must pass with `campaigns` registered in
  FK-safe order.
- **Client:** gate hides the tab below L4 and fails open without `unlockedFeatures`; preview
  keep/drop/edit; claim celebration renders the ending beat.

## Known gotchas carried in

- `ActivityItem.type` is a **spec enum** — new activity types must be added in `openapi.yaml` or the
  web feed cannot render them ([[project-body-doubling-rooms]]).
- orval names an inline request-body zod const and its TS type identically → collision. Use named
  `$ref` input schemas (`CampaignInput`, `CampaignArcInput`).
- orval hooks with query params take `(params, options)`; an explicit `queryKey` is required when
  overriding query options under TanStack Query v5 ([[project-gentle-door]]).
- Route responses are un-annotated object literals, so typecheck does **not** enforce newly
  required OpenAPI fields — emit deliberately and grep the diff.
- Migrations are generated now; `drizzle push` is removed ([[reference-dev-commands]]). The
  migration is applied to live Neon before the PR merges, per standing instruction.

## Out of scope (v1)

- Life Kingdoms / hero coupling (D8) — possible later increment.
- Campaign templates shared between users, or any social/shared campaign.
- Campaign-level notifications or scheduled nudges (D6).
- Re-opening a completed campaign; re-generating story text after creation.
- Multiple simultaneous running campaigns (D7).

## Rollout

Single implementation PR off `main`, subagent-TDD per house workflow. Migration applied and
verified on live Neon pre-merge. After merge: refresh the campaign-map artifact to 36/38 = 95%
(Act VI 3/5) and update [[project-feature-roadmap]] plus a new `project-quest-campaigns` memory.
