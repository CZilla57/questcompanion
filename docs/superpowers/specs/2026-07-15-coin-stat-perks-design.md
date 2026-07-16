# Coin-Priced Stat Perks — Design

**Date:** 2026-07-15
**Act:** IV — Play Together (reward economy)
**Status:** Design approved, pending spec review

## Summary

Give the coin economy its first **in-game** sink that boosts the player's own
progression: **Stat Perks** — coin-priced power-ups the user buys to make their
numbers move faster or stay safe. XP answers "who am I becoming"; the Rewards
Store answers "what real-life thing have I earned"; the Mystery Box answers
"give me a dopamine hit right now"; **Stat Perks answer "spend coins to play
stronger."**

This is the third quest of Act IV (after Coins & Real-Life Rewards and Dopamine
Matching). It reuses the coin balance, the atomic guarded-spend pattern, the
internal `coin_transactions` ledger, and the existing `streakFreezes` counter.
It fits free-tier infra (request/response only; no realtime, no cron).

v1 ships **three** perks, each mapped to a headline "stat" the game already
tracks:

| Perk             | Stat it touches | Effect                                                     |
|------------------|-----------------|------------------------------------------------------------|
| ⚡ **XP Boost**   | XP / level      | Quest completions earn **+50% XP** for a timed window (12h)|
| 🎯 **Focus Boost**| XP / level      | Focus-session XP earns **+50%** for a timed window (12h)    |
| 🛡️ **Streak Shield**| streak       | Buy a **streak freeze** with coins (protects a missed day) |

## Design Law: Anti-Shame (non-negotiable)

Inherited verbatim from the coin economy — perks are agency and delight, never
leverage, and (the long-standing **stat-perks law**) they **never gate basics**:

- Perks are **upside-only.** A boost can only *increase* XP; a shield can only
  *protect* a streak. Nothing a perk does can ever reduce XP, level, streak, or
  coins beyond the one-time coin cost of buying it.
- Spending coins on a perk **never** touches XP, level, or streak — the currency
  systems stay fully decoupled. (This is why the Shield is coin-priced here, not
  XP-priced like the legacy streak-freeze purchase.)
- No perk gates a core app function. Not owning a boost is never a wall — it's
  just the normal, un-boosted game, which is fully playable forever.
- Can't-afford is framed as progress (**"N more to go"**), never a denial wall or
  an error. Fully-stocked (Shield at max) is framed as reassurance
  (**"You're fully shielded 🛡️"**), never a failure.
- Buying is celebratory (**"XP Boost active! ⚡"**), never "are you sure you want
  to waste these?"
- Coins never expire; buying a perk is always the user's choice.

**A note on farm-safety.** The two boosts multiply **XP only**, never coins, so
there is no spend-coins-to-earn-coins loop. Their expected coin cost is fixed and
their payout is XP, which is deliberately not spendable. This is the same
upside-but-not-net-gain discipline the Mystery Box used.

## Data Model

**No new tables.** Everything hangs off existing pieces:

### 1. Two new nullable columns on `usersTable`

```ts
xpBoostExpiresAt:    timestamp("xp_boost_expires_at"),     // quest XP boost active until (null = inactive)
focusBoostExpiresAt: timestamp("focus_boost_expires_at"),  // focus XP boost active until (null = inactive)
```

Denormalized "active buff until" timestamps — same idiom as `hyperfocusPausedUntil`
and `lastFedAt`. A boost is **active iff the column is non-null and in the
future**; expiry is derived at read time, never a stored boolean or a cron sweep.
Both are additive and nullable → a safe `drizzle push`.

### 2. `streakFreezes` (existing column) — reused for Streak Shield

The Shield perk increments the existing `users.streakFreezes` counter, so it
plugs straight into the completion flow's existing freeze-consumption logic
(`tasks.ts`: a missed day consumes one freeze instead of resetting the streak).
No new column, no new consumption code. A coin-priced cap of
`MAX_STREAK_FREEZES = 3` keeps the stock meaningful.

The legacy XP-priced purchase (`POST /users/me/streak-freeze/buy`, its own
per-purchase cap of 1) is **left untouched** — it answers a different question
("spend XP") and the two paths coexist on the same counter without conflict.

