# Living Companion — Design

**Act:** VI — A Living World (quest 1 of 5)
**Date:** 2026-07-17
**Status:** Approved, ready for implementation plan
**Related:** [[project-hero-care]] (PR #35), [[project-hero-character-system]], [[project-cron-endpoint]], [[project-feature-roadmap]]

## Thesis

The hero-care base (PR #35) gave the hero **one** thing to react to: hunger, derived
purely from `users.lastFedAt`. The Living Companion makes the hero feel *alive* by
giving it more of your life to respond to — your streaks, your rest days, your returns
after time away — and a **light, persisted bond** that only ever grows. It reacts, and
it remembers that you keep showing up.

Everything obeys the campaign's **Anti-Shame Design law**: rest reads as rest, returns
are warm, and the bond never shrinks when you're gone.

## Scope (decisions locked during brainstorm)

- **Depth:** reactive ambient layer **+ a light persisted bond**.
- **Reacts to:** streak momentum & milestones · honored rest days · welcome-back after
  absence · level-ups & big wins.
- **Bond metric:** lifetime quests completed — **monotonic, never decremented**.
- **Surface:** an in-app "companion says" reaction line + **streak-milestone celebration
  pushes only** (hunger already owns absence nudging; welcome-back is in-app).
- **Copy engine:** pure derived beat-engine + **curated** deterministic copy (no LLM).
  Mirrors the existing `hero-care.ts` / `hero-flavor.ts` pattern exactly.

Out of scope for v1: LLM-voiced lines, absence re-engagement pushes, tappable companion
dialog, bond-gated unlocks/gifts. All can layer on later without rework.

## Core model: the "beat"

A **beat** is the single most-salient thing the companion is reacting to right now.
Derived, never stored — like `hungerStage`. Beats live in two homes because some are
"current state" and some are "just happened":

### A. Ambient beats — computed at read time in `GET /users/me/hero-status`

Derived from current stored state, so no "just" detection or storage is needed:

| Beat | Condition | Notes |
|------|-----------|-------|
| `welcome_back` | day-gap between `lastActiveDate` and local today **≥ 3** | Self-clears the moment a quest is completed (gap → 0). Warm, never a red missed-day wall. |
| `streak_milestone` | `streakDays ∈ {3, 7, 14, 30, 50, 100, 200, 365}` | Shows all day on a milestone day. |
| `rest_day` | day-gap of **1–2** | Honored as rest, never failure. |
| `ambient` | none of the above | Bond-colored greeting that pairs with the existing "Currently: …" vignette. |

**Precedence (most salient first):** `welcome_back` → `streak_milestone` → `rest_day`
→ `ambient`.

**Relationship to hunger:** the hunger `mood` + vignette (`activity`) stay their own
display. The companion line is **additive** — a separate relational line. Guard: when the
hero is `starving` or `fainted`, the `ambient` greeting yields to hunger (no chirping over
a fainted hero); `welcome_back` still shows, warmly.

**Day-gap math** uses the existing `date-buckets.ts` helpers: `localDateKey(now, tz)` for
"today" in the user's zone (`resolveTimeZone(user.timezone)`), compared against the stored
`lastActiveDate` (YYYY-MM-DD). Gap = whole-day difference computed on UTC anchors of the
two date keys (same technique as `buildDayDates`). `lastActiveDate === null` (brand-new
user) ⇒ no rest/absence beat.

### B. Completion-moment reactions — on `TaskCompletionResult`

A new optional `companionReaction?: string` field, populated **inside the completion
transaction** when a "just happened" event fires (these are knowable there because the
result already carries `leveledUp` / `newLevel`):

**Precedence:** `bond_tier_up` (bond crossed a tier threshold this completion) →
`leveled_up`. Revival already has its own toast (`heroRevived`); the companion does not
duplicate it.

## The bond (persisted, monotonic)

- **New column** `bondQuestsCompleted` (`integer`, `not null default 0`), incremented in
  the **same completion transaction** that stamps `lastFedAt`.
- **Never decremented** — not on un-complete, not on task delete. This is the core
  anti-shame invariant: the bond only ever grows.
- Pure `bondTier(n)` → 5 tiers:

  | Tier | Name | Lifetime quests |
  |------|------|-----------------|
  | 0 | Newly Met | 0–9 |
  | 1 | Trusted | 10–49 |
  | 2 | Steadfast | 50–149 |
  | 3 | Kindred | 150–399 |
  | 4 | Legendary Bond | 400+ |

  The tier name colors the `ambient` greeting and is shown near the vitality bar.
  `bond_tier_up` fires when a completion moves `bondQuestsCompleted` across a threshold
  (compare tier of `before` vs `before + 1` in the transaction).

## Pure libs (testable, zero cost)

Mirrors `hero-care.ts` / `hero-flavor.ts`:

- **`companion.ts`**
  - `bondTier(n): { tier: number; name: string; minQuests: number }`
  - `deriveCompanionBeat(ctx): CompanionBeat` — the precedence engine. `ctx` =
    `{ streakDays, lastActiveDate, localToday, hungerStage, bondTier }`.
  - `companionPush(streakDays, notifiedMilestone): { title; body; tag } | null` —
    cron payload + dedup, streak-milestone only.
  - `STREAK_MILESTONES`, absence/rest gap constants exported for tests.
- **`companion-copy.ts`**
  - Curated line pools keyed by beat kind (and bond tier for `ambient`), picked
    deterministically via the existing `hashSeed` + 3-hour time-bucket rotation (as
    vignettes do). Optionally class-aware later; not required for v1.
  - `companionLine(beat, ctx, now): string`.

## Pushes (cron `checkCompanion`, streak-milestones only)

- **New column** `companionMilestoneNotified` (`text`, nullable) — stores the last
  milestone streak value pushed (e.g. `"7"`), mirroring `hungerNotifiedStage`. Prevents
  re-pushing the same milestone.
- Per-user `checkCompanion(user)` in the cron `tick()`:
  - Fires a **streak-milestone celebration push** when `streakDays ∈ STREAK_MILESTONES`
    and `companionMilestoneNotified !== String(streakDays)`; then stamps the marker.
  - **Reset rule:** when `streakDays` drops below the lowest milestone (`< 3`), clear
    `companionMilestoneNotified` so a rebuilt streak can celebrate again.
  - **Mutual exclusion:** extends the existing "never two hero pushes in one tick" rule
    (hunger warning vs flavor) — the companion push never stacks on a hunger/flavor push
    in the same tick. Tag: `companion`.

## API surface

- `GET /users/me/hero-status` response gains companion fields (additive, non-breaking):
  - `companion: { beat: CompanionBeat["kind"]; line: string; bondTier: number;
    bondTierName: string; bondQuestsCompleted: number }`.
- `TaskCompletionResult` gains `companionReaction?: string | null`.
- OpenAPI spec + regenerated zod/react clients updated accordingly (expect the usual
  shared-schema regen; see [[reference-shared-live-db-branches]]).

## Frontend

- `HeroVitality` (or the hero-summary area) renders the companion line and the bond-tier
  name/badge next to the existing mood + vignette. When `beat === "ambient"`, the vignette
  remains the primary "Currently: …" line and the companion greeting is the softer accent;
  for salient beats the companion line leads.
- On task completion, if `companionReaction` is present, surface it in the existing
  completion celebration (toast), alongside level-up / revival messaging.
- `hero-status` query invalidated on completion (already wired in `task-item.tsx`).

## Anti-shame invariants (made testable)

1. `bondQuestsCompleted` never decreases (no decrement on un-complete or delete).
2. `rest_day` copy reads as rest, never failure.
3. `welcome_back` copy is warm — no guilt, no missed-day wall.
4. No companion push ever stacks on a hunger/flavor push in the same tick.
5. Streak-milestone push fires at most once per milestone per episode.
6. Ambient greeting yields to hunger when `starving`/`fainted`.

## Testing

Unit tests on the pure libs (the bulk of coverage):
- `deriveCompanionBeat`: every beat + full precedence matrix, gap boundaries (0/1/2/3),
  null `lastActiveDate`, hunger-guard on ambient.
- `bondTier`: threshold boundaries (9/10, 49/50, 149/150, 399/400) and `bond_tier_up`
  crossing detection.
- `companionPush`: milestone hit/miss, dedup, reset-below-3.
- `companion-copy`: snapshot the curated pools so anti-shame tone can't silently regress;
  determinism of the seeded pick.

Integration/route tests:
- Completion transaction increments `bondQuestsCompleted`; un-complete does **not**
  decrement it; `companionReaction` set on level-up / tier-up.
- `hero-status` returns the expected companion block for representative states.
- Cron `checkCompanion` mutual-exclusion with hunger/flavor in one tick.

## Data model summary (2 new columns)

```
users.bondQuestsCompleted      integer  not null default 0   -- monotonic bond metric
users.companionMilestoneNotified text    nullable            -- streak-push dedup marker
```

Live-schema push follows the usual flow ([[reference-shared-live-db-branches]],
[[feedback-run-drizzle-push]]): coordinate the Neon `drizzle push` given the shared DB
across branches.
