# Coin-Priced Stat Perks Implementation Plan

**Goal:** Add coin-priced **Stat Perks** — in-game power-ups (distinct from the
real-life Rewards Store) that boost the player's own progression. v1 ships three:
**XP Boost**, **Focus Boost** (timed +50% XP buffs), and **Streak Shield** (a
coin-priced streak freeze).

**Architecture:** Zero new tables. Two nullable `users` timestamp columns hold
the active-until windows for the two boosts (derived-at-read, no cron). The
Shield reuses the existing `users.streakFreezes` counter and its completion-flow
consumption. Pure decision logic lives in `artifacts/api-server/src/lib/stat-perks.ts`
(unit-tested). A guarded conditional coin spend under a `FOR UPDATE` lock makes
purchase atomic and unable to go negative or exceed the shield cap. Boosts apply
purely additively at XP-award time (quest completion; focus interval + partial).
Frontend adds a "Power-Ups" section to the existing `/rewards` page.

**Tech Stack:** TypeScript, Express, Drizzle ORM (Neon Postgres), Vitest,
React 19 + wouter + TanStack Query, Tailwind, lucide-react, orval codegen.

## Global Constraints

Inherited from the coins plan:
- **Test convention:** api-server tests are pure-function unit tests (Vitest, no
  DB/route harness). Verify DB/route/UI via `pnpm typecheck` + the running app.
- **Never hand-edit** `*/src/generated`. Types/hooks come from codegen only.
- **API codegen:** after editing `lib/api-spec/openapi.yaml`, run
  `pnpm --filter @workspace/api-spec codegen`.
- **DB push:** after editing `lib/db/src/schema/*`, run
  `pnpm --filter @workspace/db push` (export `DATABASE_URL` first; it doesn't load
  `.env`). Additive columns apply without a destructive prompt. **⚠ Deploy
  ordering:** every `users` read now selects the two new columns, so the push
  MUST land before this app code runs, or all user reads hit a missing column.
- **Anti-shame law:** perks are upside-only; buying never touches XP/level/streak;
  can't-afford is "N more to go" (HTTP 200), never an error; shield-at-max is
  reassurance; buying is celebratory.

---

### Task 1: DB schema — boost expiry columns + CoinReasons ✓

- `lib/db/src/schema/users.ts`: add nullable `xpBoostExpiresAt` +
  `focusBoostExpiresAt` timestamps.
- `lib/db/src/schema/coin-transactions.ts`: extend `CoinReason` with
  `perk_xp_boost | perk_focus_boost | perk_streak_shield` (compile-time only).
- Push additive schema to Neon (deploy-time; not runnable without `DATABASE_URL`).

### Task 2: Stat-perks pure logic + tests (TDD) ✓

`artifacts/api-server/src/lib/stat-perks.ts` (+ `.test.ts`):
- `PERKS` catalog (`id`, `kind`, `label`, `emoji`, `description`, `coinCost`,
  ledger `reason`, boost `durationHours`/`bonus`), `getPerk`, `isValidPerkId`.
- `isBoostActive(expiresAt, now)` — non-null and strictly future.
- `boostBonusPoints(base, active, bonus)` — `round(base*bonus)` or 0.
- `nextBoostExpiry(current, now, hours)` — stacking extension from
  `max(now, current)`.
- `canBuyStreakShield(freezes)` — `< MAX_STREAK_FREEZES`.
- Tunable constants: `XP_BOOST_COST=40`, `FOCUS_BOOST_COST=40` (+50%, 12h each),
  `STREAK_SHIELD_COST=30`, `MAX_STREAK_FREEZES=3`.

### Task 3: Route + earn-path integration ✓

- `routes/stat-perks.ts`: `GET /stat-perks` (catalog + live per-user state) and
  `POST /stat-perks/:id/buy` (atomic guarded spend under `FOR UPDATE`; applies the
  stacked expiry or `streakFreezes+1`; anti-shame 200 outcomes; 404 unknown perk /
  no user). Register in `routes/index.ts`.
- `routes/tasks.ts`: add `boostBonusPoints(task.points, isBoostActive(user.xpBoostExpiresAt, now), XP_BOOST_BONUS)`
  to `pointsToAdd` in the completion tx (on top of the streak multiplier).
- `routes/focus-sessions.ts`: fold a Focus Boost bonus into `xpDelta` in the
  per-interval credit and the early-`/complete` partial path (feed rows keep base
  points; totals carry the boost).

### Task 4: OpenAPI contract + codegen ✓

- `lib/api-spec/openapi.yaml`: `/stat-perks` + `/stat-perks/{id}/buy` paths;
  `StatPerk`, `StatPerks`, `StatPerkPurchaseResult` schemas.
- `pnpm --filter @workspace/api-spec codegen` → regen client/zod.

### Task 5: UI — Stat Perks section ✓

- `components/stat-perks-section.tsx`: 3-card "Power-Ups" grid on `/rewards`.
  Boost cards → Active/time-left chip + Extend/Buy; Shield → held count + Buy /
  "Fully shielded". Celebratory + "N more to go" toasts. Invalidates stat-perks,
  coins, my-stats on buy.
- `pages/rewards-store.tsx`: render `<StatPerksSection />` under the header.

---

## Self-Review

**Spec coverage:**
- Three perks (XP Boost, Focus Boost, Streak Shield) → Tasks 2–5. ✓
- Anti-shame / upside-only (buy never touches XP/streak; boosts only add; shield
  only protects; "N more to go"; shield-at-max reassurance) → route 200 outcomes +
  UI copy. ✓
- Zero new tables (2 nullable cols + reuse `streakFreezes` + reason-union edit) →
  Task 1. ✓
- Atomic, non-negative, cap-respecting purchase → `FOR UPDATE` + balance check +
  `canBuyStreakShield`. ✓
- Boosts apply additively at earn time (quest + focus) → Task 3. ✓
- Farm-safety: boosts pay **XP only**, never coins — no spend-coins-to-earn-coins
  loop. ✓
- Out of scope (questline/boss boosts, coin boost, history UI, legacy XP-freeze
  migration) → not built. ✓

**Verification:** `pnpm typecheck` (4 projects), 287 api-server tests (incl. 16
new stat-perks units), 113 focusquest tests, and a production `vite build` — all
green. Live-app driving needs a provisioned DB (`DATABASE_URL`), a deploy-env step
per Global Constraints.

**Type consistency:** `PerkKind`/`PerkId` (`xp_boost|focus_boost|streak_shield`)
consistent across `stat-perks.ts`, the route, openapi enums, and generated hooks.
`CoinReason` perk values match the catalog `reason` fields and the ledger insert.
`StatPerk`/`StatPerkPurchaseResult` shapes match `present()` and the buy outcomes.

## Execution Notes

- **Deploy ordering (critical):** run `drizzle push` (adds
  `users.xp_boost_expires_at`, `users.focus_boost_expires_at`) **before** shipping
  the app code — the new full-row user selects reference both columns. The change
  is additive/nullable and safe under the shared-DB discipline.
- Verification leans on typecheck + unit tests + build because api-server has no
  DB/route harness and this session has no `DATABASE_URL`. Intentional, not a gap.