### 3. `coin_transactions` (existing ledger) — three new reasons

`CoinReason` gains `"perk_xp_boost" | "perk_focus_boost" | "perk_streak_shield"`
(all negative-amount spend rows). Because `reason` is a plain `text` column typed
by a TS union (`$type<CoinReason>()`), **this is a compile-time-only change — no
migration for the union.** (The two new columns are the only schema push.)

## Economy tuning (all constants in `lib/stat-perks.ts`)

All costs, bonuses, and durations are tunable constants — the earn/price ratio is
the only knob. Illustrative starting values:

| Perk          | Cost | Effect                        | Notes                                   |
|---------------|------|-------------------------------|-----------------------------------------|
| XP Boost      | 40   | +50% quest XP, 12h            | ~8 quests to afford; sits between Small(20) and Medium(60) reward tiers |
| Focus Boost   | 40   | +50% focus-session XP, 12h    | ~4 focus sessions to afford             |
| Streak Shield | 30   | +1 streak freeze (max 3 held) | cheaper than the boosts; a safety buy   |

- `XP_BOOST_BONUS = 0.5`, `XP_BOOST_HOURS = 12`
- `FOCUS_BOOST_BONUS = 0.5`, `FOCUS_BOOST_HOURS = 12`
- `STREAK_SHIELD_COST = 30`, `MAX_STREAK_FREEZES = 3`

**Re-buying a boost that's already active *extends* the window** (stacks
duration from the later of now / current expiry), so a user is never punished for
topping up early.

## Pure logic (`artifacts/api-server/src/lib/stat-perks.ts`, unit-tested)

- `PERKS` — the catalog array (`id`, `kind`, `label`, `emoji`, `description`,
  `coinCost`, ledger `reason`). `getPerk(id)`, `isValidPerkId(id)`.
- `isBoostActive(expiresAt: Date | null, now: Date): boolean` — non-null and
  strictly in the future.
- `boostBonusPoints(basePoints, active, bonus): number` — `active ?
  round(basePoints * bonus) : 0`. Shared by both boosts.
- `nextBoostExpiry(current: Date | null, now: Date, durationHours): Date` —
  stacking extension from `max(now, current)`.
- `canBuyStreakShield(currentFreezes): boolean` — `currentFreezes <
  MAX_STREAK_FREEZES`.
- Affordability reuses `redeemDecision(balance, cost)` from `./coins`
  (`{ affordable, remaining }`) — no duplicate math.

## Earning integration (the boosts apply at XP-award time)

Both boosts are applied **inside the existing completion transactions**, on top
of whatever XP was already computed — purely additive, so they can never lower a
payout.

- **XP Boost** — `routes/tasks.ts` quest-completion tx (the single site that runs
  the streak multiplier). After the existing
  `applyMultiplier(task.points, streakDays)` result, add
  `boostBonusPoints(task.points, isBoostActive(user.xpBoostExpiresAt, now), XP_BOOST_BONUS)`
  to `pointsToAdd`. The streak multiplier is untouched; the perk stacks beside it.
- **Focus Boost** — `routes/focus-sessions.ts` per-interval credit **and** the
  early-`/complete` partial path. Fold
  `boostBonusPoints(baseDelta, isBoostActive(user.focusBoostExpiresAt, now), FOCUS_BOOST_BONUS)`
  into `xpDelta` before it hits `totalPoints`/`weeklyPoints`/`xpAwarded`. The
  activity-feed rows keep their base points (per-interval granularity, as today);
  the session/user totals carry the boost.

No changes to XP math for questlines or the weekly boss (they award flat XP with
no multiplier path — out of scope for v1, note below).

## API (Express + orval codegen, existing conventions)

Authed router; 401 when `!req.isAuthenticated()`; `userId = req.gameUserId`.

- `GET /stat-perks` → `StatPerks`
  `{ balance, perks: StatPerk[] }`. Each `StatPerk` is the catalog entry plus
  live state computed against the user:
  `{ id, kind, label, emoji, description, coinCost, affordable, remaining,
     active, expiresAt, owned, atMax }`.
  - Boost perks populate `active` + `expiresAt` (`owned`/`atMax` null).
  - Shield populates `owned` (current freezes) + `atMax` (`active`/`expiresAt` null).
  Single source of truth so the client never hard-codes costs or effects.

