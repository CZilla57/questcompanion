# Honest Coin — economy grammar repair (Act VII quest 3)

**Date:** 2026-07-20 · **Status:** awaiting Chad's approval · **Parent:** `2026-07-19-act7-consolidation-design.md` (Quest 3)
**Depends on:** Quest 2 (The Now Screen, PR #68 — merged; this quest inherits its interim
Rewards nav group and edits `progress.tsx`, where the Streak Shield card now lives).
**Note:** the act spec routed Quest 3 "straight to plan," but code exploration found the
charter understated the problem (see §1), so the open decisions get a short spec first.

## 1. Problem

The act charter names one XP-spender. The code has **two**, plus a shipped coin path the
charter didn't know about:

- **Two parallel Streak Shield buy paths.** Legacy `POST /users/me/streak-freeze/buy`
  (`routes/users.ts:395–429`) charges **50 XP** off `totalPoints` *and* `weeklyPoints`,
  caps the stock at **1**, fails with 400-error walls ("Not enough XP"), and writes a
  `-50` activity row. Meanwhile Stat Perks (PR #45) already sells the *same*
  `users.streakFreezes` stock as a perk (`routes/stat-perks.ts`): **30 coins**, cap
  **3**, atomic guarded spend, gentle HTTP-200 "N more to go" grammar. Same shield, two
  prices, two caps, two currencies. `/progress` renders the legacy path (its own
  `FREEZE_COST = 50` mirror); `/rewards` renders the perk path.
- **The Gear Store spends XP.** `routes/gear.ts` deducts `costXp` (60–5500 per
  `scripts/src/gear-catalog.ts`) from `totalPoints`, so buying Excalibur erases weeks of
  visible progress — level can regress from a purchase. It also logs the purchase as a
  **`task_completed`** activity row with negative points (a lie in the data), and fails
  affordability with a 403.
- **Reward surfaces are split** across `/dopamine-menu` (free menu + Mystery Box) and
  `/rewards` (real-life redemptions + a stat-perks section), held together by Quest 2's
  interim two-tab nav group.

Buying protection or gear visibly regresses the level bar — an anti-shame violation aimed
at exactly the user reaching for help, and a contradiction of the PR #43 law: **XP is
progression, coins are the spendable currency.**

## 2. Design principles

- **One currency spends.** After this quest, coins are the only thing any purchase can
  cost. XP/level/streak are progression and cannot be spent, only earned — and, outside
  award-reversal, never go down.
- **One spend grammar.** Every coin spend is the same shape: atomic guarded decrement
  (`WHERE coin_balance >= cost`), one negative ledger row, insufficiency is a gentle
  HTTP-200 "N more to go," never an error wall.
- **Prices reuse the tier vocabulary** users already know from reward redemptions
  (20/60/150/400) instead of inventing new numbers.
- **History is history.** Old negative-points activity rows and previously-XP-bought
  gear/shields stay exactly as they are. No backfill, no refunds, no re-charges.

## 3. One shield

- **Delete** the legacy endpoint: `POST /users/me/streak-freeze/buy` route,
  `FREEZE_COST`/`FREEZE_MAX`, its openapi path (`openapi.yaml:246`), and the generated
  `useBuyStreakFreeze` hook + `StreakFreezeResult` type. The stat-perks purchase
  (`POST /stat-perks/streak_shield/buy`) becomes the only way to get a shield.
- **`/progress` keeps an inline buy** (decision D3): the Streak Shield card re-wires to
  the perk endpoint's 200-based response grammar — branch on `purchased`/`reason`
  payload, not on thrown errors. Price and cap come from `GET /stat-perks` (the client
  `FREEZE_COST = 50` mirror in `progress.tsx:27` dies; no client-side price constants).
  Card shows shields held (`×N`, cap 3) instead of the binary active/inactive; at-cap
  renders the perks' reassurance state, not a disabled "can't buy." Invalidate the coin
  chip + stats queries on success (as `stat-perks-section.tsx` already does — extract its
  mutation handling into a small shared hook rather than duplicating).
- **Cap is uniformly 3** (`MAX_STREAK_FREEZES`); the legacy cap-1 dies with the endpoint.
- **Purchase still logs** (decision D5): the perk buy gains an activity insert for the
  shield kind only — `type: "streak_freeze_bought"`, `points: 0`, description
  "Bought a Streak Shield for 30 coins". (`streak_freeze_used` rows are unchanged.)
- Shield *consumption* and uncomplete-restore (`tasks.ts:627/661/978`) are untouched.

## 4. Gear joins the coin economy

- **Price by rarity, reusing the tier costs** (decision D1): common **20**, rare **60**,
  epic **150**, legendary **400** coins — a pure `gearCoinCost(rarity)` map in code.
  `levelRequired` (already 1–26) stays the progression gate, so legendary gear remains
  late-game without taxing the level bar. Coin-flow sanity: a typical day earns ~25
  (3 quests + a focus session), so common is a sub-day treat, rare ~2–3 days, epic ~a
  week, legendary a genuine save-up — the same felt ladder the XP prices intended,
  minus the self-harm.
- **No schema change:** `gear_items.cost_xp` stays in place but is no longer read
  (future-cleanup note; keeps the quest migration-free per the act's no-schema-rewrites
  rule and the shared-Neon constraints).
- **API reshape** (`/gear/store`, `/gear/{id}/buy`): `costXp` → `costCoins`, `userXp` →
  `coinBalance`; `canAfford` computes against the coin balance; `meetsLevel` unchanged.
  The buy becomes a coin spend via the shared helper (§5) with new `CoinReason` `"gear"`
  (text column — code-only change). Insufficient coins returns the gentle 200
  `{purchased: false, remaining}` shape; `insufficient_level` stays a 403 (the UI already
  disables those buttons — it's a progression gate, not an affordability nudge);
  `already_owned` 409 stays.
- **Honest activity row:** `type: "gear_bought"` (new enum value in openapi +
  one icon line in the `/progress` activity log), `points: 0`, description unchanged
  ("Purchased X from the Gear Store"). The `task_completed` mislabel dies.
- **`avatar.tsx` Gear Store UI** re-labels prices in coins (`{costCoins} 🪙` with the
  existing rarity styling), shows the coin balance where it showed `userXp`
  (lines ~200–280, 776, 819), and gains the "N more to go" insufficiency copy; the
  "nothing affordable" hint at line ~604 re-reads from coins. Coin chip invalidated on
  purchase.
- Owned/equipped gear is untouched; nobody is re-charged (principle: history is history).

## 5. One spend grammar in code

`lib/award-coins.ts` gains the missing verb:

```ts
spendCoins(tx, userId, cost, reason): Promise<{ ok: true; balance: number } | { ok: false; balance: number; remaining: number }>
```

— the atomic guarded decrement + ledger row that stat-perks, mystery-box, and redeem
each hand-roll today. The gear buy uses it from day one; the three existing spenders are
refactored onto it **behavior-preserving** (their existing tests are the safety net).
After this quest the ledger's spend reasons are: `redeem`, `mystery_open`,
`perk_xp_boost`, `perk_focus_boost`, `perk_streak_shield`, `gear`.

## 6. Monotonic XP + the standing regression guard

**The invariant, stated precisely** (the act's "XP monotonicity" standing guard):

1. `totalPoints`/`weeklyPoints` never decrease **except** in the quest-uncomplete
   reversal (`tasks.ts:936ff`), which is bounded by the completion's own snapshot
   (`pointsAwarded` + daily bonus) and clamped at 0.
2. **No purchase or spend touches XP** — not `totalPoints`, not `weeklyPoints`, not
   `currentLevel`.
3. **No new activity row carries negative points.** (The two writers that do today —
   legacy shield, gear — are both repaired by this quest. Pre-existing rows stay.)

**The guard** — a dedicated api-server test file that must survive all future acts:

- *Purchase matrix:* for a fixture user with a rich balance, exercise every spend
  endpoint (gear buy, all three perks, mystery-box open, reward redeem) and assert
  `totalPoints`/`weeklyPoints`/`currentLevel` are unchanged before and after, and
  that every activity row written has `points >= 0`.
- *Reversal bound:* uncomplete after complete restores exactly the snapshot amounts and
  never drives either column negative (extends the existing uncomplete tests).
- *Ledger honesty:* each spend writes exactly one negative `coin_transactions` row and
  `coin_balance == sum(ledger)` holds across the matrix.

## 7. The Rewards hub

- **Routes** (tabs-as-links, Quest 2's grammar — each tab is a first-class URL):
  - `/rewards/treats` — `dopamine-menu.tsx` renamed `rewards-treats.tsx` (free Dopamine
    Menu + Mystery Box, unchanged content).
  - `/rewards/store` — `rewards-store.tsx`, minus the stat-perks section.
  - `/rewards/perks` — new thin page hosting the existing `StatPerksSection`.
  - `/dopamine-menu` **and** `/rewards` redirect to `/rewards/treats` (wouter
    `<Redirect>`; specific `/rewards/*` routes must precede the `/rewards` redirect in
    the `Switch`).
- **Default tab is Treats** (decision D4) — the charter's tab order, free-first: the
  menu costs nothing, which is the anti-shame front door to the economy.
- **`NAV_GROUPS`** rewards group: `href: "/rewards/treats"`, tabs Treats · Store ·
  Perks; the interim-group comment dies. One nav label ("Rewards"), `mobileShow: false`
  unchanged. `activeGroupKey` needs no logic change (`/rewards/...` prefix-matches).
  Nav tests update: the legacy-hrefs-reachable test now asserts `/dopamine-menu` and
  `/rewards` land on `/rewards/treats` via redirect.
- Every tab page keeps `PageTabs`; the coin balance header (`useGetCoins`) renders on
  Store and Perks as today (Treats stays free-of-commerce except the Mystery Box card,
  which already shows its own cost).

## 8. Decisions (defaults pre-applied; say the word to flip any)

| # | Decision | Default | Alternative |
|---|----------|---------|-------------|
| D1 | Gear pricing | Rarity → tier map (20/60/150/400 coins), `cost_xp` column dormant, no migration | Per-item `costXp ÷ 10` (finer grain, off-grammar numbers); or a `cost_coins` migration |
| D2 | Shield price | Keep the shipped **30 coins / cap 3** (~1.2 typical days' earn — inside the charter's 1–2-day target) | Raise to 40–50 if it should bite more |
| D3 | `/progress` shield card | Keep inline buy, re-wired to the perk endpoint | Display-only card + "Get shields →" link to `/rewards/perks` |
| D4 | Hub root | `/rewards` redirects to `/rewards/treats` (Treats default) | Store keeps `/rewards` as its address (Store-default hub, no Store URL change) |
| D5 | Purchase logging | Shield keeps its activity row (points 0, coin copy); gear gets honest `gear_bought` type; boosts stay unlogged | Stop logging purchases entirely (log becomes awards-only) |

## 9. Out of scope

- Earn-rate rebalancing; new reward types or perk kinds (act rule: no new features).
- Coin backfill / conversion / refunds for previously XP-bought shields and gear.
- Mystery-box and redeem behavior (already correct; they only get the §5 refactor).
- Shield consumption/restore mechanics; streak logic.
- Surfacing the `coin_transactions` ledger in UI (still internal, per PR #43).
- Removing `gear_items.cost_xp` (noted as future cleanup, not done here).

## 10. Acceptance

- Level/progress bar can never move backwards from **any** purchase — shield, gear,
  perk, mystery box, redemption (charter acceptance, now including gear).
- The shield is purchasable only with coins, from both `/progress` and
  `/rewards/perks`, with the gentle insufficiency copy; there is exactly one buy
  endpoint, one price, one cap.
- Gear is purchasable only with coins; a fresh user's legendary aspiration costs 400
  coins and level 22+, never XP.
- One nav entry reaches all three reward tabs; `/dopamine-menu` and `/rewards` redirect;
  every other pre-existing URL still renders its page.
- The §6 regression guard exists, passes, and fails if anyone reintroduces an XP spend
  or a negative-points activity write.

## 11. Test plan

- **api-server:** replace legacy streak-freeze buy tests with perk-path coverage of the
  `/progress` contract (cap 3, at-max, insufficiency, activity row); gear-store tests
  re-priced (coin affordability, level gate unchanged, ledger row, activity type/points,
  no-XP-delta); `spendCoins` unit tests; the §6 standing guard file; existing
  perks/mystery/redeem suites stay green through the refactor.
- **focusquest:** nav-groups tests (3-tab rewards group, redirect reachability, href
  uniqueness); progress-page shield card states (held ×N, at-cap, can't-afford copy,
  success toast in coins); avatar gear store renders coin prices/balance; hub pages
  render under their new routes with `PageTabs`.
- **Copy audit:** no surviving user-facing string prices anything in XP
  (`grep -ri "XP" focusquest/src` reviewed for purchase contexts).

## 12. Sizing & rollout

Solid day of work (the act spec's "small" plus the gear surface): ~60% api-server +
openapi/codegen churn (`useBuyStreakFreeze` deletion, gear/store reshape, new enum
values), ~40% web. **Zero DB migrations** (both new enum-ish values live on `text`
columns), so no shared-Neon coordination needed. Own branch (`feat/honest-coin`) off
current main, subagent-TDD per house workflow, single PR. Campaign map + roadmap memory
refresh on merge, as always.
