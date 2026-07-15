# Coins & Real-Life Rewards — Design

**Date:** 2026-07-15
**Act:** IV — Play Together (reward economy)
**Status:** Design approved, pending spec review

## Summary

Introduce **coins**, a spendable currency distinct from XP, that the user earns
from meaningful actions and spends on **their own real-life rewards** (takeout,
an episode, a Hot Wheels car). XP answers "who am I becoming"; coins answer
"what have I earned the right to enjoy." This is the economy substrate the rest
of Act IV (Dopamine Matching's coin-gated mystery reward, coin-priced perks)
builds on.

This is the first quest of Act IV after Allies (shipped). It is deliberately
scoped to fit free-tier infra (request/response + cron; no realtime).

## Design Law: Anti-Shame (non-negotiable)

Coins are a source of agency and delight, never leverage. Enforced everywhere:

- Coins **never expire** and **never go negative**.
- Spending coins **never** reduces XP, level, or streak — the two systems are
  fully decoupled.
- Missing days never burns coins.
- "Can't afford yet" is framed as progress (**"38 more to go"**), never a denial
  wall or error.
- Redeeming is celebratory (**"Enjoy it! 🎉"**), never "are you sure you want to
  waste these?"
- Coins are additive motivation. They never gate any core app function.

## Data Model

Three pieces, all in `@workspace/db` (`lib/db/src/schema/`):

### 1. `users.coinBalance` (new column)
`integer("coin_balance").notNull().default(0)` on the existing `usersTable`.
Denormalized running balance — same pattern as `totalPoints`. Gives O(1) reads
and a simple atomic overspend guard. Never allowed below 0.

### 2. `coin_transactions` (new table) — internal audit ledger
Append-only source of truth for balance reconstruction. **Not surfaced in the UI
for v1** (no history screen); it exists for integrity, debuggability, and test
verification.

| column        | type                                   | notes                                        |
|---------------|----------------------------------------|----------------------------------------------|
| `id`          | serial pk                              |                                              |
| `userId`      | integer → users.id (cascade)           |                                              |
| `amount`      | integer                                | signed: positive earn, negative spend        |
| `reason`      | text `$type<CoinReason>`               | see reasons below                            |
| `rewardItemId`| integer → reward_store_items.id (null) | set on redeem; null on earns                 |
| `createdAt`   | timestamp default now                  |                                              |

`CoinReason = "quest_complete" | "focus_session" | "streak_milestone" | "questline_complete" | "boss_win" | "redeem"`.

### 3. `reward_store_items` (new table) — the user's reward catalog
Distinct from `dopamine_rewards` (the free random-suggestion Dopamine Menu, which
is left untouched).

| column      | type                          | notes                                          |
|-------------|-------------------------------|------------------------------------------------|
| `id`        | serial pk                     |                                                |
| `userId`    | integer → users.id (cascade)  |                                                |
| `label`     | varchar(100)                  | trimmed, non-empty                             |
| `tier`      | text `$type<RewardTier>`      | `small \| medium \| large \| treat`            |
| `coinCost`  | integer                       | snapshotted from tier at creation time         |
| `createdAt` | timestamp default now         |                                                |

`RewardTier = "small" | "medium" | "large" | "treat"`. Cap **20 items per user**
(mirrors the Dopamine Menu limit).

`coinCost` is snapshotted so retuning tier prices later never silently reprices a
user's existing rewards.

## Earning

A single helper — `awardCoins(tx, userId, amount, reason)` in
`artifacts/api-server/src/lib/coins.ts` — increments `coinBalance` and inserts a
`coin_transactions` row **inside the same DB transaction** as the existing XP
award, so coins and XP stay atomic and consistent.

v1 earn sites (all amounts are **tunable constants** in `coins.ts`; values below
are illustrative starting points):

| Action                              | Reason               | Coins | Hook site                          |
|-------------------------------------|----------------------|-------|------------------------------------|
| Quest completed                     | `quest_complete`     | +5    | `routes/tasks.ts` (completion tx)  |
| Focus session completed             | `focus_session`      | +10   | `routes/focus-sessions.ts`         |
| Streak milestone (every 7 days)     | `streak_milestone`   | +25   | wherever streak day increments     |
| Questline completed                 | `questline_complete` | +30   | `routes/questlines.ts` (claim tx)  |
| Weekly boss win                     | `boss_win`           | +50   | `routes/battle.ts` (win branch)    |

Tuning target for the earn/price ratio: a **Small** reward should be reachable in
a day or two of normal use; a **Treat** should be a genuine multi-day save-up. The
ratio is the primary knob and lives entirely in constants.

Streak-milestone earn fires only when the streak day count crosses a multiple of
7 on that update (guard against re-award on the same day).

## Spending

### Adding a reward
User types a `label` and picks a **size tier**. The tier maps to a fixed
`coinCost` via a pure function `tierCost(tier)` (illustrative, tunable):

| Tier    | Example          | Cost |
|---------|------------------|------|
| Small ☕ | quick treat      | 20   |
| Medium 🍿| an episode       | 60   |
| Large 🍕 | takeout          | 150  |
| Treat 🚗 | a real splurge   | 400  |

Rejects: empty label, >20 items, unknown tier.

### Redeeming
`POST /rewards-store/:id/redeem` performs an **atomic guarded deduction**:

1. In a transaction, conditionally decrement `coinBalance` only if
   `coinBalance >= coinCost` (single `UPDATE ... WHERE coin_balance >= cost`
   returning the row).
2. If the guard matched: insert a negative `coin_transactions` row
   (`reason: "redeem"`, `rewardItemId` set, `amount: -coinCost`) and return the
   new balance + a celebratory payload.
3. If the guard did not match (insufficient funds): return a gentle
   `{ affordable: false, remaining }` response — **not** a hard error. The client
   renders "N more to go." (HTTP 200 with an outcome flag, so it never reads as
   failure; validation/ownership errors still use 400/404/401.)

The balance can never go negative because the decrement and the guard are the
same conditional write.

## API (Express + orval codegen, following existing route conventions)

All under the authed router; 401 when `!req.isAuthenticated()`; `userId = req.gameUserId`.

- `GET /coins` → `{ balance: number }` (recent-transactions field omitted for v1;
  ledger stays internal).
- `GET /rewards-store` → `RewardStoreItem[]`, each augmented with `affordable`
  and `remaining` computed against current balance.
- `POST /rewards-store` `{ label, tier }` → 201 created item. Enforces 20-item cap.
- `DELETE /rewards-store/:id` → 200 `{ success: true }`; 404 if not owned.
- `POST /rewards-store/:id/redeem` → 200 either
  `{ redeemed: true, balance, item }` or `{ redeemed: false, affordable: false, remaining }`.

Editing an existing reward is out of scope for v1 (delete + re-add covers it — YAGNI).

## UI Surfaces (`artifacts/focusquest/src`)

- **Coin balance chip** in the app header/layout (next to level/XP), reading from
  `GET /coins`. A subtle **"+N 🪙" toast** on earn, reusing existing toast /
  dopamine-overlay patterns. Earn feedback is driven by mutation responses that
  already run on completion, not by polling.
- **Rewards Store page** (new route, e.g. `/rewards`): balance up top; the reward
  catalog with an **add form (label + tier picker)** and delete; each item shows
  its cost and either a **Redeem** button (when affordable) or a **"N more to go"**
  progress affordance. No history section in v1.

Invalidate the coins query key wherever coins change (earn mutations already
invalidate on completion; redeem invalidates coins + rewards-store).

## Testing (TDD)

Pure units:
- `tierCost(tier)` mapping (incl. unknown → reject).
- affordability / `remaining` math (`remaining = max(0, cost - balance)`,
  `affordable = balance >= cost`).

Route / integration tests:
- `awardCoins` increments balance **and** writes exactly one ledger row per earn.
- Each earn site awards the right amount inside its existing completion tx (and
  does not double-award, e.g. streak milestone only on 7-day crossings).
- Redeem **cannot overspend** and balance **never goes negative** (attempt redeem
  with insufficient balance → `affordable: false`, balance unchanged, no ledger
  row).
- Redeem success decrements exactly `coinCost`, writes one negative ledger row.
- 20-item cap, empty-label rejection, ownership 404s, 401 unauthenticated paths.
- Balance == sum(ledger amounts) invariant holds after a mixed sequence.

## Out of Scope (v1)

- Redemption history UI (ledger stays internal).
- Custom/typed reward prices (tiers only).
- Coin-gated mystery reward, coin flip, race-the-timer (Dopamine Matching quest).
- Coin-priced Stat Perks (separate Act IV quest).
- Editing existing reward items.
- Coins from battle-loss consolation, gear, or other XP sites (can add later).

## Dependencies & Constraints

- Free-infra only (request/response + cron per project deployment setup). No
  realtime.
- Live Neon DB is shared across branches — schema push timing follows the shared-DB
  discipline (defer/coordinate the `drizzle push` if another branch's schema is
  live-but-unmerged).
- Codegen pipeline (orval → `@workspace/api-zod` + `@workspace/api-client-react`)
  must be run after route/schema changes.