- `POST /stat-perks/:id/buy` → `StatPerkPurchaseResult` (always HTTP 200 for the
  anti-shame outcomes; 401 auth only; 404 unknown perk id):
  - Insufficient balance → `{ purchased: false, reason: "insufficient", affordable: false, balance, remaining }`.
  - Shield at max → `{ purchased: false, reason: "at_max", affordable: true, balance, remaining: 0 }`.
  - Success → `{ purchased: true, reason: "ok", affordable: true, balance, remaining: 0, expiresAt?, owned? }`
    where `balance` is the **final** balance after the spend.

  The user row is locked `FOR UPDATE`, so the read-decide-write (compute the
  stacked expiry / check the shield cap, then decrement + apply + ledger row) is
  atomic; a concurrent double-buy can neither overspend nor exceed the cap. The
  coin decrement is a guarded conditional write, so the balance can never go
  negative.

## UI (`artifacts/focusquest/src`)

Co-located on the existing **Rewards Store page** (`/rewards`) as a second
section — making that page the single "spend your coins" destination (real-life
rewards **+** in-game power-ups). No new route, no new nav item (the 12-item nav
stays put). This mirrors how the Mystery Box reused the Dopamine Menu page.

- A **`StatPerksSection`** rendered above the real-life rewards list. Header
  "Power-Ups" with a one-line "spend coins to play stronger" subtitle.
- One card per perk: emoji, label, description, cost, and a state-driven action:
  - Boost inactive & affordable → **Buy (40 🪙)**.
  - Boost active → a calm "Active · {countdown} left" chip (buying again extends).
  - Shield below max & affordable → **Buy (30 🪙)**; shows "{owned}/3 held".
  - Shield at max → "Fully shielded 🛡️" (not an error).
  - Unaffordable (any) → "🪙 {remaining} more to go" (never an error).
- Buying invalidates `GET /stat-perks`, `GET /coins` (header chip), and
  `GET /users/me/stats` (streak-freeze count surfaces there). Toasts:
  celebratory on success ("XP Boost active! ⚡", "Focus Boost active! 🎯",
  "Streak Shield ready 🛡️"), gentle "N more to go" / "You're fully shielded"
  otherwise. Respects the existing toast patterns.

## Testing (TDD)

Pure units (`stat-perks.test.ts`), matching the api-server no-DB-harness
convention:

- `isBoostActive`: null → false; past → false; exactly-now → false (strict
  future); future → true.
- `boostBonusPoints`: inactive → 0; active → `round(base * bonus)`; rounding
  (e.g. 15 × 0.5 → 8).
- `nextBoostExpiry`: from null → now + duration; from a past expiry → now +
  duration; from a future expiry → **stacks** (current + duration).
- `canBuyStreakShield`: below max → true; at/above max → false.
- `getPerk` / `isValidPerkId`: known ids resolve; unknown → undefined / false.
- `PERKS` catalog exposes the tunable costs/effects.

Route/earn/UI verified via `pnpm typecheck` + driving the running app (project
`/verify`), per the coins-plan Global Constraints — no DB/route harness invented.

## Out of Scope (v1)

- Boosts on questline-claim or weekly-boss XP (those award flat XP with no
  multiplier path; adding one is a separate change).
- A Coin Boost perk (would create a spend-coins-to-earn-coins farm; deliberately
  excluded to stay upside-but-not-net-gain).
- Perk purchase history UI (the ledger stays internal, as in the sibling quests).
- Per-user configurable costs/durations/odds.
- Migrating or removing the legacy XP-priced streak-freeze purchase.
- Stacking two *different* boosts into a single combined multiplier (each applies
  to its own earn site; they don't interact).

## Dependencies & Constraints

- Free-infra only (request/response). No realtime, no new cron. Expiry is derived
  at read time — nothing needs to "turn a boost off" on a schedule.
- One additive schema push (two nullable timestamp columns). The `CoinReason`
  union edit is compile-time only. Heed the shared-DB caution before pushing
  (this branch's change is additive-only, so safe to add).
- Codegen pipeline (orval → `@workspace/api-zod` + `@workspace/api-client-react`)
  must run after the OpenAPI edit; generated files are never hand-edited.
