# Coins & Real-Life Rewards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a spendable coin currency (distinct from XP) earned from meaningful actions and spent on user-defined real-life rewards via size-tier pricing.

**Architecture:** A denormalized `users.coinBalance` (fast reads + atomic guards) backed by an append-only `coin_transactions` ledger (internal audit, not surfaced), plus a `reward_store_items` catalog. Pure decision logic lives in `artifacts/api-server/src/lib/coins.ts` (unit-tested); a thin `awardCoins(tx, …)` helper credits coins inside existing completion transactions; a guarded conditional `UPDATE` makes redemption atomic and unable to go negative. Frontend adds a header coin chip and a Rewards Store page using orval-generated hooks.

**Tech Stack:** TypeScript, Express, Drizzle ORM (Neon Postgres), Vitest, React 19 + wouter + TanStack Query, Tailwind, framer-motion, lucide-react, orval codegen from OpenAPI.

## Global Constraints

- **Test convention:** api-server tests are **pure-function unit tests** (Vitest, no DB/route harness). Test pure logic; verify DB/route/UI work via `pnpm typecheck` + the running app (project `/verify` + Browser preview). Do not invent a DB integration harness.
- **Never hand-edit** files under `*/src/generated`. API types/hooks come from codegen only.
- **API codegen:** after editing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec codegen` (orval → `lib/api-client-react` + `lib/api-zod`).
- **DB push:** after editing `lib/db/src/schema/*`, run `pnpm --filter @workspace/db push`. GOTCHA: `drizzle.config.ts` reads `process.env.DATABASE_URL` but does **not** load `.env` — export it first: `export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"`. Additive columns/tables apply without a destructive prompt.
- **Shared live DB caution:** one Neon DB serves all branches, and `drizzle push` syncs the DB to *this branch's* schema. Before pushing, confirm no other branch has live-but-unmerged schema columns that a push could drop. This branch's changes are additive-only (safe to add); the risk is the reverse.
- **Test commands:** `pnpm --filter @workspace/api-server test` (add `-- <name>` to filter), `pnpm --filter @workspace/focusquest test`.
- **Typecheck gate:** `pnpm typecheck` (root). Windows CRLF warnings on commit are harmless.
- **Tunable constants:** all coin earn amounts and tier costs are constants in `coins.ts` — illustrative values below, tune freely.
- **Anti-shame law (copy + behavior):** coins never expire, never go negative; spending never touches XP/level/streak; "can't afford yet" is framed as progress ("N more to go"), never an error wall; redeem is celebratory ("Enjoy it! 🎉").

---

### Task 1: DB schema — coin balance, ledger, reward catalog

**Files:**
- Modify: `lib/db/src/schema/users.ts` (add `coinBalance` column)
- Create: `lib/db/src/schema/reward-store-items.ts`
- Create: `lib/db/src/schema/coin-transactions.ts`
- Modify: `lib/db/src/schema/index.ts` (export new tables)

**Interfaces:**
- Produces: `usersTable.coinBalance`; `rewardStoreItemsTable`, `RewardStoreItem`, `RewardTier`; `coinTransactionsTable`, `CoinTransaction`, `CoinReason`.

- [ ] **Step 1: Add the `coinBalance` column to users**

In `lib/db/src/schema/users.ts`, add this line to the `usersTable` definition, immediately after the `createdAt` line's preceding field (place it just before `createdAt`):

```ts
  // Act IV reward economy: spendable currency, decoupled from XP. Never negative.
  coinBalance: integer("coin_balance").notNull().default(0),
```

(`integer` is already imported in this file.)

- [ ] **Step 2: Create the reward catalog table**

Create `lib/db/src/schema/reward-store-items.ts`:

```ts
import { pgTable, serial, integer, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export type RewardTier = "small" | "medium" | "large" | "treat";

export const rewardStoreItemsTable = pgTable("reward_store_items", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  label:     varchar("label", { length: 100 }).notNull(),
  tier:      text("tier").$type<RewardTier>().notNull(),
  // Snapshotted from the tier at creation so retuning tier prices never
  // silently reprices a user's existing rewards.
  coinCost:  integer("coin_cost").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type RewardStoreItem = typeof rewardStoreItemsTable.$inferSelect;
```

- [ ] **Step 3: Create the ledger table**

Create `lib/db/src/schema/coin-transactions.ts`:

```ts
import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { rewardStoreItemsTable } from "./reward-store-items";

export type CoinReason =
  | "quest_complete"
  | "focus_session"
  | "streak_milestone"
  | "questline_complete"
  | "boss_win"
  | "redeem";

// Append-only audit ledger. Not surfaced in the UI (v1); exists for integrity,
// debuggability, and reconstructing the denormalized users.coinBalance.
export const coinTransactionsTable = pgTable("coin_transactions", {
  id:           serial("id").primaryKey(),
  userId:       integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  amount:       integer("amount").notNull(), // signed: +earn, -spend
  reason:       text("reason").$type<CoinReason>().notNull(),
  rewardItemId: integer("reward_item_id").references(() => rewardStoreItemsTable.id, { onDelete: "set null" }),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

export type CoinTransaction = typeof coinTransactionsTable.$inferSelect;
```

- [ ] **Step 4: Export the new tables**

In `lib/db/src/schema/index.ts`, add after the existing exports:

```ts
export * from "./reward-store-items";
export * from "./coin-transactions";
```

- [ ] **Step 5: Typecheck the db package**

Run: `pnpm --filter @workspace/db build`
Expected: builds with no type errors.

- [ ] **Step 6: Push schema to Neon**

First confirm no other branch has unmerged schema columns (see Global Constraints "Shared live DB caution"). Then:

Run:
```bash
export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"
pnpm --filter @workspace/db push
```
Expected: `[✓] Changes applied` — adds `users.coin_balance`, `reward_store_items`, `coin_transactions`. If a live-mode guardrail blocks a verification re-run, the first run is authoritative.

- [ ] **Step 7: Commit**

```bash
git add lib/db/src/schema/
git commit -m "feat(db): coins schema — balance column, ledger, reward catalog"
```

---

### Task 2: Coin economy pure logic (TDD)

**Files:**
- Create: `artifacts/api-server/src/lib/coins.ts`
- Test: `artifacts/api-server/src/lib/coins.test.ts`

**Interfaces:**
- Consumes: `RewardTier` (type-only) from `@workspace/db`.
- Produces: `COIN_EARN`, `tierCost(tier)`, `isValidTier(s)`, `redeemDecision(balance, cost)`, `RedeemDecision`, `isStreakMilestone(newStreak, oldStreak)`.

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/coins.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { tierCost, isValidTier, redeemDecision, isStreakMilestone, COIN_EARN } from "./coins";

describe("tierCost", () => {
  it("maps each tier to its fixed cost", () => {
    expect(tierCost("small")).toBe(20);
    expect(tierCost("medium")).toBe(60);
    expect(tierCost("large")).toBe(150);
    expect(tierCost("treat")).toBe(400);
  });
});

describe("isValidTier", () => {
  it("accepts known tiers, rejects everything else", () => {
    expect(isValidTier("small")).toBe(true);
    expect(isValidTier("treat")).toBe(true);
    expect(isValidTier("huge")).toBe(false);
    expect(isValidTier("")).toBe(false);
  });
});

describe("redeemDecision", () => {
  it("affordable at or above cost, remaining 0", () => {
    expect(redeemDecision(100, 60)).toEqual({ affordable: true, remaining: 0 });
    expect(redeemDecision(60, 60)).toEqual({ affordable: true, remaining: 0 });
  });
  it("not affordable below cost, remaining is the gap (never negative)", () => {
    expect(redeemDecision(40, 60)).toEqual({ affordable: false, remaining: 20 });
    expect(redeemDecision(0, 400)).toEqual({ affordable: false, remaining: 400 });
  });
});

describe("isStreakMilestone", () => {
  it("true only when the streak advances onto a milestone day", () => {
    expect(isStreakMilestone(3, 2)).toBe(true);
    expect(isStreakMilestone(7, 6)).toBe(true);
    expect(isStreakMilestone(14, 13)).toBe(true);
    expect(isStreakMilestone(30, 29)).toBe(true);
    expect(isStreakMilestone(60, 59)).toBe(true);
  });
  it("false off-milestone or when the streak did not advance", () => {
    expect(isStreakMilestone(5, 4)).toBe(false);
    expect(isStreakMilestone(7, 7)).toBe(false); // freeze / same day — no advance
    expect(isStreakMilestone(1, 0)).toBe(false);
  });
});

describe("COIN_EARN", () => {
  it("exposes the tunable earn amounts", () => {
    expect(COIN_EARN.questComplete).toBe(5);
    expect(COIN_EARN.focusSession).toBe(10);
    expect(COIN_EARN.streakMilestone).toBe(25);
    expect(COIN_EARN.questlineComplete).toBe(30);
    expect(COIN_EARN.bossWin).toBe(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- coins`
Expected: FAIL — cannot resolve `./coins`.

- [ ] **Step 3: Write the implementation**

Create `artifacts/api-server/src/lib/coins.ts`:

```ts
import type { RewardTier } from "@workspace/db";

export type { RewardTier };

// Flat coin earns per meaningful action. Tunable — the earn/price ratio is the
// economy's main knob (Small reachable in ~a day; Treat a genuine save-up).
export const COIN_EARN = {
  questComplete:     5,
  focusSession:      10,
  streakMilestone:   25,
  questlineComplete: 30,
  bossWin:           50,
} as const;

const TIER_COST: Record<RewardTier, number> = {
  small:  20,
  medium: 60,
  large:  150,
  treat:  400,
};

export function tierCost(tier: RewardTier): number {
  return TIER_COST[tier];
}

export function isValidTier(value: string): value is RewardTier {
  return value === "small" || value === "medium" || value === "large" || value === "treat";
}

export interface RedeemDecision {
  affordable: boolean;
  remaining: number;
}

export function redeemDecision(balance: number, cost: number): RedeemDecision {
  return { affordable: balance >= cost, remaining: Math.max(0, cost - balance) };
}

// A streak "milestone" — the same definition the completion flow already uses to
// celebrate streaks (days 3, 7, 14, 30, then every 30). Extracted here so both
// the coin award and the activity/gear grant share one source of truth.
export function isStreakMilestone(newStreak: number, oldStreak: number): boolean {
  return (
    newStreak > oldStreak &&
    (newStreak === 3 || newStreak === 7 || newStreak === 14 || newStreak === 30 || newStreak % 30 === 0)
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server test -- coins`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/coins.ts artifacts/api-server/src/lib/coins.test.ts
git commit -m "feat(api): coin economy pure logic — tiers, redeem decision, milestone"
```

---

### Task 3: Earning — awardCoins helper + wire the five earn sites

**Files:**
- Create: `artifacts/api-server/src/lib/award-coins.ts`
- Modify: `artifacts/api-server/src/routes/tasks.ts` (quest complete + streak milestone, inside completion tx; refactor post-tx milestone check)
- Modify: `artifacts/api-server/src/routes/focus-sessions.ts` (final interval)
- Modify: `artifacts/api-server/src/routes/questlines.ts` (claim tx)
- Modify: `artifacts/api-server/src/routes/battle.ts` (win branch)

**Interfaces:**
- Consumes: `COIN_EARN`, `isStreakMilestone` from `./coins`; `usersTable`, `coinTransactionsTable`, `CoinReason` from `@workspace/db`.
- Produces: `awardCoins(tx, userId, amount, reason)` — credits coins inside the caller's transaction.

- [ ] **Step 1: Write the awardCoins helper**

Create `artifacts/api-server/src/lib/award-coins.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { db, usersTable, coinTransactionsTable, type CoinReason } from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Credit coins to a user inside the caller's transaction: bump the denormalized
 * balance and append one ledger row. No-op for non-positive amounts. Earns are
 * always positive, so this can never drive the balance negative.
 */
