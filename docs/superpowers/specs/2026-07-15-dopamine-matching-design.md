# Dopamine Matching (Mystery Box) — Design

**Date:** 2026-07-15
**Act:** IV — Play Together (reward economy)
**Status:** Design approved, pending spec review

## Summary

Give the freshly-shipped **coin economy** its first *in-app* coin sink: the
**Mystery Box**. The user spends a small fixed number of coins to pull a
**random reward from their own Dopamine Menu**, revealed with a slot-machine
flourish, plus a variable, upside-only coin bonus. XP answers "who am I
becoming"; the Rewards Store answers "what real-life thing have I earned";
the Mystery Box answers "give me a small, surprising dopamine hit *right now*."

This is the second quest of Act IV after Coins & Real-Life Rewards. It reuses
the coin balance, the atomic guarded-spend pattern, the internal ledger, and
the existing `dopamine_rewards` catalog — **no new tables**. It fits free-tier
infra (request/response only; no realtime, no cron).

## Motivation

The Dopamine Menu already suggests a *free* random reward after each quest
completion (the `DopamineOverlay`). That's passive and completion-gated. The
Mystery Box makes the same catalog an **on-demand, agency-driven** action the
user chooses to spend coins on, with two ADHD-friendly hooks the free overlay
lacks:

1. **Anticipation** — a brief reveal animation (variable-ratio dopamine, the
   healthy kind: the *reward* is variable, never the *cost*).
2. **A reason to hold coins that isn't a big-ticket save-up.** The Rewards Store
   is a slow burn (Treat = 400 coins). The Mystery Box is a cheap, frequent,
   playful spend that keeps small coin balances meaningful.

It also gives the Dopamine Menu page a second purpose beyond list management.

## Design Law: Anti-Shame (non-negotiable)

Inherited verbatim from the coins economy — the Mystery Box is delight, never
leverage:

- The Mystery Box **never returns nothing.** Every successful pull reveals a
  real reward from the user's menu. There is no "you lost" outcome.
- The variable bonus is **upside-only.** A pull costs a fixed amount; the bonus
  is 0 or positive, capped at the cost (best case = "free pull," net zero — the
  balance can never *increase* from a pull, so there is no farm and no gamble
  with a downside).
- Coins spent here **never** touch XP, level, or streak.
- Can't-afford and empty-menu are framed as **progress / an invitation**
  ("18 more to go," "Add rewards to your menu first"), never a denial wall or an
  error. Both return HTTP 200 with an outcome flag, exactly like Store redeem.
- Coins never expire; opening is always the user's choice.

## Data Model

**No new tables.** Three existing pieces are reused:

1. `users.coinBalance` — spent (and, on bonus, credited) via the same atomic
   guarded-write + `awardCoins` helpers the Store already uses.
2. `coin_transactions` — the append-only internal ledger. Two new `CoinReason`
   values are added: `"mystery_open"` (negative, the spend) and
   `"mystery_bonus"` (positive, the rebate). Because `reason` is a plain `text`
   column typed by a TS union (`$type<CoinReason>()`), **this is a
   compile-time-only change — no DB migration / `drizzle push` is required.**
3. `dopamine_rewards` — the pool the box draws from (read-only here). Deleting a
   reward simply shrinks the pool; nothing to reconcile.

Consistent with the Dopamine Menu's "no usage tracking" philosophy, the pull
itself is **not** persisted beyond the coin ledger rows. There is no
`mystery_pulls` table.

## Economy tuning (all constants in `lib/mystery-box.ts`)

- `MYSTERY_COST = 15` — cheaper than the smallest Store tier (20), so it reads as
  the light, frequent spend. Earnable in ~3 quests.
- Variable bonus (rolled per pull, upside-only, expected value well below cost so
  the box stays a genuine sink):

  | roll ∈ [0,1)      | bonus | flavour            |
  |-------------------|-------|--------------------|
  | `[0.00, 0.60)`    | 0     | (most pulls)       |
  | `[0.60, 0.90)`    | 5     | "a few coins back" |
  | `[0.90, 0.99)`    | 10    | "nice — half back" |
  | `[0.99, 1.00)`    | 15    | "free pull! 🎉"    |

  Expected bonus ≈ `0.30·5 + 0.09·10 + 0.01·15 = 2.55` coins vs. a 15-coin cost
  → net ≈ −12.5 coins per pull. A real sink with an occasional delight, never a
  net gain.

All amounts are tunable constants — the earn/cost/bonus ratio is the only knob.

## Pure logic (`artifacts/api-server/src/lib/mystery-box.ts`, unit-tested)

- `MYSTERY_COST`, `MYSTERY_BONUS_TIERS` — exported constants.
- `mysteryBonus(roll: number): number` — maps a `[0,1)` roll to a bonus via the
  table above.
