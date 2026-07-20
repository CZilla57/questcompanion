# Honest Coin Implementation Plan (Act VII quest 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make coins the only currency any purchase can cost — one Streak Shield buy path (coins, cap 3), the Gear Store re-priced by rarity on the reward-tier ladder, one shared `spendCoins` grammar, a standing XP-monotonicity tripwire, and one three-tab Rewards hub with `/dopamine-menu` and `/rewards` redirecting.

**Architecture:** Server work is deletion + convergence: the legacy XP shield endpoint dies, the shipped stat-perks path becomes the only shield buy, gear buys route through a new `spendCoins` helper in `lib/award-coins.ts` (the same atomic guarded decrement stat-perks/mystery-box/redeem each hand-roll today — all three refactor onto it). Web work re-wires `/progress`'s shield card onto the perk grammar via a shared `useBuyPerk` hook + pure `shieldCardParts`, re-labels the gear store in coins, and reshapes the interim two-tab Rewards nav group into three first-class routes.

**Tech Stack:** Express + drizzle (`@workspace/db`), openapi → orval-generated clients (`@workspace/api-client-react`, `@workspace/api-zod`), React 18 + wouter + TanStack Query, vitest (pure-lib tests only, in both packages — no HTTP/component harness exists; that's why the standing guard is a source-scan tripwire, not an endpoint matrix).

**Spec:** `docs/superpowers/specs/2026-07-20-honest-coin-design.md` (approved with defaults D1–D5, PR #70). Line anchors refer to files at main `c781a15` (post-PR #69).

## Global Constraints

- **Zero DB migrations.** `CoinReason` and the activity `type` are TS unions over `text` columns; `gear_items.cost_xp` stays in place but is never read after this quest (spec D1). If any task seems to need a migration, stop — the plan is wrong.
- **Never hand-edit `*/src/generated`.** API changes go: edit `lib/api-spec/openapi.yaml` → `pnpm --filter @workspace/api-spec codegen`.
- **XP is never written by a purchase.** No task may add a `totalPoints`/`weeklyPoints` write outside `routes/tasks.ts`'s uncomplete reversal, and no activity row may be inserted with negative `points` (spec §6). Earn rates, shield consumption/restore, and the uncomplete path itself are untouched.
- **Anti-shame copy grammar:** insufficiency is HTTP 200 `{purchased:false, remaining}` rendered as "N more to go" — never a 4xx, never "you can't afford". Level gates keep their 403 (progression, not affordability).
- **Tests:** `pnpm --filter @workspace/api-server test`, `pnpm --filter @workspace/focusquest test`; single file via `... test -- <name>`. Typecheck: `pnpm typecheck` (root). Both suites + typecheck green at the end of every task.
- Branch: `feat/honest-coin` (Task 0). Commit at the end of every task. Verify the branch with `git branch --show-current` before each commit — concurrent sessions share this working tree.

---

### Task 0: Branch

- [ ] **Step 1:** PR #70 (spec + this plan, branch `spec/honest-coin`) must be merged first. Then from up-to-date `main`, create the feature branch:

```bash
git switch main && git pull && git switch -c feat/honest-coin && git status --short
```

Expected: empty status, `git log --oneline -1` shows the PR #70 merge (or later).

---

### Task 1: Economy verbs — `"gear"` reason, `gearCoinCost`, `spendCoins`

**Files:**
- Modify: `lib/db/src/schema/coin-transactions.ts:5-18` (CoinReason union)
- Modify: `artifacts/api-server/src/lib/coins.ts`
- Modify: `artifacts/api-server/src/lib/award-coins.ts`
- Test: `artifacts/api-server/src/lib/coins.test.ts`

**Interfaces:**
- Consumes: `GearRarity` from `@workspace/db` (`"common" | "rare" | "epic" | "legendary"`, exported already — `scripts/src/gear-catalog.ts` imports it).
- Produces (used by Tasks 2, 5):
  - `CoinReason` gains `| "gear"`.
  - `GEAR_COIN_COST: Record<GearRarity, number>` and `gearCoinCost(rarity: GearRarity): number` in `lib/coins.ts`.
  - In `lib/award-coins.ts`:
    ```ts
    export type SpendResult =
      | { ok: true; balance: number }
      | { ok: false; balance: number; remaining: number };
    export async function spendCoins(
      tx: Tx, userId: number, cost: number, reason: CoinReason,
      opts?: { rewardItemId?: number },
    ): Promise<SpendResult>;
    ```

- [ ] **Step 1: Write the failing test** — append to `artifacts/api-server/src/lib/coins.test.ts`:

```ts
import { GEAR_COIN_COST, gearCoinCost } from "./coins";

describe("gearCoinCost (Honest Coin: gear prices ride the reward-tier ladder)", () => {
  it("prices each rarity at its tier", () => {
    expect(gearCoinCost("common")).toBe(20);
    expect(gearCoinCost("rare")).toBe(60);
    expect(gearCoinCost("epic")).toBe(150);
    expect(gearCoinCost("legendary")).toBe(400);
  });
  it("covers exactly the GearRarity values", () => {
    expect(Object.keys(GEAR_COIN_COST).sort()).toEqual(["common", "epic", "legendary", "rare"]);
  });
});
```

(Merge the `import` with the file's existing `./coins` import line if vitest/tsc complains about duplicates.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- coins`
Expected: FAIL — `gearCoinCost` is not exported.

- [ ] **Step 3: Implement.** In `lib/db/src/schema/coin-transactions.ts` extend the union (order matters only for readability — put it after `"boss_win"`):

```ts
export type CoinReason =
  | "quest_complete"
  | "focus_session"
  | "streak_milestone"
  | "questline_complete"
  | "boss_win"
  | "gear"
  | "redeem"
  | "quest_uncomplete"
  | "world_boss_defeat"
  | "mystery_open"
  | "mystery_bonus"
  | "perk_xp_boost"
  | "perk_focus_boost"
  | "perk_streak_shield";
```

In `artifacts/api-server/src/lib/coins.ts`, change the first line to `import type { RewardTier, GearRarity } from "@workspace/db";` and append:

```ts
// Gear prices reuse the reward-tier ladder (Honest Coin): the rarity IS the
// tier, so users meet the same 20/60/150/400 numbers everywhere coins spend.
export const GEAR_COIN_COST: Record<GearRarity, number> = {
  common:    20,
  rare:      60,
  epic:      150,
  legendary: 400,
};

export function gearCoinCost(rarity: GearRarity): number {
  return GEAR_COIN_COST[rarity];
}
```

In `artifacts/api-server/src/lib/award-coins.ts`, change the drizzle import to `import { and, eq, gte, sql } from "drizzle-orm";` and append:

```ts
export type SpendResult =
  | { ok: true; balance: number }
  | { ok: false; balance: number; remaining: number };

/**
 * Spend coins inside the caller's transaction — the one spend grammar
 * (Honest Coin): a single atomic guarded decrement that only fires when the
 * balance covers the cost (can never go negative; a concurrent double-spend
 * can't overspend) plus exactly one negative ledger row. Insufficiency is a
 * value, not an error: {ok:false, remaining} feeds the gentle "N more to go".
 */
export async function spendCoins(
  tx: Tx,
  userId: number,
  cost: number,
  reason: CoinReason,
  opts?: { rewardItemId?: number },
): Promise<SpendResult> {
  const [updated] = await tx
    .update(usersTable)
    .set({ coinBalance: sql`${usersTable.coinBalance} - ${cost}` })
    .where(and(eq(usersTable.id, userId), gte(usersTable.coinBalance, cost)))
    .returning({ balance: usersTable.coinBalance });

  if (!updated) {
    const [u] = await tx
      .select({ balance: usersTable.coinBalance })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    const bal = u?.balance ?? 0;
    return { ok: false, balance: bal, remaining: Math.max(0, cost - bal) };
  }

  await tx.insert(coinTransactionsTable).values({
    userId,
    amount: -cost,
    reason,
    rewardItemId: opts?.rewardItemId,
  });
  return { ok: true, balance: updated.balance };
}
```

(`spendCoins` itself follows the `awardCoins` precedent: db-coupled, so its unit is exercised through the routes that call it plus the existing pure `redeemDecision` tests; no direct unit test.)

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @workspace/api-server test -- coins` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add lib/db/src/schema/coin-transactions.ts artifacts/api-server/src/lib/coins.ts artifacts/api-server/src/lib/award-coins.ts artifacts/api-server/src/lib/coins.test.ts
git commit -m "feat(api): gear coin pricing map + shared spendCoins helper"
```

---

### Task 2: Refactor the three existing spenders onto `spendCoins`

Strictly behavior-preserving — response shapes, status codes, and ledger rows are byte-identical. The existing suites (`stat-perks`, `mystery-box`, `coins`) plus typecheck are the safety net.

**Files:**
- Modify: `artifacts/api-server/src/routes/stat-perks.ts:74-115`
- Modify: `artifacts/api-server/src/routes/mystery-box.ts:51-89`
- Modify: `artifacts/api-server/src/routes/rewards-store.ts:95-121`

**Interfaces:**
- Consumes: `spendCoins`, `SpendResult` from `../lib/award-coins` (Task 1).
- Produces: no interface changes — HTTP contracts identical.

- [ ] **Step 1: Baseline** — `pnpm --filter @workspace/api-server test` → note the pass count (all green).

- [ ] **Step 2: `stat-perks.ts`.** Add `import { spendCoins } from "../lib/award-coins";`. Replace the transaction body between the `at_max` check and the `return { status: "ok", ... }` (currently: the `insufficient` pre-check at lines 86-92, the `decrement` const at 95, the two `.set({ ...decrement, ... })` updates, and the ledger insert at 113) with: spend first, then apply the effect in its own update.

```ts
  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    // Lock the user row: cap check + spend + effect must be atomic so a
    // concurrent double-buy can neither overspend nor exceed the cap.
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
    if (!user) return { status: "not_found" };

    // Shield stock cap takes precedence over affordability — being fully shielded
    // is reassurance, not a "you can't afford it" nudge.
    if (perk.kind === "streak_shield" && !canBuyStreakShield(user.streakFreezes)) {
      return { status: "at_max", balance: user.coinBalance };
    }

    const spent = await spendCoins(tx, userId, perk.coinCost, perk.reason);
    if (!spent.ok) {
      return { status: "insufficient", balance: spent.balance, remaining: spent.remaining };
    }

    // Paid — apply the effect.
    let expiresAt: string | null = null;
    let owned: number | null = null;

    if (perk.kind === "streak_shield") {
      const nextOwned = user.streakFreezes + 1;
      owned = nextOwned;
      await tx.update(usersTable).set({ streakFreezes: nextOwned }).where(eq(usersTable.id, userId));
    } else {
      const current = perk.kind === "xp_boost" ? user.xpBoostExpiresAt : user.focusBoostExpiresAt;
      const next = nextBoostExpiry(current, now, perk.durationHours!);
      expiresAt = next.toISOString();
      const col = perk.kind === "xp_boost"
        ? { xpBoostExpiresAt: next }
        : { focusBoostExpiresAt: next };
      await tx.update(usersTable).set(col).where(eq(usersTable.id, userId));
    }

    return { status: "ok", balance: spent.balance, expiresAt, owned };
  });
```

Remove the now-unused `sql` from the drizzle import and `coinTransactionsTable` from the db import (the ledger row now comes from `spendCoins`). The route's response handling below the transaction is untouched.

- [ ] **Step 3: `mystery-box.ts`.** Add `spendCoins` to the `../lib/award-coins` import. Replace the guarded update + insufficient fallback + ledger insert (lines 63-75) with:

```ts
    const spent = await spendCoins(tx, userId, MYSTERY_COST, "mystery_open");
    if (!spent.ok) {
      return { status: "insufficient", balance: spent.balance, remaining: spent.remaining };
    }
```

and change the success return to use `spent.balance`:

```ts
    return {
      status: "ok",
      balance: spent.balance + bonus,
      bonus,
      reward: { id: reward.id, rewardText: reward.rewardText },
    };
```

Drop `gte` (and `coinTransactionsTable`) from imports if now unused.

- [ ] **Step 4: `rewards-store.ts` redeem.** Add `import { spendCoins } from "../lib/award-coins";`. Replace the guarded update + insufficient fallback + ledger insert (lines 105-119) with:

```ts
    const spent = await spendCoins(tx, userId, item.coinCost, "redeem", { rewardItemId: item.id });
    if (!spent.ok) {
      return { status: "insufficient", balance: spent.balance, remaining: spent.remaining };
    }
    return { status: "ok", balance: spent.balance };
```

Drop `sql`, `gte`, `coinTransactionsTable` from imports if now unused.

- [ ] **Step 5: Run tests + typecheck** — same pass count as Step 1, `pnpm typecheck` clean.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/stat-perks.ts artifacts/api-server/src/routes/mystery-box.ts artifacts/api-server/src/routes/rewards-store.ts
git commit -m "refactor(api): stat-perks, mystery-box, redeem spend through spendCoins"
```

---

### Task 3: `/progress` shield card onto the perk grammar (web)

The legacy endpoint still exists after this task — but nothing references it anymore, which is what lets Task 4 delete it without breaking typecheck.

**Files:**
- Create: `artifacts/focusquest/src/hooks/use-buy-perk.ts`
- Create: `artifacts/focusquest/src/lib/shield-card.ts`
- Test: `artifacts/focusquest/src/lib/shield-card.test.ts`
- Modify: `artifacts/focusquest/src/components/stat-perks-section.tsx`
- Modify: `artifacts/focusquest/src/pages/progress.tsx` (lines 27, 54, 66-84, 93-94, 334-385)

**Interfaces:**
- Consumes: generated `useGetStatPerks`, `useBuyStatPerk`, `getGetStatPerksQueryKey`, `getGetCoinsQueryKey`, `getGetMyStatsQueryKey`, `type StatPerk` (all exist — `stat-perks-section.tsx` imports them today).
- Produces (used within this task and available to any future perk surface):
  - `useBuyPerk(): { buy: (perk: Pick<StatPerk, "id" | "description">) => void; isPending: boolean }`
  - `shieldCardParts(p: { owned: number; atMax: boolean; affordable: boolean; remaining: number; coinCost: number }): ShieldCardState` where

    ```ts
    export interface ShieldCardState {
      held: number;
      statusLine: string;
      ready: boolean; // "Ready" badge + glow styling
      action:
        | { kind: "buy"; label: string }      // "Buy for 30"  (+ coin icon in JSX)
        | { kind: "saving"; label: string }   // "12 more to go" — progress, not failure
        | { kind: "full"; label: string };    // "Fully shielded 🛡️"
    }
    ```

- [ ] **Step 1: Write the failing test** — `artifacts/focusquest/src/lib/shield-card.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shieldCardParts } from "./shield-card";

describe("shieldCardParts", () => {
  it("invites a first buy when affordable and none held", () => {
    const s = shieldCardParts({ owned: 0, atMax: false, affordable: true, remaining: 0, coinCost: 30 });
    expect(s.action).toEqual({ kind: "buy", label: "Buy for 30" });
    expect(s.ready).toBe(false);
    expect(s.statusLine).toBe("Protects your streak from a missed day.");
  });
  it("shows saving progress, never failure, when short", () => {
    const s = shieldCardParts({ owned: 0, atMax: false, affordable: false, remaining: 12, coinCost: 30 });
    expect(s.action).toEqual({ kind: "saving", label: "12 more to go" });
  });
  it("counts held shields with singular/plural copy and stays ready", () => {
    const one = shieldCardParts({ owned: 1, atMax: false, affordable: true, remaining: 0, coinCost: 30 });
    expect(one.ready).toBe(true);
    expect(one.statusLine).toBe("1 shield held — auto-activates if you miss a day");
    const two = shieldCardParts({ owned: 2, atMax: false, affordable: false, remaining: 5, coinCost: 30 });
    expect(two.statusLine).toBe("2 shields held — auto-activates if you miss a day");
    expect(two.action.kind).toBe("saving");
  });
  it("reads at-max as reassurance, not a wall", () => {
    const s = shieldCardParts({ owned: 3, atMax: true, affordable: true, remaining: 0, coinCost: 30 });
    expect(s.ready).toBe(true);
    expect(s.action).toEqual({ kind: "full", label: "Fully shielded 🛡️" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/focusquest test -- shield-card`
Expected: FAIL — cannot resolve `./shield-card`.

- [ ] **Step 3: Implement `lib/shield-card.ts`:**

```ts
// Pure display logic for the /progress Streak Shield card (Honest Coin).
// Mirrors the stat-perks grammar: buying is delight, shortfall is progress
// ("N more to go"), a full stock is reassurance — never an error state.

export interface ShieldCardState {
  held: number;
  statusLine: string;
  ready: boolean;
  action:
    | { kind: "buy"; label: string }
    | { kind: "saving"; label: string }
    | { kind: "full"; label: string };
}

export function shieldCardParts(p: {
  owned: number;
  atMax: boolean;
  affordable: boolean;
  remaining: number;
  coinCost: number;
}): ShieldCardState {
  const held = p.owned;
  const ready = held > 0;
  const statusLine = ready
    ? `${held} shield${held === 1 ? "" : "s"} held — auto-activates if you miss a day`
    : "Protects your streak from a missed day.";

  if (p.atMax) return { held, statusLine, ready, action: { kind: "full", label: "Fully shielded 🛡️" } };
  if (!p.affordable) return { held, statusLine, ready, action: { kind: "saving", label: `${p.remaining} more to go` } };
  return { held, statusLine, ready, action: { kind: "buy", label: `Buy for ${p.coinCost}` } };
}
```

- [ ] **Step 4: Run test to verify it passes** — `pnpm --filter @workspace/focusquest test -- shield-card` → PASS.

- [ ] **Step 5: Extract `hooks/use-buy-perk.ts`** (moved verbatim from `stat-perks-section.tsx`'s `BOUGHT_TITLE` + `invalidate` + `handleBuy`):

```ts
import { useQueryClient } from "@tanstack/react-query";
import {
  useBuyStatPerk,
  getGetStatPerksQueryKey,
  getGetCoinsQueryKey,
  getGetMyStatsQueryKey,
  type StatPerk,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";

// Celebratory copy per perk on a successful buy (anti-shame: buying is delight).
const BOUGHT_TITLE: Record<string, string> = {
  xp_boost: "XP Boost active! ⚡",
  focus_boost: "Focus Boost active! 🎯",
  streak_shield: "Streak Shield ready 🛡️",
};

/** The one perk buy path for every surface (Power-Ups grid, /progress shield
 * card): mutation + invalidation + the perk toast grammar (bought /
 * fully-shielded reassurance / "N more to go"). */
export function useBuyPerk() {
  const buyMutation = useBuyStatPerk();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const buy = (perk: Pick<StatPerk, "id" | "description">) => {
    buyMutation.mutate(
      { id: perk.id },
      {
        onSuccess: (res) => {
          queryClient.invalidateQueries({ queryKey: getGetStatPerksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetCoinsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() }); // streak-freeze count surfaces here
          if (res.purchased) {
            toast({ title: BOUGHT_TITLE[perk.id] ?? "Perk bought!", description: perk.description });
          } else if (res.reason === "at_max") {
            toast({ title: "You're fully shielded 🛡️", description: "Use one before stocking up again." });
          } else {
            toast({ title: `${res.remaining} more to go`, description: "Keep going — you're close." });
          }
        },
        onError: (err: any) => toast({ title: apiErrorMessage(err, "Couldn't buy perk"), variant: "destructive" }),
      },
    );
  };

  return { buy, isPending: buyMutation.isPending };
}
```

In `stat-perks-section.tsx`: delete `BOUGHT_TITLE`, `invalidate`, `handleBuy`, and the `useBuyStatPerk`/`useQueryClient`/`useToast`/`apiErrorMessage`/query-key imports they used; keep `useGetStatPerks` and `type StatPerk`. Add `import { useBuyPerk } from "@/hooks/use-buy-perk";`, inside the component `const { buy, isPending } = useBuyPerk();`, and in the button: `onClick={() => buy(perk)}` and `disabled={isPending}`.

- [ ] **Step 6: Re-wire `progress.tsx`.**
  - Line 27: delete `const FREEZE_COST = 50;`.
  - Imports: remove `useBuyStreakFreeze` from the `@workspace/api-client-react` import (keep `getGetMyStatsQueryKey` only if still referenced — after this step it isn't; the hook owns invalidation — and keep the rest); remove the then-unused `useQueryClient` import if nothing else on the page uses it (it doesn't); add `useGetStatPerks` to the generated-client import; add:

    ```ts
    import { useBuyPerk } from "@/hooks/use-buy-perk";
    import { shieldCardParts } from "@/lib/shield-card";
    import { Coins } from "lucide-react";
    ```

    (append `Coins` to the existing lucide import line).
  - **Placement matters (React hooks must run unconditionally):** the two hook lines replace the mutation setup at lines 52-54, ABOVE the loading early-returns; the derivation block replaces lines 93-94, below the `if (!stats) return null;` guard. Delete `handleBuyFreeze` (lines 66-84) entirely.

    At lines 52-54:

    ```ts
    const { data: perksData } = useGetStatPerks();
    const { buy: buyPerk, isPending: isBuyingPerk } = useBuyPerk();
    ```

    At lines 93-94:

    ```ts
    const shieldPerk = perksData?.perks.find((p) => p.kind === "streak_shield");
    const heldShields = shieldPerk?.owned ?? stats.streakFreezes;
    const shield = shieldCardParts({
      owned: heldShields,
      atMax: shieldPerk?.atMax === true,
      affordable: shieldPerk?.affordable === true,
      remaining: shieldPerk?.remaining ?? 0,
      coinCost: shieldPerk?.coinCost ?? 0,
    });
    const hasFreeze = shield.ready;
    ```

    (`hasFreeze` keeps its name so the card's existing glow/border classNames at lines 335-343 stay untouched.)
  - Replace the card's text + button block (lines 346-382) with:

    ```tsx
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Streak Shield</span>
                    {shield.ready && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 uppercase tracking-wider">
                        Ready
                      </span>
                    )}
                  </div>
                  <p className="text-sm mt-0.5">
                    {shield.ready
                      ? <span className="text-cyan-400 font-semibold">{shield.statusLine}</span>
                      : <span className="text-muted-foreground">{shield.statusLine}</span>
                    }
                  </p>
                </div>
              </div>

              <Button
                onClick={() => shieldPerk && shield.action.kind === "buy" && buyPerk(shieldPerk)}
                disabled={!shieldPerk || shield.action.kind !== "buy" || isBuyingPerk}
                variant={shield.action.kind === "buy" ? "outline" : "ghost"}
                aria-label={
                  shield.action.kind === "buy"
                    ? `Buy Streak Shield for ${shieldPerk?.coinCost ?? 0} coins`
                    : shield.action.label
                }
                className={`cursor-pointer ${
                  shield.action.kind === "buy"
                    ? "border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10 hover:border-cyan-500"
                    : "text-muted-foreground cursor-default"
                }`}
              >
                {shield.action.kind === "full" && <><ShieldCheck className="w-4 h-4 mr-2" aria-hidden /> {shield.action.label}</>}
                {shield.action.kind === "saving" && <><Coins className="w-4 h-4 mr-2" aria-hidden /> {shield.action.label}</>}
                {shield.action.kind === "buy" && <><Coins className="w-4 h-4 mr-2" aria-hidden /> {shield.action.label}</>}
              </Button>
    ```

    (Everything above `<div>` in the card — the icon box with `ShieldCheck`/`ShieldOff` keyed on `hasFreeze` — is unchanged.)

- [ ] **Step 7: Run tests + typecheck** — `pnpm --filter @workspace/focusquest test` all green (25 files + shield-card), `pnpm typecheck` clean. Grep guard: `grep -rn "useBuyStreakFreeze\|FREEZE_COST" artifacts/focusquest/src` → no hits.

- [ ] **Step 8: Commit**

```bash
git add artifacts/focusquest/src/hooks/use-buy-perk.ts artifacts/focusquest/src/lib/shield-card.ts artifacts/focusquest/src/lib/shield-card.test.ts artifacts/focusquest/src/components/stat-perks-section.tsx artifacts/focusquest/src/pages/progress.tsx
git commit -m "feat(web): /progress shield card buys through the coin perk path"
```

---

### Task 4: Delete the legacy XP shield endpoint; shield purchases log in coins

**Files:**
- Modify: `artifacts/api-server/src/routes/users.ts:395-429` (delete block)
- Modify: `artifacts/api-server/src/routes/stat-perks.ts` (activity row in the shield branch)
- Modify: `lib/api-spec/openapi.yaml:246-266` (path) and `:2484-2491` (`StreakFreezeResult` schema)
- Regenerate: `lib/api-client-react`, `lib/api-zod` (via codegen — never by hand)

**Interfaces:**
- Consumes: post-Task-2 `stat-perks.ts` shape (shield branch applies effect after `spendCoins`).
- Produces: `POST /users/me/streak-freeze/buy` no longer exists anywhere (server, spec, generated clients). `userStats.streakFreezes` is untouched and continues to serve `/progress`.

- [ ] **Step 1: Delete the endpoint.** In `routes/users.ts` remove lines 395-429: the `FREEZE_COST`/`FREEZE_MAX` consts and the whole `router.post("/users/me/streak-freeze/buy", …)` handler. `activityTable` stays imported (the stats endpoint reads it). Run `pnpm typecheck` — if it flags now-unused imports in `users.ts`, remove exactly those.

- [ ] **Step 2: Log the coin purchase.** In `stat-perks.ts`, the shield branch becomes (after Task 2 it sets `streakFreezes` only):

```ts
    if (perk.kind === "streak_shield") {
      const nextOwned = user.streakFreezes + 1;
      owned = nextOwned;
      await tx.update(usersTable).set({ streakFreezes: nextOwned }).where(eq(usersTable.id, userId));
      // The purchase stays visible in the Activity Log — priced in coins, zero
      // XP delta (Honest Coin: no negative-points activity rows, ever).
      await tx.insert(activityTable).values({
        userId,
        type: "streak_freeze_bought",
        description: `Bought a Streak Shield for ${perk.coinCost} coins`,
        points: 0,
      });
    } else {
```

Add `activityTable` to the `@workspace/db` import in `stat-perks.ts`.

- [ ] **Step 3: openapi.** Delete the `/users/me/streak-freeze/buy:` path block (lines 246-266) and the `StreakFreezeResult:` schema (lines 2484-2491). Then regenerate:

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: clean run; `git status` shows only `*/src/generated/*` changes; `grep -rn "buyStreakFreeze\|StreakFreezeResult" lib artifacts --include="*.ts" --include="*.tsx"` → zero hits (Task 3 already removed the web reference).

- [ ] **Step 4: Run both suites + typecheck** — `pnpm --filter @workspace/api-server test`, `pnpm --filter @workspace/focusquest test`, `pnpm typecheck`: all green.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/users.ts artifacts/api-server/src/routes/stat-perks.ts lib/api-spec/openapi.yaml lib/api-client-react lib/api-zod
git commit -m "feat(api): one shield buy path — legacy XP endpoint deleted, purchase logs in coins"
```

---

### Task 5: Gear Store spends coins (api + openapi + avatar UI)

One task end-to-end because the generated types rename (`costXp`→`costCoins`, `userXp`→`coinBalance`) breaks `avatar.tsx` the moment codegen runs — server, spec, and web must land together to keep the repo green.

**Files:**
- Modify: `artifacts/api-server/src/routes/gear.ts:8-119`
- Modify: `lib/api-spec/openapi.yaml` — `/gear/{id}/buy` (1833-1862), `GearStoreItem` (3371-3405), `GearStoreResponse` (3407-3418), `BuyGearResult` (3420-3429), activity `type` enum (3213)
- Regenerate: generated clients (codegen)
- Modify: `artifacts/focusquest/src/pages/avatar.tsx` (GearCard ~198-279, `handleBuy` ~542-561, XP-balance strip + hint ~769-786, `showEarnXpHint` ~599-604, GearCard call site ~815-825)
- Modify: `artifacts/focusquest/src/pages/progress.tsx:392-405` (activity icons)

**Interfaces:**
- Consumes: `gearCoinCost` + `spendCoins` + `"gear"` reason (Task 1).
- Produces:
  - `GET /gear/store` → `{ items: GearStoreItem[], coinBalance: number, userLevel: number }` with `GearStoreItem.costCoins` (no `costXp`), `canAfford` = coin affordability.
  - `POST /gear/{id}/buy` → 200 `{ purchased: boolean, reason: "ok" | "insufficient", balance, remaining, coinsSpent? }`; 403 only for level; 409 already-owned.
  - Activity type `"gear_bought"` (openapi enum + renderer icon).

- [ ] **Step 1: `gear.ts`.** Imports become:

```ts
import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, usersTable, gearItemsTable, userGearTable, activityTable } from "@workspace/db";
import { getLevelInfo } from "../lib/gamification";
import { gearCoinCost } from "../lib/coins";
import { spendCoins } from "../lib/award-coins";
```

Store handler: change the item ordering + mapping + response (lines 15, 21-38). Ordering drops the dormant `cost_xp` read in favor of the progression order (near-identical sequence — costs correlate with level):

```ts
  const allItems = await db.select().from(gearItemsTable)
    .orderBy(gearItemsTable.levelRequired, gearItemsTable.statPower);
```

```ts
  const items = allItems.map(item => {
    const costCoins = gearCoinCost(item.rarity);
    return {
      id: item.id,
      name: item.name,
      description: item.description,
      slot: item.slot,
      rarity: item.rarity,
      statPower: item.statPower,
      costCoins,
      levelRequired: item.levelRequired,
      icon: item.icon,
      spriteId: item.spriteId ?? null,
      owned: ownedMap.has(item.id),
      equipped: ownedMap.get(item.id)?.equipped ?? false,
      canAfford: user.coinBalance >= costCoins,
      meetsLevel: levelInfo.level >= item.levelRequired,
    };
  });

  res.json({ items, coinBalance: user.coinBalance, userLevel: levelInfo.level });
```

Buy handler: replace the `BuyOutcome` type and transaction body (lines 52-101) — level gate and ownership check unchanged, XP math gone:

```ts
  type BuyOutcome =
    | { status: "insufficient_level" }
    | { status: "already_owned" }
    | { status: "insufficient"; balance: number; remaining: number }
    | { status: "ok"; balance: number; cost: number };

  let outcome: BuyOutcome;
  try {
    outcome = await db.transaction(async (tx): Promise<BuyOutcome> => {
      // Lock the user row so concurrent purchases serialize here.
      const [user] = await tx.select().from(usersTable)
        .where(eq(usersTable.id, userId))
        .for("update");
      if (!user) return { status: "insufficient", balance: 0, remaining: gearCoinCost(item.rarity) };

      const levelInfo = getLevelInfo(user.totalPoints);
      if (levelInfo.level < item.levelRequired) return { status: "insufficient_level" };

      // Re-check ownership inside the transaction to prevent duplicate rows from a
      // concurrent purchase of the same item (the unique constraint is the hard guard;
      // this check provides a clean 409 error message before the insert).
      const existing = await tx.select({ id: userGearTable.id })
        .from(userGearTable)
        .where(and(eq(userGearTable.userId, userId), eq(userGearTable.gearItemId, gearId)));
      if (existing.length > 0) return { status: "already_owned" };

      const cost = gearCoinCost(item.rarity);
      const spent = await spendCoins(tx, userId, cost, "gear");
      if (!spent.ok) return { status: "insufficient", balance: spent.balance, remaining: spent.remaining };

      await tx.insert(userGearTable)
        .values({ userId, gearItemId: gearId })
        .onConflictDoNothing();

      // Zero XP delta and an honest type — purchases are no longer disguised as
      // task_completed rows (Honest Coin).
      await tx.insert(activityTable).values({
        userId,
        type: "gear_bought",
        description: `Purchased ${item.name} from the Gear Store`,
        points: 0,
      });

      return { status: "ok", balance: spent.balance, cost };
    });
  } catch {
    res.status(500).json({ error: "Purchase failed" });
    return;
  }
```

Response handling (replaces lines 108-118):

```ts
  if (outcome.status === "insufficient_level") {
    res.status(403).json({ error: `Requires level ${item.levelRequired}` }); return;
  }
  if (outcome.status === "already_owned") {
    res.status(409).json({ error: "Already owned" }); return;
  }
  if (outcome.status === "insufficient") {
    // Gentle, not an error: "N more to go". HTTP 200 so it never reads as failure.
    res.status(200).json({
      purchased: false, reason: "insufficient",
      balance: outcome.balance, remaining: outcome.remaining,
    });
    return;
  }
  res.status(200).json({
    purchased: true, reason: "ok",
    balance: outcome.balance, remaining: 0, coinsSpent: outcome.cost,
  });
```

- [ ] **Step 2: openapi.** In `GearStoreItem` (3371): rename the `costXp` property to `costCoins` (same `type: integer`) and update the `required` list accordingly. In `GearStoreResponse` (3407): rename `userXp` → `coinBalance` in properties and `required`. Replace `BuyGearResult` (3420-3429) with:

```yaml
    BuyGearResult:
      type: object
      required: [purchased, reason, balance, remaining]
      properties:
        purchased:
          type: boolean
        reason:
          type: string
          enum: [ok, insufficient]
        balance:
          type: integer
        remaining:
          type: integer
        coinsSpent:
          type: integer
```

In the `/gear/{id}/buy` path (1833): summary becomes `Purchase a gear item with coins (insufficiency is a gentle 200)`; the `"200"` description becomes `Purchase result (purchased=false when short on coins)`; the `"403"` description becomes `Level too low`. Add `gear_bought` to the activity `type` enum on line 3213 (after `streak_freeze_used`).

Run: `pnpm --filter @workspace/api-spec codegen` → only `*/src/generated/*` diffs.

- [ ] **Step 3: `avatar.tsx`.**
  - `GearCard`: rename the `userXp` prop to `balance` (both in the destructure and the props type — `userXp: number` → `balance: number`); the price button block (263-279) becomes:

    ```tsx
          ) : !item.owned ? (
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs h-8 gap-1.5"
              style={item.canAfford ? { borderColor: rarityColor + "66", color: rarityColor } : undefined}
              disabled={!item.canAfford || isBuying}
              onClick={() => onBuy(item.id)}
            >
              <Coins className="w-3 h-3" />
              {item.costCoins.toLocaleString()} coins
              {!item.canAfford && (
                <span className="text-muted-foreground ml-1 text-[10px]">
                  ({(item.costCoins - balance).toLocaleString()} more to go)
                </span>
              )}
            </Button>
    ```

  - Imports: add `Coins` to the lucide import; add `getGetMyStatsQueryKey` is NOT needed — but the buy invalidation gains coins: in `handleBuy` (546-549) add `qc.invalidateQueries({ queryKey: getGetCoinsQueryKey() })` to the `Promise.all` (the `getGetCoinsQueryKey` import already exists at line 16).
  - `handleBuy` branches on the new payload (replaces 542-561):

    ```ts
      async function handleBuy(id: number) {
        setBusyGearId(id);
        try {
          const res = await buyGear.mutateAsync({ id });
          await Promise.all([
            qc.invalidateQueries({ queryKey: getGetAvatarQueryKey() }),
            qc.invalidateQueries({ queryKey: getGetGearStoreQueryKey() }),
            qc.invalidateQueries({ queryKey: getGetCoinsQueryKey() }),
          ]);
          if (res.purchased) {
            toast({
              title: "Gear acquired!",
              description: `${res.coinsSpent} coins well spent. ${res.balance} left.`,
              className: "border-primary",
            });
          } else {
            // Gentle shortfall — mirrors every other coin surface.
            toast({ title: `${res.remaining} more to go`, description: "Keep going — you're close." });
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Purchase failed";
          toast({ title: "Purchase failed", description: msg, variant: "destructive" });
        } finally {
          setBusyGearId(null);
        }
      }
    ```

  - Balance strip (772-778) becomes a coin strip:

    ```tsx
              {storeData && (
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-amber-400/5 border border-amber-400/20">
                  <Coins className="w-4 h-4 text-amber-400" />
                  <span className="text-sm text-muted-foreground">Coins:</span>
                  <span className="font-bold text-amber-300">{storeData.coinBalance.toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground ml-auto">Level {storeData.userLevel}</span>
                </div>
              )}
    ```

  - Hint rename + copy (599-604 and 781-786): rename `showEarnXpHint` → `showEarnCoinsHint` (same boolean logic over the new `canAfford`), copy becomes `Earn coins by completing quests and focus sessions, then spend them here — gear never costs XP.` (keep the surrounding JSX; swap the `Zap` icon for `Coins`).
  - GearCard call site (~819): `userXp={storeData?.userXp ?? 0}` → `balance={storeData?.coinBalance ?? 0}`.

- [ ] **Step 4: Activity Log icons.** In `progress.tsx` icon switch (line 400 area) add, after the `streak_freeze_used` line:

```tsx
                    {activity.type === 'gear_bought'          && <ShoppingBag className="w-4 h-4 text-amber-400" />}
                    {activity.type === 'gear_earned'          && <ShoppingBag className="w-4 h-4 text-secondary" />}
```

(`gear_earned` is a drive-by: milestone gear grants already write that type — `lib/gear-rewards.ts:115` — and rendered iconless until now.) Add `ShoppingBag` to the page's lucide import.

- [ ] **Step 5: Run everything**

Run: `pnpm --filter @workspace/api-server test && pnpm --filter @workspace/focusquest test && pnpm typecheck`
Expected: all green. Grep guard: `grep -rn "costXp\|userXp" artifacts/focusquest/src artifacts/api-server/src` → zero hits (the catalog/seed under `scripts/` and the `cost_xp` column in `lib/db` legitimately remain).

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/gear.ts lib/api-spec/openapi.yaml lib/api-client-react lib/api-zod artifacts/focusquest/src/pages/avatar.tsx artifacts/focusquest/src/pages/progress.tsx
git commit -m "feat: Gear Store spends coins — rarity-tier prices, gentle shortfall, honest activity rows"
```

---

### Task 6: The standing XP-monotonicity tripwire

The act mandates a regression guard that "must survive all future acts". Both test packages are pure-lib only (no HTTP harness), so the guard is a **source scan**: it fails the suite if any file outside the allowlist writes an XP decrement, or if any activity insert carries negative points. This is exactly the class of bug it exists to catch — someone reintroducing an XP price.

**Files:**
- Test (create): `artifacts/api-server/src/lib/xp-monotonicity.test.ts`

**Interfaces:**
- Consumes: the repaired sources from Tasks 4-5 (it fails on pre-repair code by design).
- Produces: a permanent invariant; future tasks touching XP must keep it green.

- [ ] **Step 1: Write the test** (it should PASS immediately — Tasks 4/5 already repaired the two violators; to see it fail, `git stash` those changes or temporarily add `points: -1` anywhere):

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// ── Standing regression guard (Act VII, Honest Coin — spec §6) ──────────────
// XP is progression, coins are the spendable currency. `totalPoints` /
// `weeklyPoints` may only decrease in the quest-uncomplete award reversal
// (routes/tasks.ts, snapshot-bounded, clamped at 0), and no activity row may
// ever be written with negative points. Adding a file to an allowlist below
// requires an award-reversal justification — a purchase never qualifies.

const SRC = join(__dirname, "..");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

const files = tsFiles(SRC).map((p) => ({
  rel: relative(SRC, p).replace(/\\/g, "/"),
  src: readFileSync(p, "utf8"),
}));

// `user.totalPoints - x` / `u.weeklyPoints - x` — a member-access decrement.
const MEMBER_DECREMENT = /\.(totalPoints|weeklyPoints)\s*-(?!-)/;
// `sql`${usersTable.totalPoints} - x`` — a SQL-side decrement.
const SQL_DECREMENT = /\$\{usersTable\.(totalPoints|weeklyPoints)\}\s*-/;
// `points: -x` — a negative-points activity row (the coin ledger uses `amount:`,
// so it never trips this).
const NEGATIVE_ACTIVITY_POINTS = /points:\s*-/;

const XP_DECREMENT_ALLOWLIST = new Set([
  "routes/tasks.ts", // uncomplete reversal: bounded by the completion's own snapshot
]);

describe("XP monotonicity (standing guard)", () => {
  it("only the uncomplete reversal may decrement totalPoints/weeklyPoints", () => {
    const offenders = files
      .filter((f) => !XP_DECREMENT_ALLOWLIST.has(f.rel))
      .filter((f) => MEMBER_DECREMENT.test(f.src) || SQL_DECREMENT.test(f.src))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("the allowlist is honest: tasks.ts still contains the reversal", () => {
    const tasks = files.find((f) => f.rel === "routes/tasks.ts");
    expect(tasks && MEMBER_DECREMENT.test(tasks.src)).toBe(true);
  });

  it("no code path writes a negative-points activity row", () => {
    const offenders = files
      .filter((f) => NEGATIVE_ACTIVITY_POINTS.test(f.src))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("the legacy XP shield endpoint stays dead", () => {
    const users = files.find((f) => f.rel === "routes/users.ts");
    expect(users?.src).not.toContain("streak-freeze/buy");
    expect(users?.src).not.toContain("FREEZE_COST");
  });

  it("gear never touches XP columns", () => {
    const gear = files.find((f) => f.rel === "routes/gear.ts");
    expect(gear?.src).not.toMatch(/(totalPoints|weeklyPoints|currentLevel):\s/);
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @workspace/api-server test -- xp-monotonicity`
Expected: PASS (5/5). Sanity-check the tripwire actually trips: temporarily change `points: 0` to `points: -1` in `gear.ts`, re-run → the negative-activity assertion FAILS naming `routes/gear.ts`; revert.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/lib/xp-monotonicity.test.ts
git commit -m "test(api): standing XP-monotonicity guard — spends can never touch XP"
```

---

### Task 7: The Rewards hub — three routes, two redirects, one nav group

**Files:**
- Rename: `artifacts/focusquest/src/pages/dopamine-menu.tsx` → `artifacts/focusquest/src/pages/rewards-treats.tsx` (git rename, then edit)
- Create: `artifacts/focusquest/src/pages/rewards-perks.tsx`
- Modify: `artifacts/focusquest/src/pages/rewards-store.tsx` (drop the perks section)
- Modify: `artifacts/focusquest/src/components/stat-perks-section.tsx` (optional header)
- Modify: `artifacts/focusquest/src/App.tsx:2,21,26,178-179`
- Modify: `artifacts/focusquest/src/lib/nav-groups.ts:42-50`
- Test: `artifacts/focusquest/src/lib/nav-groups.test.ts`

**Interfaces:**
- Consumes: `PageTabs` (`group="rewards"` — prop type already includes it), `NAV_GROUPS` shape from PR #69 (`as const satisfies readonly NavGroup[]`, `tabs` required-but-`undefined`).
- Produces: routes `/rewards/treats` (default), `/rewards/store`, `/rewards/perks`; `/dopamine-menu` and `/rewards` redirect to `/rewards/treats`; `StatPerksSection` gains `hideHeader?: boolean`.

- [ ] **Step 1: Update the nav test first** — in `nav-groups.test.ts`, replace the reachability test and the `/dopamine-menu` assertion:

```ts
  it("keeps every pre-consolidation nav href reachable in some group", () => {
    const reachable = NAV_GROUPS.flatMap((g) => [g.href, ...(g.tabs ?? []).map((t) => t.href)]);
    // /dopamine-menu and /rewards are the two retired URLs (Honest Coin) —
    // they redirect to /rewards/treats in App.tsx instead of appearing here.
    for (const href of ["/", "/tasks", "/questlines", "/focus", "/recurring", "/progress",
      "/insights", "/avatar", "/partners", "/leaderboard",
      "/rewards/treats", "/rewards/store", "/rewards/perks"]) {
      expect(reachable).toContain(href);
    }
  });
```

and in the `activeGroupKey` describe:

```ts
    expect(activeGroupKey("/rewards/treats")).toBe("rewards");
    expect(activeGroupKey("/rewards/perks")).toBe("rewards");
```

(replacing the `activeGroupKey("/dopamine-menu")` line).

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @workspace/focusquest test -- nav-groups` → FAIL (old hrefs).

- [ ] **Step 3: `nav-groups.ts`** — replace the interim rewards group (lines 42-50) with:

```ts
  {
    // The Rewards hub (Act VII q3, Honest Coin): three first-class tab routes.
    // /rewards and /dopamine-menu redirect to Treats in App.tsx.
    key: "rewards", label: "Rewards", href: "/rewards/treats", mobileShow: false,
    tabs: [
      { label: "Treats", href: "/rewards/treats" },
      { label: "Store", href: "/rewards/store" },
      { label: "Perks", href: "/rewards/perks" },
    ],
  },
```

Run `pnpm --filter @workspace/focusquest test -- nav-groups` → PASS.

- [ ] **Step 4: Rename Treats.** `git mv artifacts/focusquest/src/pages/dopamine-menu.tsx artifacts/focusquest/src/pages/rewards-treats.tsx`, then rename the component: `export default function DopamineMenu()` → `export default function RewardsTreats()`. Page content (header "Dopamine Menu", MysteryBox, list) unchanged — the tab is named Treats, the feature keeps its name.

- [ ] **Step 5: Split Perks out of Store.** In `stat-perks-section.tsx`, make the section header optional:

```tsx
export function StatPerksSection({ hideHeader = false }: { hideHeader?: boolean } = {}) {
```

and wrap the existing header `<div>` (the `Power-Ups` h2 + blurb) in `{!hideHeader && ( … )}`. In `rewards-store.tsx`: delete the `StatPerksSection` import and the `<StatPerksSection />` line (104-105). Create `rewards-perks.tsx`:

```tsx
import { useGetCoins } from "@workspace/api-client-react";
import { StatPerksSection } from "@/components/stat-perks-section";
import { PageTabs } from "@/components/page-tabs";
import { Coins, Zap } from "lucide-react";

export default function RewardsPerks() {
  const { data: coins } = useGetCoins();
  const balance = coins?.balance ?? 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-xl">
      <PageTabs group="rewards" />
      {/* Header + balance */}
      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-400/15 border border-amber-400/30 flex items-center justify-center">
              <Zap className="w-5 h-5 text-amber-400" />
            </div>
            <h1 className="text-3xl font-bold text-foreground">Power-Ups</h1>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 text-amber-300">
            <Coins className="w-4 h-4" />
            <span className="font-semibold tabular-nums">{balance}</span>
          </div>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          Spend coins to play stronger. Boosts stack their timer; nothing here ever costs you XP or a streak.
        </p>
      </div>

      <StatPerksSection hideHeader />
    </div>
  );
}
```

- [ ] **Step 6: Routes + redirects.** In `App.tsx`: line 2 add `Redirect` (`import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";`); replace the `DopamineMenu` import (line 21) with `import RewardsTreats from "@/pages/rewards-treats";` and add `import RewardsPerks from "@/pages/rewards-perks";`. Replace routes 178-179 with:

```tsx
        <Route path="/rewards/treats" component={RewardsTreats} />
        <Route path="/rewards/store" component={RewardsStore} />
        <Route path="/rewards/perks" component={RewardsPerks} />
        {/* Honest Coin: the two retired reward URLs land on the hub's default tab. */}
        <Route path="/dopamine-menu"><Redirect to="/rewards/treats" /></Route>
        <Route path="/rewards"><Redirect to="/rewards/treats" /></Route>
```

(Specific `/rewards/*` routes precede the bare `/rewards` redirect per spec §7 — wouter matches exactly per-route, but the `Switch` takes the first match, so order still matters for `/rewards` itself.)

- [ ] **Step 7: Run tests + typecheck** — `pnpm --filter @workspace/focusquest test` and `pnpm typecheck` green. Grep guard: `grep -rn "dopamine-menu" artifacts/focusquest/src` → only the `App.tsx` redirect and (unchanged) generated-client paths for the dopamine-rewards API — no page imports.

- [ ] **Step 8: Commit**

```bash
git add -A artifacts/focusquest/src
git commit -m "feat(web): Rewards hub — /rewards/treats·store·perks tabs, retired URLs redirect"
```

---

### Task 8: Sweep, verify, PR

**Files:** none new — audits and verification.

- [ ] **Step 1: Copy audit.** Confirm no user-facing purchase copy prices anything in XP:

```bash
grep -rn "FREEZE_COST\|useBuyStreakFreeze\|buyStreakFreeze\|StreakFreezeResult" artifacts lib --include="*.ts" --include="*.tsx"
grep -rn "costXp\|userXp" artifacts --include="*.ts" --include="*.tsx"
grep -rni "xp" artifacts/focusquest/src/pages/avatar.tsx artifacts/focusquest/src/pages/rewards-store.tsx artifacts/focusquest/src/pages/rewards-treats.tsx artifacts/focusquest/src/pages/rewards-perks.tsx artifacts/focusquest/src/components/stat-perks-section.tsx
```

Expected: first two → zero hits; third → only non-price mentions (the XP-boost perk's own copy "+50% XP from quests…", "nothing here ever costs you XP", and gear's "gear never costs XP" — boosts *grant* XP, that's the point).

- [ ] **Step 2: Full gates.**

```bash
pnpm --filter @workspace/api-server test && pnpm --filter @workspace/focusquest test && pnpm --filter @workspace/quick-add test && pnpm typecheck
```

Expected: all green — api-server gains the `xp-monotonicity` file and the `gearCoinCost` cases; focusquest gains `shield-card` and the updated `nav-groups` assertions.

- [ ] **Step 3: Browser drive (unauth extent).** Start the dev server via the Browser pane (launch config, not Bash) and verify the unauth shell renders clean with no console errors. The authed drive — shield buy on `/progress`, a gear purchase showing coins, the three hub tabs, `/dopamine-menu` → `/rewards/treats` redirect — is on Chad (Auth0 wall; same constraint as PRs #43/#68), with the test suites + typecheck as the merge gate.

- [ ] **Step 4: PR.**

```bash
git push -u origin feat/honest-coin
& "C:\Program Files\GitHub CLI\gh.exe" pr create --title "feat: Honest Coin — one currency, one shield, coin-priced gear, Rewards hub (Act VII q3)" --body "Implements docs/superpowers/specs/2026-07-20-honest-coin-design.md (approved, PR #70) per docs/superpowers/plans/2026-07-20-honest-coin.md. Level can never move backwards from any purchase; standing xp-monotonicity guard included. Zero DB migrations."
```

- [ ] **Step 5: Post-merge (session ritual):** refresh the campaign map artifact (30/38 cleared) + roadmap memory; note the authed-drive ask for Chad.

---

## Acceptance ↔ task map (spec §10)

| Acceptance | Where |
|---|---|
| No purchase can move level/progress backwards | Tasks 4, 5 (repairs) + Task 6 (standing guard) |
| One shield buy path, coins only, gentle when short | Tasks 3 + 4 |
| Gear coins-only, legendary = 400 coins + level gate | Task 5 |
| One nav entry → three tabs; retired URLs redirect | Task 7 |
| Guard exists, passes, and trips on reintroduction | Task 6 (incl. the deliberate-trip sanity check) |
