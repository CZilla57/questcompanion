# Dopamine Matching (Mystery Box) — Implementation Plan

> Implements `docs/superpowers/specs/2026-07-15-dopamine-matching-design.md`.
> Second quest of Act IV after Coins & Real-Life Rewards.

**Goal:** A coin-gated **Mystery Box** that pulls a random reward from the user's
Dopamine Menu (with an upside-only variable coin bonus), reusing the shipped coin
economy end-to-end.

**Architecture:** Pure decision logic in `lib/mystery-box.ts` (unit-tested). A
`POST /mystery-box/open` route reuses the Store's atomic guarded-spend +
`awardCoins` helpers; `GET /mystery-box` feeds the card's state. No new tables —
two `CoinReason` values added to the existing ledger union (compile-time only, no
migration). Frontend adds a `MysteryBox` card + reveal overlay on the Dopamine
Menu page.

## Global Constraints

- **Test convention:** api-server tests are **pure-function unit tests** (Vitest,
  no DB/route harness). Test pure logic; verify DB/route/UI via `pnpm typecheck`
  + the running app (project `/verify`). Do not invent a DB integration harness.
- **Never hand-edit** `*/src/generated`. API types/hooks come from codegen only.
- **API codegen:** after editing `lib/api-spec/openapi.yaml`, run
  `pnpm --filter @workspace/api-spec codegen`.
- **No `drizzle push`:** this quest adds no columns/tables. The `CoinReason` edit
  is a TS union on an existing `text` column — types only.
- **Typecheck gate:** `pnpm typecheck` (root).
- **Anti-shame law:** never returns nothing; bonus is upside-only and capped at
  cost; spend never touches XP/streak; can't-afford/empty-menu are gentle 200
  outcomes, not errors.

---

### Task 1: `CoinReason` — add mystery ledger reasons

**Files:** Modify `lib/db/src/schema/coin-transactions.ts`.

- [ ] Add `"mystery_open"` and `"mystery_bonus"` to the `CoinReason` union.
- [ ] `pnpm --filter @workspace/db build` → no type errors (no push needed).
- [ ] Commit: `feat(db): mystery-box coin ledger reasons`

---

### Task 2: Mystery-box pure logic (TDD)

**Files:** Create `artifacts/api-server/src/lib/mystery-box.ts` + `mystery-box.test.ts`.

**Produces:** `MYSTERY_COST`, `MYSTERY_BONUS_TIERS`, `mysteryBonus(roll)`,
`canOpenMystery(balance, rewardCount)`, `rollMystery(rewardCount, rng)`,
`MysteryGate`, `MysteryPull`.

- [ ] Write failing test covering: `mysteryBonus` bands + boundaries (0.60/0.90/
  0.99 land in the higher band, 0→0, ~1→top); `canOpenMystery` (`no_rewards`,
  `insufficient` + `remaining`, `ok`, precedence of no_rewards over insufficient);
  `rollMystery` deterministic with a stub rng (index in range, first call picks
  reward, second rolls bonus).
- [ ] Implement to green. `MYSTERY_COST = 15`; bonus tiers 5/10/15 at
  0.60/0.90/0.99. `remaining = max(0, cost − balance)`.
- [ ] `pnpm --filter @workspace/api-server test -- mystery-box` → PASS.
- [ ] Commit: `feat(api): mystery-box pure logic — cost, bonus tiers, gate, roll`

---

### Task 3: Mystery-box route

**Files:** Create `artifacts/api-server/src/routes/mystery-box.ts`; modify
`artifacts/api-server/src/routes/index.ts` (register router).

- [ ] `GET /mystery-box` → `{ cost, balance, rewardCount, canOpen, reason,
  remaining }` (from `canOpenMystery`).
- [ ] `POST /mystery-box/open`: load balance + dopamine rewards; if none →
  `{ opened:false, reason:"no_rewards", cost, balance, remaining:0 }`. Else atomic
  guarded `UPDATE ... WHERE coin_balance >= cost RETURNING`; if unmatched →
  `{ opened:false, reason:"insufficient", cost, balance, remaining }`. On match:
  insert `mystery_open` ledger row (−cost), `rollMystery(rewards.length,
  Math.random)`, `awardCoins(tx, …, bonus, "mystery_bonus")` when `bonus>0`,
  return `{ opened:true, reason:"ok", cost, balance:final, bonus, reward:{id,
  rewardText} }`. All non-auth outcomes HTTP 200.
- [ ] Register both under the authed router in `routes/index.ts`.
- [ ] `pnpm typecheck` → clean.
- [ ] Commit: `feat(api): mystery-box open + status routes (atomic guarded spend)`

---

### Task 4: OpenAPI contract + codegen

**Files:** Modify `lib/api-spec/openapi.yaml`; regenerate client/zod.

- [ ] Add paths `GET /mystery-box`, `POST /mystery-box/open` and schemas
  `MysteryStatus`, `MysteryResult`, `MysteryReward` (`{id, rewardText}`).
- [ ] `pnpm --filter @workspace/api-spec codegen`; `pnpm typecheck` → clean.
- [ ] Commit: `feat(api-spec): mystery-box contract, regen client/zod`

---

### Task 5: Mystery Box card + reveal overlay (web)

**Files:** Create `artifacts/focusquest/src/components/mystery-box.tsx`; modify
`artifacts/focusquest/src/pages/dopamine-menu.tsx`.

- [ ] `MysteryBox` card driven by `useGetMysteryBox`: `no_rewards` invite /
  `insufficient` "{remaining} more to go" / `ok` Open button. On open
  (`useOpenMysteryBox`), run a slot-machine reveal cycling `rewards` texts,
  landing on `result.reward.rewardText`, then a "+{bonus} 🪙 bonus!" flourish when
  `bonus>0`. Honour `prefers-reduced-motion`. Invalidate `getGetCoinsQueryKey()`
  + `getGetMysteryBoxQueryKey()` on success.
- [ ] Render `<MysteryBox />` at the top of the Dopamine Menu page.
- [ ] `pnpm typecheck` → clean; drive the app (`/verify`): open with coins →
  reveal + chip drops; drain → "more to go"; empty menu → invite. Screenshot.
- [ ] Commit: `feat(web): Mystery Box card + reveal on Dopamine Menu`

---

## Self-Review

- Coin sink, decoupled from XP → Tasks 2–3 (guarded spend, no XP touch). ✓
- Anti-shame (never nothing, upside-only bonus ≤ cost, gentle 200 outcomes) →
  Task 2 bonus table + Task 3 outcomes + Task 5 copy. ✓
- No new tables / no migration → Task 1 union-only edit. ✓
- Reuses `awardCoins` + guarded-write from the shipped economy → Task 3. ✓
- Pure logic unit-tested; route/UI via typecheck + app → Tasks 2 / 3 / 5. ✓
- Out-of-scope (coin flip, race-timer, history, Store pulls) not built. ✓