export async function awardCoins(
  tx: Tx,
  userId: number,
  amount: number,
  reason: CoinReason,
): Promise<void> {
  if (amount <= 0) return;
  await tx.update(usersTable)
    .set({ coinBalance: sql`${usersTable.coinBalance} + ${amount}` })
    .where(eq(usersTable.id, userId));
  await tx.insert(coinTransactionsTable).values({ userId, amount, reason });
}
```

- [ ] **Step 2: Wire quest completion + streak milestone (tasks.ts)**

Add imports near the other `../lib/...` imports at the top of `artifacts/api-server/src/routes/tasks.ts`:

```ts
import { awardCoins } from "../lib/award-coins.js";
import { COIN_EARN, isStreakMilestone } from "../lib/coins.js";
```

Inside the completion transaction, immediately **after** the `await tx.update(usersTable).set({ … }).where(eq(usersTable.id, userId));` block that persists user state (the block that sets `totalPoints`/`streakDays`/etc.), add:

```ts
    // Act IV coins: every completed quest pays out; streak milestones pay a bonus.
    await awardCoins(tx, userId, COIN_EARN.questComplete, "quest_complete");
    if (isStreakMilestone(newStreak, streakDaysBefore)) {
      await awardCoins(tx, userId, COIN_EARN.streakMilestone, "streak_milestone");
    }