- `canOpenMystery(balance, rewardCount): { canOpen, reason, remaining }` where
  `reason ∈ "ok" | "no_rewards" | "insufficient"` and `remaining` is
  `max(0, cost − balance)` (0 unless insufficient). Pure gate the route and the
  UI card both consume.
- `rollMystery(rewardCount, rng): { rewardIndex, bonus }` — pure given an
  injected `rng: () => number`; picks a uniform reward index and rolls the bonus.
  The route passes `Math.random`; tests pass a stub.

## API (Express + orval codegen, existing conventions)

Authed router; 401 when `!req.isAuthenticated()`; `userId = req.gameUserId`.

- `GET /mystery-box` → `MysteryStatus`
  `{ cost, balance, rewardCount, canOpen, reason, remaining }`. Single source of
  truth for the card's state (so the client never hard-codes the cost).

- `POST /mystery-box/open` → `MysteryResult` (always HTTP 200 for the anti-shame
  outcomes; 401 only for auth):
  - No menu rewards → `{ opened: false, reason: "no_rewards", cost, balance, remaining: 0 }`.
  - Insufficient balance → `{ opened: false, reason: "insufficient", cost, balance, remaining }`.
  - Success → `{ opened: true, reason: "ok", cost, balance, bonus, reward: { id, rewardText } }`
    where `balance` is the **final** balance (after spend and any bonus).

  Redeem-style atomic guard: a single conditional `UPDATE users SET coin_balance
  = coin_balance − cost WHERE id = ? AND coin_balance >= cost RETURNING`. Only on
  a matched guard does the transaction pick a reward (`rollMystery`), write the
  `mystery_open` ledger row, and — if `bonus > 0` — credit it via
  `awardCoins(tx, …, "mystery_bonus")`. Balance can never go negative; a
  concurrent double-open can't overspend.

## UI (`artifacts/focusquest/src`)

- **`MysteryBox` card**, rendered at the **top of the Dopamine Menu page**
  (`/dopamine-menu`) — thematically the "spend" counterpart to the list you
  curate there. State-driven from `GET /mystery-box`:
  - `no_rewards` → gentle invite: "Add a reward below to unlock the Mystery Box."
  - `insufficient` → progress: "🪙 {remaining} more to go" (never an error).
  - `ok` → a prominent **Open (15 🪙)** button.
- **Reveal**: on open, a modal/overlay runs a short slot-machine cycle through
  the menu's reward texts, decelerating onto `result.reward.rewardText`, then —
  if `bonus > 0` — a "+{bonus} 🪙 bonus!" flourish. Reuses framer-motion and the
  card/overlay styling already in the app. Respects `prefers-reduced-motion`
  (snap straight to the result).
- After a successful open, invalidate `GET /coins` (header chip) and
  `GET /mystery-box` (card state) so both reflect the new balance immediately.

No new nav item or route — the card lives on the existing Rewards (Dopamine
Menu) page, keeping mobile nav uncluttered.

## Testing (TDD)

Pure units (`mystery-box.test.ts`), matching the api-server no-DB-harness
convention:

- `mysteryBonus`: each roll band maps to its bonus; boundaries (0.60, 0.90,
  0.99) land in the higher band; clamps 0 and ~1.
- `canOpenMystery`: `no_rewards` when count 0; `insufficient` with correct
  `remaining` when `balance < cost`; `ok` with `remaining 0` at/above cost;
  no-rewards takes precedence over insufficient.
- `rollMystery`: deterministic with a stub rng — `rewardIndex` in range, bonus
  matches the injected roll; first rng call selects the reward, second rolls the
  bonus.

Route/UI verified via `pnpm typecheck` + driving the running app (project
`/verify`), per the coins-plan Global Constraints — no DB/route harness invented.

## Out of Scope (v1)

- Coin flip / race-the-timer (the other Dopamine-Matching sub-mechanics; both
  carry anti-shame tension around a *losing* outcome — deferred until designed
  to stay upside-only).
- Pulling from the Rewards Store catalog (those are deliberate big-ticket
  redemptions, not random pulls).
- Pull history / stats UI (ledger stays internal, matching Dopamine Menu's
  no-tracking philosophy).
- Configurable cost or bonus odds per user.
- Any XP / streak / gear interaction.

## Dependencies & Constraints

- Free-infra only (request/response). No realtime, no new cron.
- Reason-union edit is compile-time only — **no `drizzle push`**, so no shared
  live-DB coordination needed for this quest.
- Codegen pipeline (orval → `@workspace/api-zod` + `@workspace/api-client-react`)
  must run after the OpenAPI edit; generated files are never hand-edited.