```

Then, in the **post-transaction** side-effects section, replace the inline milestone condition:

```ts
  if (newStreak > oldStreak && (newStreak === 3 || newStreak === 7 || newStreak === 14 || newStreak === 30 || newStreak % 30 === 0)) {
```

with the shared predicate (identical result, removes the duplicated number set):

```ts
  if (isStreakMilestone(newStreak, oldStreak)) {
```

- [ ] **Step 3: Wire focus-session completion (focus-sessions.ts)**

Add imports at the top of `artifacts/api-server/src/routes/focus-sessions.ts`:

```ts
import { awardCoins } from "../lib/award-coins.js";
import { COIN_EARN } from "../lib/coins.js";
```

In the per-interval endpoint's transaction, inside the existing `if (isFinal) { … }` block (the one that inserts the `focus_complete` activity row), add as the first line of that block:

```ts
      await awardCoins(tx, userId, COIN_EARN.focusSession, "focus_session");
```

(Only genuine completion of the planned session pays out; early-stop credits partial XP but no session coin — anti-farm.)

- [ ] **Step 4: Wire questline completion (questlines.ts)**

Add imports at the top of `artifacts/api-server/src/routes/questlines.ts`:

```ts
import { awardCoins } from "../lib/award-coins.js";
import { COIN_EARN } from "../lib/coins.js";
```

In the claim transaction, immediately **after** the `await tx.update(usersTable).set({ totalPoints: newTotal, … }).where(eq(usersTable.id, userId));` call, add:

```ts
    await awardCoins(tx, userId, COIN_EARN.questlineComplete, "questline_complete");
```

- [ ] **Step 5: Wire weekly boss win (battle.ts)**

Add imports at the top of `artifacts/api-server/src/routes/battle.ts`:

```ts
import { awardCoins } from "../lib/award-coins.js";
import { COIN_EARN } from "../lib/coins.js";
```

Inside the `db.transaction(async (tx) => { … })` in `/battle/enter`, immediately **after** the `await tx.update(usersTable).set({ totalPoints: newPoints, … })` call, add:

```ts
    if (result === "win") {
      await awardCoins(tx, userId, COIN_EARN.bossWin, "boss_win");
    }
```

- [ ] **Step 6: Typecheck + run existing api-server tests**

Run: `pnpm typecheck`
Expected: no errors.
Run: `pnpm --filter @workspace/api-server test`
Expected: existing suites still pass (no behavior regressions in the refactored milestone check).

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/lib/award-coins.ts artifacts/api-server/src/routes/tasks.ts artifacts/api-server/src/routes/focus-sessions.ts artifacts/api-server/src/routes/questlines.ts artifacts/api-server/src/routes/battle.ts
git commit -m "feat(api): award coins on quest/focus/streak/questline/boss-win"
```

---

### Task 4: Spending — coins + rewards-store routes

**Files:**
- Create: `artifacts/api-server/src/routes/coins.ts`
- Create: `artifacts/api-server/src/routes/rewards-store.ts`
- Modify: `artifacts/api-server/src/routes/index.ts` (register both routers)

**Interfaces:**
- Consumes: `tierCost`, `isValidTier`, `redeemDecision` from `../lib/coins.js`; `usersTable`, `rewardStoreItemsTable`, `coinTransactionsTable` from `@workspace/db`.
- Produces HTTP: `GET /coins`, `GET /rewards-store`, `POST /rewards-store`, `DELETE /rewards-store/:id`, `POST /rewards-store/:id/redeem`.

- [ ] **Step 1: Create the coins balance route**

Create `artifacts/api-server/src/routes/coins.ts`:

```ts
import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/coins", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const [user] = await db
    .select({ balance: usersTable.coinBalance })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  res.json({ balance: user?.balance ?? 0 });
});

export default router;
```

- [ ] **Step 2: Create the rewards-store route**

Create `artifacts/api-server/src/routes/rewards-store.ts`:

```ts
import { Router, type IRouter } from "express";
import { db, usersTable, rewardStoreItemsTable, coinTransactionsTable } from "@workspace/db";
import { eq, and, count, sql, gte } from "drizzle-orm";
import { tierCost, isValidTier, redeemDecision } from "../lib/coins.js";

const router: IRouter = Router();
const MAX_ITEMS = 20;

function present(item: typeof rewardStoreItemsTable.$inferSelect, balance: number) {
  const d = redeemDecision(balance, item.coinCost);
  return {
    id: item.id,
    userId: item.userId,
    label: item.label,
    tier: item.tier,
    coinCost: item.coinCost,
    createdAt: item.createdAt.toISOString(),
    affordable: d.affordable,
    remaining: d.remaining,
  };
}

async function currentBalance(userId: number): Promise<number> {
  const [user] = await db.select({ balance: usersTable.coinBalance }).from(usersTable).where(eq(usersTable.id, userId));
  return user?.balance ?? 0;
}

router.get("/rewards-store", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const balance = await currentBalance(userId);
  const items = await db
    .select()
    .from(rewardStoreItemsTable)
    .where(eq(rewardStoreItemsTable.userId, userId))
    .orderBy(rewardStoreItemsTable.createdAt);
  res.json(items.map((it) => present(it, balance)));
});

router.post("/rewards-store", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;

  const label: unknown = req.body?.label;
  const tier: unknown = req.body?.tier;
  if (typeof label !== "string" || label.trim().length === 0) {
    res.status(400).json({ error: "label must be a non-empty string" }); return;
  }
  if (typeof tier !== "string" || !isValidTier(tier)) {
    res.status(400).json({ error: "tier must be one of small|medium|large|treat" }); return;
  }
  const trimmed = label.trim().slice(0, 100);

  const [existing] = await db
    .select({ total: count() })
    .from(rewardStoreItemsTable)
    .where(eq(rewardStoreItemsTable.userId, userId));
  if ((existing?.total ?? 0) >= MAX_ITEMS) {
    res.status(400).json({ error: `Maximum of ${MAX_ITEMS} rewards allowed` }); return;
  }

  const [item] = await db
    .insert(rewardStoreItemsTable)
    .values({ userId, label: trimmed, tier, coinCost: tierCost(tier) })
    .returning();
  const balance = await currentBalance(userId);
  res.status(201).json(present(item, balance));
});

router.delete("/rewards-store/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const id = parseInt(req.params.id!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [deleted] = await db
    .delete(rewardStoreItemsTable)
    .where(and(eq(rewardStoreItemsTable.id, id), eq(rewardStoreItemsTable.userId, userId)))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Reward not found" }); return; }
  res.json({ success: true });
});

router.post("/rewards-store/:id/redeem", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const id = parseInt(req.params.id!, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  type Outcome =
    | { status: "not_found" }
    | { status: "insufficient"; balance: number; remaining: number }
    | { status: "ok"; balance: number };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const [item] = await tx
      .select()
      .from(rewardStoreItemsTable)
      .where(and(eq(rewardStoreItemsTable.id, id), eq(rewardStoreItemsTable.userId, userId)));
    if (!item) return { status: "not_found" };

    // Atomic guarded deduction: only decrements when the balance covers the
    // cost. If the guard doesn't match, nothing changed — balance stays put and
    // can never go negative.
    const [updated] = await tx
      .update(usersTable)
      .set({ coinBalance: sql`${usersTable.coinBalance} - ${item.coinCost}` })
      .where(and(eq(usersTable.id, userId), gte(usersTable.coinBalance, item.coinCost)))
      .returning({ balance: usersTable.coinBalance });

    if (!updated) {
      const [u] = await tx.select({ balance: usersTable.coinBalance }).from(usersTable).where(eq(usersTable.id, userId));
      const bal = u?.balance ?? 0;
      return { status: "insufficient", balance: bal, remaining: Math.max(0, item.coinCost - bal) };
    }

    await tx.insert(coinTransactionsTable).values({
      userId, amount: -item.coinCost, reason: "redeem", rewardItemId: item.id,
    });
    return { status: "ok", balance: updated.balance };
  });

  if (outcome.status === "not_found") { res.status(404).json({ error: "Reward not found" }); return; }
  if (outcome.status === "insufficient") {
    // Gentle, not an error: "N more to go". HTTP 200 so it never reads as failure.
    res.status(200).json({ redeemed: false, balance: outcome.balance, affordable: false, remaining: outcome.remaining });
    return;
  }
  res.status(200).json({ redeemed: true, balance: outcome.balance, affordable: true, remaining: 0 });
});

export default router;
```

- [ ] **Step 3: Register both routers**

In `artifacts/api-server/src/routes/index.ts`, add imports alongside the others:

```ts
import coinsRouter from "./coins";
import rewardsStoreRouter from "./rewards-store";
```

and register them with the other `router.use(...)` calls (order-independent — none of these paths collide):

```ts
router.use(coinsRouter);
router.use(rewardsStoreRouter);
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/coins.ts artifacts/api-server/src/routes/rewards-store.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(api): coins balance + rewards-store CRUD + atomic guarded redeem"
```

---

### Task 5: OpenAPI contract + codegen

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (add paths + schemas)
- Regenerate: `lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/*` (via codegen — never hand-edited)

**Interfaces:**
- Produces (generated hooks/keys/types): `useGetCoins` + `getGetCoinsQueryKey`, `Coins`; `useGetRewardStoreItems` + `getGetRewardStoreItemsQueryKey`, `RewardStoreItem`; `useCreateRewardStoreItem`, `RewardStoreItemInput`; `useDeleteRewardStoreItem`; `useRedeemRewardStoreItem`, `RedeemResult`. `RewardTier` values `small|medium|large|treat`.

- [ ] **Step 1: Add the paths**

In `lib/api-spec/openapi.yaml`, in the `paths:` section (place near the existing `/dopamine-rewards` block for cohesion), add:

```yaml
  /coins:
    get:
      operationId: getCoins
      tags: [users]
      summary: Get the current user's coin balance
      responses:
        "200":
          description: Coin balance
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Coins"

  /rewards-store:
    get:
      operationId: getRewardStoreItems
      tags: [users]
      summary: List the current user's real-life reward catalog
      responses:
        "200":
          description: Reward catalog with affordability
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/RewardStoreItem"
    post:
      operationId: createRewardStoreItem
      tags: [users]
      summary: Add a real-life reward priced by size tier
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/RewardStoreItemInput"
      responses:
        "201":
          description: Created reward
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/RewardStoreItem"
        "400":
          description: Validation error or limit reached
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"

  /rewards-store/{id}:
    delete:
      operationId: deleteRewardStoreItem
      tags: [users]
      summary: Remove a reward from the catalog
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Deleted
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SuccessEnvelope"
        "404":
          description: Not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"

  /rewards-store/{id}/redeem:
    post:
      operationId: redeemRewardStoreItem
      tags: [users]
      summary: Spend coins to redeem a reward (gentle no-op if unaffordable)
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Redemption outcome (redeemed true, or affordable false with remaining)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/RedeemResult"
        "404":
          description: Not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
```

- [ ] **Step 2: Add the schemas**

In the `components: schemas:` section (near `DopamineReward`), add:

```yaml
    Coins:
      type: object
      required: [balance]
      properties:
        balance:
          type: integer

    RewardStoreItem:
      type: object
      required: [id, userId, label, tier, coinCost, createdAt, affordable, remaining]
      properties:
        id:
          type: integer
        userId:
          type: integer
        label:
          type: string
          maxLength: 100
        tier:
          type: string
          enum: [small, medium, large, treat]
        coinCost:
          type: integer
        createdAt:
          type: string
          format: date-time
        affordable:
          type: boolean
        remaining:
          type: integer
          description: Coins still needed to afford this reward (0 when affordable)

    RewardStoreItemInput:
      type: object
      required: [label, tier]
      properties:
        label:
          type: string
          minLength: 1
          maxLength: 100
        tier:
          type: string
          enum: [small, medium, large, treat]

    RedeemResult:
      type: object
      required: [redeemed, balance, affordable, remaining]
      properties:
        redeemed:
          type: boolean
        balance:
          type: integer
        affordable:
          type: boolean
        remaining:
          type: integer
```

- [ ] **Step 3: Run codegen**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: regenerates `lib/api-client-react` + `lib/api-zod` with the new hooks/types, no errors.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: no errors (generated code compiles; nothing consumes it yet).

- [ ] **Step 5: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "feat(api-spec): coins + rewards-store contract, regen client/zod"
```

---

### Task 6: Coin balance chip in the header

**Files:**
- Create: `artifacts/focusquest/src/components/coin-chip.tsx`
- Modify: `artifacts/focusquest/src/components/layout.tsx` (render chip in both control clusters)

**Interfaces:**
- Consumes: `useGetCoins` from `@workspace/api-client-react`.
- Produces: `<CoinChip />`.

- [ ] **Step 1: Write the CoinChip component**

Create `artifacts/focusquest/src/components/coin-chip.tsx`:

```tsx
import { Coins } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useGetCoins } from "@workspace/api-client-react";

/** Header readout of the user's spendable coin balance. Rolls the number on
 *  change so earns get a small, satisfying acknowledgement without a toast. */
export function CoinChip() {
  const { data } = useGetCoins();
  const balance = data?.balance ?? 0;

  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-amber-400/30 bg-amber-400/10 text-amber-300"
      aria-label={`${balance} coins`}
      title={`${balance} coins`}
    >
      <Coins className="w-4 h-4 flex-shrink-0" />
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={balance}
          initial={{ y: -8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 8, opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="text-sm font-semibold tabular-nums leading-none"
        >
          {balance}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 2: Render it in the layout header + sidebar**

In `artifacts/focusquest/src/components/layout.tsx`, add the import:

```tsx
import { CoinChip } from "./coin-chip";
```

In the **mobile header** control cluster (`<div className="flex items-center gap-1">`), add `<CoinChip />` as the first child, before `<BrainModeChip />`.

In the **desktop sidebar** control cluster (`<div className="flex items-center gap-1 -ml-1">`), add `<CoinChip />` as the first child, before `<BrainModeChip />`.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Verify in the app**

Start the focusquest dev server (via `preview_start` with the app's launch config) and open it. Confirm the coin chip renders in the header with the current balance. Complete a quest and confirm the chip increments (after Task 8 wires invalidation) — for now just confirm it renders and reads a real balance. Capture a screenshot.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/components/coin-chip.tsx artifacts/focusquest/src/components/layout.tsx
git commit -m "feat(web): coin balance chip in header"
```

---

### Task 7: Rewards Store page

**Files:**
- Create: `artifacts/focusquest/src/pages/rewards-store.tsx`
- Modify: `artifacts/focusquest/src/App.tsx` (add `/rewards` route)
- Modify: `artifacts/focusquest/src/components/layout.tsx` (add nav item)

**Interfaces:**
- Consumes: `useGetCoins` + `getGetCoinsQueryKey`, `useGetRewardStoreItems` + `getGetRewardStoreItemsQueryKey`, `useCreateRewardStoreItem`, `useDeleteRewardStoreItem`, `useRedeemRewardStoreItem` from `@workspace/api-client-react`; `useToast`, `apiErrorMessage`.
- Produces: default-exported `RewardsStore` page at `/rewards`.

- [ ] **Step 1: Write the page**

Create `artifacts/focusquest/src/pages/rewards-store.tsx`:

```tsx
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCoins,
  getGetCoinsQueryKey,
  useGetRewardStoreItems,
  useCreateRewardStoreItem,
  useDeleteRewardStoreItem,
  useRedeemRewardStoreItem,
  getGetRewardStoreItemsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";
import { Coins, Plus, Trash2, Gift } from "lucide-react";

const TIERS = [
  { value: "small",  label: "Small",  hint: "☕ quick",   cost: 20 },
  { value: "medium", label: "Medium", hint: "🍿 episode", cost: 60 },
  { value: "large",  label: "Large",  hint: "🍕 takeout", cost: 150 },
  { value: "treat",  label: "Treat",  hint: "🚗 splurge", cost: 400 },
] as const;

type TierValue = (typeof TIERS)[number]["value"];

export default function RewardsStore() {
  const { data: coins } = useGetCoins();
  const balance = coins?.balance ?? 0;
  const { data: items = [], isLoading } = useGetRewardStoreItems();
  const createMutation = useCreateRewardStoreItem();
  const deleteMutation = useDeleteRewardStoreItem();
  const redeemMutation = useRedeemRewardStoreItem();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [label, setLabel] = useState("");
  const [tier, setTier] = useState<TierValue>("small");

  const atLimit = items.length >= 20;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetRewardStoreItemsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCoinsQueryKey() });
  };

  const handleAdd = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    createMutation.mutate(
      { data: { label: trimmed, tier } },
      {
        onSuccess: () => { setLabel(""); invalidateAll(); },
        onError: (err: any) => toast({ title: apiErrorMessage(err, "Failed to add reward"), variant: "destructive" }),
      },
    );
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate({ id }, { onSuccess: invalidateAll });
  };

  const handleRedeem = (id: number, itemLabel: string) => {
    redeemMutation.mutate(
      { id },
      {
        onSuccess: (res) => {
          invalidateAll();
          if (res.redeemed) {
            toast({ title: `Enjoy it! 🎉`, description: itemLabel });
          } else {
            toast({ title: `${res.remaining} more to go`, description: `Keep going — you're close.` });
          }
        },
        onError: (err: any) => toast({ title: apiErrorMessage(err, "Couldn't redeem"), variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-xl">
      {/* Header + balance */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-400/15 border border-amber-400/30 flex items-center justify-center">
              <Gift className="w-5 h-5 text-amber-400" />
            </div>
            <h1 className="text-3xl font-bold text-foreground">Rewards Store</h1>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 text-amber-300">
            <Coins className="w-4 h-4" />
            <span className="font-semibold tabular-nums">{balance}</span>
          </div>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          Real-life rewards you earn the right to enjoy. Complete quests to earn coins, then cash them in — no rush, coins never expire.
        </p>
      </div>

      {/* Add reward */}
      <div className="bg-card rounded-xl border border-border p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Plus className="w-4 h-4 text-primary" />
          Add a reward
        </h2>

        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Order takeout"
          maxLength={100}
          disabled={atLimit || createMutation.isPending}
          className="border-border focus:border-primary"
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TIERS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTier(t.value)}
              disabled={atLimit}
              className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded-lg border text-left transition-all ${
                tier === t.value
                  ? "border-amber-400/50 bg-amber-400/10 text-foreground"
                  : "border-border bg-muted/30 text-muted-foreground hover:border-amber-400/30"
              }`}
            >
              <span className="text-sm font-medium">{t.label}</span>
              <span className="text-xs">{t.hint}</span>
              <span className="text-xs text-amber-300/80 flex items-center gap-1"><Coins className="w-3 h-3" />{t.cost}</span>
            </button>
          ))}
        </div>

        <Button
          onClick={handleAdd}
          disabled={!label.trim() || atLimit || createMutation.isPending}
          className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
        >
          {createMutation.isPending ? "Adding…" : "Add reward"}
        </Button>

        {atLimit && (
          <p className="text-xs text-muted-foreground">You've reached the 20-reward limit. Remove one to add more.</p>
        )}
      </div>

      {/* Reward list */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          Your rewards
          <span className="ml-2 text-xs text-muted-foreground font-normal">({items.length}/20)</span>
        </h2>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted/30 animate-pulse" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <Gift className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No rewards yet.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Add something worth saving up for.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="group flex items-center gap-3 px-4 py-3 rounded-xl bg-card border border-border">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-foreground truncate">{item.label}</div>
                  <div className="text-xs text-amber-300/80 flex items-center gap-1 mt-0.5">
                    <Coins className="w-3 h-3" />{item.coinCost}
                  </div>
                </div>
                {item.affordable ? (
                  <Button
                    size="sm"
                    onClick={() => handleRedeem(item.id, item.label)}
                    disabled={redeemMutation.isPending}
                    className="bg-amber-500 hover:bg-amber-500/90 text-black shrink-0"
                  >
                    Redeem
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{item.remaining} more to go</span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(item.id)}
                  disabled={deleteMutation.isPending}
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  aria-label="Remove reward"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register the route**

In `artifacts/focusquest/src/App.tsx`, add the import with the other page imports:

```tsx
import RewardsStore from "@/pages/rewards-store";
```

and add the route inside `<Switch>`, before the `<Route component={NotFound} />` fallback:

```tsx
        <Route path="/rewards" component={RewardsStore} />
```

- [ ] **Step 3: Add the nav item**

In `artifacts/focusquest/src/components/layout.tsx`, add `ShoppingBag` to the existing `lucide-react` import, and add this entry to `allNavItems` (right after the `/dopamine-menu` entry):

```tsx
  { href: "/rewards",       label: "Store",      icon: ShoppingBag, mobileShow: false },
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Verify in the app**

With the dev server running, navigate to `/rewards`. Add a reward (pick a tier), confirm it appears with its cost. If the balance is below cost it shows "N more to go"; if at/above, a Redeem button. Redeem an affordable one → toast "Enjoy it! 🎉", balance drops by the cost, chip updates. Try redeeming an unaffordable one (temporarily add a cheap Small and drain, or read the "more to go" state). Capture a screenshot of the store.

- [ ] **Step 6: Commit**

```bash
git add artifacts/focusquest/src/pages/rewards-store.tsx artifacts/focusquest/src/App.tsx artifacts/focusquest/src/components/layout.tsx
git commit -m "feat(web): Rewards Store page — tiered add, redeem, delete"
```

---

### Task 8: Refresh the coin chip on earns

**Files:**
- Modify: `artifacts/focusquest/src/components/task-item.tsx` (quest completion)
- Modify: focus-session completion call site (`artifacts/focusquest/src/pages/focus.tsx` or its hook)
- Modify: `artifacts/focusquest/src/pages/questline-detail.tsx` (claim)
- Modify: boss-fight call site (`artifacts/focusquest/src/components/hero-summary.tsx` or `pages/avatar.tsx`)

**Interfaces:**
- Consumes: `getGetCoinsQueryKey` from `@workspace/api-client-react`.

- [ ] **Step 1: Invalidate coins on quest completion**

In `artifacts/focusquest/src/components/task-item.tsx`, add `getGetCoinsQueryKey` to the `@workspace/api-client-react` import. In the `completeMutation` `onSuccess` handler(s) that already invalidate `getGetMyStatsQueryKey()`/`getGetTasksQueryKey()`, add:

```tsx
          queryClient.invalidateQueries({ queryKey: getGetCoinsQueryKey() });
```

- [ ] **Step 2: Invalidate coins on the other three earn sites**

In each of the focus-session-complete, questline-claim, and boss-fight `onSuccess` handlers (the ones that already invalidate stats/tasks/questline/avatar queries), import `getGetCoinsQueryKey` and add the same line:

```tsx
          queryClient.invalidateQueries({ queryKey: getGetCoinsQueryKey() });
```

Use Grep for the mutation hooks to locate the exact handlers: `useCompleteFocusSession`/focus interval mutation, `useClaimQuestline` (in `questline-detail.tsx`), and the battle/`useEnterBattle` mutation (in `hero-summary.tsx` / `avatar.tsx`). Each already has an `onSuccess` with `queryClient.invalidateQueries` — add the coins key beside the existing keys.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Verify the full earn→spend loop in the app**

With the dev server running: note the chip balance, complete a quest → chip increments by 5 (with the roll animation). Complete a focus session → +10. Go to `/rewards`, redeem an affordable reward → balance drops, "Enjoy it! 🎉". Confirm no console errors (`read_console_messages`). Capture a before/after screenshot.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/
git commit -m "feat(web): refresh coin balance on quest/focus/questline/boss earns"
```

---

## Self-Review

**Spec coverage:**
- Coins currency, decoupled from XP → Tasks 1, 3 (awardCoins), 4 (spend never touches XP). ✓
- Anti-shame (no expiry/negative, progress framing, celebratory redeem) → Task 4 guarded deduction + 200 insufficient; Task 7 "N more to go" / "Enjoy it! 🎉". ✓
- Data model: balance column + internal ledger + catalog → Task 1. ✓
- Earn: flat per action, single helper, 5 sites → Tasks 2 (constants), 3 (helper + wiring). Streak milestone reuses existing definition (design's "every 7" superseded by the app's 3/7/14/30 milestone set — a deliberate, better-aligned refinement noted here). ✓
- Spend: size tiers, atomic guarded redeem, 20-item cap → Tasks 2 (tierCost), 4. ✓
- API endpoints → Tasks 4 (routes) + 5 (contract). ✓
- UI: coin chip + earn feedback, Rewards Store page → Tasks 6, 7, 8. Earn feedback delivered via chip roll animation + query invalidation (no per-endpoint response threading — simpler than the spec's optional toast, same effect). ✓
- Testing: pure units tested (Task 2); DB/route/UI verified via typecheck + app, matching the codebase's no-DB-harness convention. ✓
- Out of scope items (history UI, custom prices, mystery/coin-flip, perks, edit) → not built. ✓

**Placeholder scan:** No TBD/TODO. Task 8 Step 2 names candidate files and instructs a Grep to pin exact handlers — acceptable because the invalidation pattern and target hooks are explicit; the only unknown is line numbers.

**Type consistency:** `RewardTier` (`small|medium|large|treat`) consistent across schema, coins.ts, openapi enums, and the page. `CoinReason` values match awardCoins calls and the redeem insert. Generated hook/key names in Tasks 6–8 match the operationIds in Task 5. `redeemDecision` shape `{ affordable, remaining }` matches `present()` and `RedeemResult`. ✓

## Execution Notes

- Verification for non-pure tasks leans on `pnpm typecheck` + driving the app in the Browser preview, because api-server has no DB/route test harness (Global Constraints). This is intentional, not a gap.
- Schema push (Task 1 Step 6) writes to the shared live Neon DB — heed the shared-DB caution before pushing.
