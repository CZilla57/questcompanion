# Life Kingdoms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn quest categories into five visible "kingdoms" whose growth is permanent and whose quiet is noticeable, giving the user a glanceable life-balance instrument.

**Architecture:** A persisted monotonic points counter per (user, kingdom) drives an absolute *structure tier*; a share-of-recent-activity calculation derives *liveliness* at read time and is stored nowhere. Pure, renderer-agnostic modules compute both, a canvas component renders a declarative scene description behind a swappable seam, and two surfaces consume it — a dashboard strip and a full map on insights.

**Tech Stack:** TypeScript, Express, Drizzle ORM (Neon Postgres), React + Vite, vitest, canvas 2D, orval codegen.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-18-life-kingdoms-design.md` — read it before starting.
- **Anti-Shame Design law:** no state may render as decay, ruin, damage, or judgment. `dormant` renders as *night*, never as ruin.
- **Monotonic structure:** kingdom points are NEVER decremented — not on uncomplete, not on delete, not on absence.
- **Growth unit:** `tasks.points` (base). NEVER `pointsAwarded` (multiplier-boosted) and never completion counts.
- **Capital exclusion:** the `default` category feeds the Capital, which is excluded from the liveliness denominator, from neglect detection, and from the balance reading.
- **Derived-not-stored:** tier, liveliness, neglect invitation, and world-resting are computed at read time. Only lifetime points are persisted.
- **Never hand-edit** files under `*/src/generated` — regenerate with orval.
- **Tests:** `pnpm --filter @workspace/api-server test`, `pnpm --filter @workspace/focusquest test`.
- **Typecheck gate:** `pnpm typecheck` from the repo root.
- **Branch:** `feat/life-kingdoms` (already created).

## File Structure

**Create:**
- `artifacts/api-server/src/lib/kingdoms.ts` — pure: mapping, tier, liveliness, neglect, world-resting
- `artifacts/api-server/src/lib/kingdoms.test.ts`
- `lib/db/src/schema/kingdom-points.ts` — `kingdom_points` table
- `artifacts/focusquest/src/lib/kingdom-scene.ts` — pure: scene description resolution
- `artifacts/focusquest/src/lib/kingdom-scene.test.ts`
- `artifacts/focusquest/src/lib/kingdom-sprites.ts` — sprite catalog (terrain rects, building images, painted glow)
- `artifacts/focusquest/src/lib/kingdom-buildings-catalog.ts` — GENERATED building sizes/urls
- `scripts/src/build-kingdom-buildings.ts` — build-time building compositor
- `artifacts/focusquest/src/components/kingdom-scene.tsx` — canvas renderer (the seam)
- `artifacts/focusquest/src/components/kingdom-strip.tsx` — dashboard strip
- `artifacts/focusquest/src/components/kingdom-map.tsx` — full map for insights
- `artifacts/focusquest/public/kingdoms/*.png` + `CREDITS.csv` — vendored art

**Modify:**
- `lib/db/src/schema/index.ts` — export the new table
- `artifacts/api-server/src/routes/tasks.ts:638-660` — increment kingdom points in the completion tx
- `artifacts/api-server/src/routes/users.ts` — add `GET /users/me/kingdoms`
- `lib/api-spec/openapi.yaml` — the new endpoint + schemas
- `artifacts/focusquest/src/pages/dashboard.tsx` — mount the strip
- `artifacts/focusquest/src/pages/insights.tsx` — mount the map above `categoryBreakdown`

## Two deliberate deviations from the spec

Both were decided while planning; the spec's *intent* is preserved.

1. **Scene descriptions are generated procedurally, not hand-authored in Tiled.** The spec called for Tiled JSON layouts. Hand-authoring 5 kingdoms × 6 tiers = 30 layouts is art-direction work that cannot be specified in a plan or executed reliably by an implementing agent, and it front-loads the entire art cost. Instead, each kingdom gets a compact declarative `KingdomSceneSpec` (terrain tiles + ordered building slots + prop positions), and a pure function resolves `(spec, tier, liveliness) → SceneLayer[]`. The engine-portability property the spec actually wanted is preserved: `SceneLayer[]` is a declarative, renderer-agnostic display list that a Pixi adapter consumes directly, and hand-authored Tiled layouts can override the procedural output later without touching consumers.

2. **Sprites are referenced by source rect, not sliced into files.** Canvas `drawImage` takes a source rectangle natively, so the vendored 2048×2048 sheets can be used as-is with a catalog of `{ id, sheet, sx, sy, w, h }`. This removes an entire build-pipeline task.

---

### Task 1: Kingdom mapping and structure tiers

**Files:**
- Create: `artifacts/api-server/src/lib/kingdoms.ts`
- Test: `artifacts/api-server/src/lib/kingdoms.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `KingdomId` (`"hearth" | "wellspring" | "forge" | "athenaeum" | "crossroads" | "capital"`), `KINGDOMS: KingdomMeta[]`, `CATEGORY_TO_KINGDOM: Record<string, KingdomId>`, `kingdomForCategory(category: string): KingdomId`, `KingdomTierInfo { tier: number; name: string; minPoints: number }`, `kingdomTier(points: number): KingdomTierInfo`

- [ ] **Step 1: Write the failing test**

```typescript
// artifacts/api-server/src/lib/kingdoms.test.ts
import { describe, it, expect } from "vitest";
import { CATEGORY_TO_KINGDOM, kingdomForCategory, kingdomTier, KINGDOMS } from "./kingdoms";
import { CATEGORY_LABELS } from "./auto-points";

describe("kingdom mapping", () => {
  it("maps every canonical category to a kingdom", () => {
    for (const slug of Object.keys(CATEGORY_LABELS)) {
      expect(CATEGORY_TO_KINGDOM[slug], `category ${slug} is unmapped`).toBeDefined();
    }
  });

  it("routes the default category to the capital", () => {
    expect(kingdomForCategory("default")).toBe("capital");
  });

  it("groups the working life into the forge", () => {
    expect(kingdomForCategory("deep_work")).toBe("forge");
    expect(kingdomForCategory("finance")).toBe("forge");
    expect(kingdomForCategory("admin")).toBe("forge");
  });

  it("falls back to the capital for an unknown category", () => {
    expect(kingdomForCategory("not_a_real_category")).toBe("capital");
  });

  it("marks exactly one kingdom as the capital", () => {
    expect(KINGDOMS.filter((k) => k.isCapital)).toHaveLength(1);
  });
});

describe("kingdomTier", () => {
  it("returns Wild at zero points", () => {
    expect(kingdomTier(0)).toMatchObject({ tier: 0, name: "Wild" });
  });

  it("returns tier boundaries exactly", () => {
    expect(kingdomTier(1).tier).toBe(1);
    expect(kingdomTier(249).tier).toBe(1);
    expect(kingdomTier(250).tier).toBe(2);
    expect(kingdomTier(999).tier).toBe(2);
    expect(kingdomTier(1000).tier).toBe(3);
    expect(kingdomTier(2999).tier).toBe(3);
    expect(kingdomTier(3000).tier).toBe(4);
    expect(kingdomTier(7999).tier).toBe(4);
    expect(kingdomTier(8000).tier).toBe(5);
  });

  it("never regresses as points grow", () => {
    let last = -1;
    for (let p = 0; p <= 9000; p += 37) {
      const t = kingdomTier(p).tier;
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- kingdoms`
Expected: FAIL — `Failed to resolve import "./kingdoms"`

- [ ] **Step 3: Write minimal implementation**

```typescript
// artifacts/api-server/src/lib/kingdoms.ts
// Act VI Life Kingdoms: life areas as places. Structure (lifetime points) is
// persisted and monotonic; tier, liveliness and neglect are all derived at read
// time and stored nowhere — same discipline as companion.ts / hero-care.ts.

export type KingdomId = "hearth" | "wellspring" | "forge" | "athenaeum" | "crossroads" | "capital";

export type KingdomMeta = {
  id: KingdomId;
  name: string;
  /** The capital grows but is excluded from the balance reading. */
  isCapital: boolean;
};

export const KINGDOMS: KingdomMeta[] = [
  { id: "hearth",     name: "Hearth",     isCapital: false },
  { id: "wellspring", name: "Wellspring", isCapital: false },
  { id: "forge",      name: "Forge",      isCapital: false },
  { id: "athenaeum",  name: "Athenaeum",  isCapital: false },
  { id: "crossroads", name: "Crossroads", isCapital: false },
  { id: "capital",    name: "Capital",    isCapital: true  },
];

/** The five balance kingdoms, in display order. Excludes the capital. */
export const BALANCE_KINGDOMS: KingdomId[] = KINGDOMS.filter((k) => !k.isCapital).map((k) => k.id);

export const CATEGORY_TO_KINGDOM: Record<string, KingdomId> = {
  household: "hearth",
  errands:   "hearth",
  health:    "wellspring",
  self_care: "wellspring",
  deep_work: "forge",
  admin:     "forge",
  finance:   "forge",
  learning:  "athenaeum",
  creative:  "athenaeum",
  social:    "crossroads",
  travel:    "crossroads",
  default:   "capital",
};

/** Unknown categories fall to the capital — they carry no balance meaning. */
export function kingdomForCategory(category: string): KingdomId {
  return CATEGORY_TO_KINGDOM[category] ?? "capital";
}

export type KingdomTierInfo = { tier: number; name: string; minPoints: number };

const KINGDOM_TIERS: KingdomTierInfo[] = [
  { tier: 5, name: "Stronghold", minPoints: 8000 },
  { tier: 4, name: "Town",       minPoints: 3000 },
  { tier: 3, name: "Village",    minPoints: 1000 },
  { tier: 2, name: "Settlement", minPoints: 250 },
  { tier: 1, name: "Outpost",    minPoints: 1 },
  { tier: 0, name: "Wild",       minPoints: 0 },
];

/** Absolute thresholds — never relative to the user's other kingdoms, which
 *  would make the strongest kingdom permanently "the capital" and destroy the
 *  balance signal. */
export function kingdomTier(points: number): KingdomTierInfo {
  for (const t of KINGDOM_TIERS) {
    if (points >= t.minPoints) return t;
  }
  return KINGDOM_TIERS[KINGDOM_TIERS.length - 1]!;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server test -- kingdoms`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/kingdoms.ts artifacts/api-server/src/lib/kingdoms.test.ts
git commit -m "feat(api): kingdom category mapping and structure tiers"
```

---

### Task 2: Liveliness and the world-resting guard

**Files:**
- Modify: `artifacts/api-server/src/lib/kingdoms.ts`
- Test: `artifacts/api-server/src/lib/kingdoms.test.ts`

**Interfaces:**
- Consumes: `KingdomId`, `BALANCE_KINGDOMS` from Task 1
- Produces: `Liveliness` (`"dormant" | "stirring" | "steady" | "bustling"`), `LIVELINESS_WINDOW_DAYS = 14`, `WORLD_RESTING_THRESHOLD = 100`, `balanceRecentTotal(recentByKingdom: Partial<Record<KingdomId, number>>): number`, `isWorldResting(recentByKingdom: Partial<Record<KingdomId, number>>): boolean`, `deriveLiveliness(kingdomRecentPoints: number, balanceTotal: number): Liveliness`

- [ ] **Step 1: Write the failing test**

```typescript
// append to artifacts/api-server/src/lib/kingdoms.test.ts
import {
  deriveLiveliness, isWorldResting, WORLD_RESTING_THRESHOLD, LIVELINESS_WINDOW_DAYS,
} from "./kingdoms";

describe("deriveLiveliness", () => {
  it("is dormant with no activity regardless of the total", () => {
    expect(deriveLiveliness(0, 1000)).toBe("dormant");
    expect(deriveLiveliness(0, 0)).toBe("dormant");
  });

  it("bands on share of the balance total", () => {
    expect(deriveLiveliness(5, 1000)).toBe("stirring");   // 0.5%
    expect(deriveLiveliness(99, 1000)).toBe("stirring");  // 9.9%
    expect(deriveLiveliness(100, 1000)).toBe("steady");   // 10%
    expect(deriveLiveliness(300, 1000)).toBe("steady");   // 30%
    expect(deriveLiveliness(301, 1000)).toBe("bustling"); // 30.1%
  });

  it("reads the same for a low-activity and a high-activity user at equal share", () => {
    // The whole point of share-based bands: absolute thresholds would show a
    // quiet user five dormant kingdoms and a busy user five bustling ones.
    expect(deriveLiveliness(60, 300)).toBe(deriveLiveliness(6000, 30000));
  });

  it("never divides by zero", () => {
    expect(deriveLiveliness(50, 0)).toBe("dormant");
  });
});

describe("isWorldResting", () => {
  it("is true below the threshold", () => {
    expect(isWorldResting({ forge: 40, hearth: 30 })).toBe(true);
  });

  it("is true for a single quest in the window", () => {
    // Without a floor, share math would call this kingdom 100% — "bustling" —
    // and read the other four as pointed neglect.
    expect(isWorldResting({ forge: 25 })).toBe(true);
  });

  it("is false at or above the threshold", () => {
    expect(isWorldResting({ forge: WORLD_RESTING_THRESHOLD })).toBe(false);
  });

  it("ignores the capital when totalling", () => {
    // Uncategorized work must not make the world look awake.
    expect(isWorldResting({ capital: 5000, forge: 20 })).toBe(true);
  });

  it("is true for a completely empty world", () => {
    expect(isWorldResting({})).toBe(true);
  });
});

describe("window constant", () => {
  it("uses a 14-day liveliness window", () => {
    expect(LIVELINESS_WINDOW_DAYS).toBe(14);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- kingdoms`
Expected: FAIL — `deriveLiveliness is not a function`

- [ ] **Step 3: Write minimal implementation**

```typescript
// append to artifacts/api-server/src/lib/kingdoms.ts

export type Liveliness = "dormant" | "stirring" | "steady" | "bustling";

/** Rolling window for the liveliness reading. */
export const LIVELINESS_WINDOW_DAYS = 14;

/**
 * Below this many recent balance-kingdom points, the world reads as *resting*
 * rather than producing per-kingdom verdicts. A plain zero-check is not enough:
 * with one quest in the window, share math would report that kingdom at 100%
 * and the other four as pointed neglect. The floor stops the instrument drawing
 * confident conclusions from a sample too small to support them.
 */
export const WORLD_RESTING_THRESHOLD = 100;

/** Sum of recent points across the five balance kingdoms. Excludes the capital. */
export function balanceRecentTotal(recentByKingdom: Partial<Record<KingdomId, number>>): number {
  return BALANCE_KINGDOMS.reduce((sum, id) => sum + (recentByKingdom[id] ?? 0), 0);
}

export function isWorldResting(recentByKingdom: Partial<Record<KingdomId, number>>): boolean {
  return balanceRecentTotal(recentByKingdom) < WORLD_RESTING_THRESHOLD;
}

/**
 * Share-based, never absolute. The denominator excludes the capital so that
 * uncategorized work cannot dilute every real kingdom's share.
 */
export function deriveLiveliness(kingdomRecentPoints: number, balanceTotal: number): Liveliness {
  if (kingdomRecentPoints <= 0 || balanceTotal <= 0) return "dormant";
  const share = kingdomRecentPoints / balanceTotal;
  if (share < 0.10) return "stirring";
  if (share <= 0.30) return "steady";
  return "bustling";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server test -- kingdoms`
Expected: PASS — all tests including the 11 new ones

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/kingdoms.ts artifacts/api-server/src/lib/kingdoms.test.ts
git commit -m "feat(api): share-based kingdom liveliness with world-resting floor"
```

---

### Task 3: The neglect invitation

**Files:**
- Modify: `artifacts/api-server/src/lib/kingdoms.ts`
- Test: `artifacts/api-server/src/lib/kingdoms.test.ts`

**Interfaces:**
- Consumes: `KingdomId`, `BALANCE_KINGDOMS`, `Liveliness`, `isWorldResting`, `deriveLiveliness`, `balanceRecentTotal` from Tasks 1–2
- Produces: `NeglectInvitation { kingdomId: KingdomId; kingdomName: string }`, `deriveNeglectInvitation(args: { lifetimeByKingdom: Partial<Record<KingdomId, number>>; recentByKingdom: Partial<Record<KingdomId, number>> }): NeglectInvitation | null`

- [ ] **Step 1: Write the failing test**

```typescript
// append to artifacts/api-server/src/lib/kingdoms.test.ts
import { deriveNeglectInvitation } from "./kingdoms";

describe("deriveNeglectInvitation", () => {
  const active = { forge: 600, hearth: 300 }; // 900 recent, well above the floor

  it("invites back to a kingdom that is built but dormant", () => {
    const result = deriveNeglectInvitation({
      lifetimeByKingdom: { forge: 5000, hearth: 2000, wellspring: 1200 },
      recentByKingdom: active,
    });
    expect(result).toMatchObject({ kingdomId: "wellspring", kingdomName: "Wellspring" });
  });

  it("never invites to a kingdom the user has never built in", () => {
    // Reflect the user's own pattern back; never prescribe a life.
    const result = deriveNeglectInvitation({
      lifetimeByKingdom: { forge: 5000, hearth: 2000 },
      recentByKingdom: active,
    });
    expect(result).toBeNull();
  });

  it("is suppressed entirely when the world is resting", () => {
    // Absence belongs to hunger and the companion; kingdoms must not pile on.
    const result = deriveNeglectInvitation({
      lifetimeByKingdom: { forge: 5000, wellspring: 1200 },
      recentByKingdom: { forge: 20 },
    });
    expect(result).toBeNull();
  });

  it("never invites to the capital", () => {
    const result = deriveNeglectInvitation({
      lifetimeByKingdom: { capital: 9000, forge: 5000 },
      recentByKingdom: active,
    });
    expect(result).toBeNull();
  });

  it("picks the most-built dormant kingdom when several qualify", () => {
    const result = deriveNeglectInvitation({
      lifetimeByKingdom: { forge: 5000, wellspring: 1200, athenaeum: 3400 },
      recentByKingdom: active,
    });
    expect(result?.kingdomId).toBe("athenaeum");
  });

  it("returns null when every built kingdom is active", () => {
    const result = deriveNeglectInvitation({
      lifetimeByKingdom: { forge: 5000, hearth: 2000 },
      recentByKingdom: { forge: 600, hearth: 300 },
    });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- kingdoms`
Expected: FAIL — `deriveNeglectInvitation is not a function`

- [ ] **Step 3: Write minimal implementation**

```typescript
// append to artifacts/api-server/src/lib/kingdoms.ts

export type NeglectInvitation = { kingdomId: KingdomId; kingdomName: string };

/**
 * "You've built here before, and haven't visited lately." Self-calibrating: it
 * only ever names a kingdom the user has actually invested in, so it reflects
 * their pattern rather than prescribing a life.
 *
 * Suppressed entirely while the world is resting — telling someone who has been
 * away from everything that they have neglected one area is exactly wrong, and
 * absence is already hunger's and the companion's territory.
 */
export function deriveNeglectInvitation(args: {
  lifetimeByKingdom: Partial<Record<KingdomId, number>>;
  recentByKingdom: Partial<Record<KingdomId, number>>;
}): NeglectInvitation | null {
  if (isWorldResting(args.recentByKingdom)) return null;

  const total = balanceRecentTotal(args.recentByKingdom);

  const candidates = BALANCE_KINGDOMS
    .map((id) => ({
      id,
      lifetime: args.lifetimeByKingdom[id] ?? 0,
      liveliness: deriveLiveliness(args.recentByKingdom[id] ?? 0, total),
    }))
    .filter((k) => k.lifetime > 0 && k.liveliness === "dormant")
    .sort((a, b) => b.lifetime - a.lifetime);

  const top = candidates[0];
  if (!top) return null;
  return { kingdomId: top.id, kingdomName: KINGDOMS.find((k) => k.id === top.id)!.name };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server test -- kingdoms`
Expected: PASS — all tests including the 6 new ones

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/kingdoms.ts artifacts/api-server/src/lib/kingdoms.test.ts
git commit -m "feat(api): neglect invitation with global-absence guard"
```

---

### Task 4: `kingdom_points` schema

**Files:**
- Create: `lib/db/src/schema/kingdom-points.ts`
- Modify: `lib/db/src/schema/index.ts`

**Interfaces:**
- Consumes: `usersTable` from `./users`
- Produces: `kingdomPointsTable` with columns `id`, `userId`, `kingdomId`, `lifetimePoints`, `updatedAt`; unique constraint `kingdom_points_user_kingdom_unique` on `(userId, kingdomId)`

**Why a table and not derivation:** lifetime points *could* be summed from `tasks` by category, but that would silently decrease when a task is uncompleted or deleted, breaking the monotonic invariant. A persisted counter is required.

**Why a table and not user columns:** six kingdoms would mean six columns plus a migration for every future kingdom; the keyed table follows the `coin_transactions` precedent and stays open to more kingdoms.

- [ ] **Step 1: Create the schema file**

```typescript
// lib/db/src/schema/kingdom-points.ts
import { pgTable, serial, integer, text, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Act VI Life Kingdoms: persisted MONOTONIC structure points, one row per
// (user, kingdom). Incremented by base task points in the completion
// transaction and NEVER decremented — not on uncomplete, not on delete. That
// invariant is what makes a neglected kingdom read as "asleep" rather than
// "ruined", so it is load-bearing for the anti-shame law, not an optimisation.
//
// Liveliness, tier and the neglect invitation are all derived at read time and
// are deliberately absent from this table.
export const kingdomPointsTable = pgTable("kingdom_points", {
  id:             serial("id").primaryKey(),
  userId:         integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  kingdomId:      text("kingdom_id").notNull(), // KingdomId from api-server/src/lib/kingdoms.ts
  lifetimePoints: integer("lifetime_points").notNull().default(0),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique("kingdom_points_user_kingdom_unique").on(t.userId, t.kingdomId),
]);

export type KingdomPoints = typeof kingdomPointsTable.$inferSelect;
```

- [ ] **Step 2: Export from the schema index**

Add to `lib/db/src/schema/index.ts`, after the `weekly-recaps` line:

```typescript
export * from "./kingdom-points";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS, no errors

- [ ] **Step 4: Push the schema to Neon**

```bash
cd lib/db
export DATABASE_URL="$(grep -E '^DATABASE_URL=' ../../.env | cut -d= -f2-)"
pnpm --filter @workspace/db push
```

Expected: `[✓] Changes applied`

**GOTCHA — read before running:** this table carries a UNIQUE constraint. On a *populated* table that triggers an interactive TTY prompt offering a truncate, which a non-interactive shell cannot answer — **never pass `--force`**. This is a brand-new empty table, so the create should apply cleanly. If a prompt appears anyway, stop and apply the DDL via a one-off `pg` script from `lib/db` instead, using drizzle's default constraint names (`kingdom_points_user_kingdom_unique`, `kingdom_points_user_id_users_id_fk`), then re-run `push` to confirm parity. There is also known pre-existing `weekly_battles` drift in this database that is unrelated to this work — do not try to fix it here.

- [ ] **Step 5: Commit**

```bash
git add lib/db/src/schema/kingdom-points.ts lib/db/src/schema/index.ts
git commit -m "feat(db): kingdom_points table for monotonic structure points"
```

---

### Task 5: Grow kingdom points in the completion transaction

**Files:**
- Create: `artifacts/api-server/src/lib/kingdom-growth.ts`
- Test: `artifacts/api-server/src/lib/kingdom-growth.test.ts`
- Modify: `artifacts/api-server/src/routes/tasks.ts` (completion tx, around line 638–660)

**Interfaces:**
- Consumes: `kingdomForCategory` from Task 1, `kingdomPointsTable` from Task 4
- Produces: `KingdomGrowth { kingdomId: KingdomId; points: number }`, `kingdomGrowth(category: string, basePoints: number): KingdomGrowth | null`, `growKingdom(tx, userId: number, category: string, basePoints: number): Promise<void>`

**Structure:** the growth *decision* is a pure function tested directly; `growKingdom` is a thin DB wrapper around it, verified by typecheck and the route. This matches how `companion.ts` and `hero-care.ts` are already built, and this package has no DB test harness — do NOT introduce a mock transaction.

- [ ] **Step 1: Write the failing test**

```typescript
// artifacts/api-server/src/lib/kingdom-growth.test.ts
import { describe, it, expect } from "vitest";
import { kingdomGrowth } from "./kingdom-growth";

describe("kingdomGrowth", () => {
  it("routes points to the kingdom that owns the category", () => {
    expect(kingdomGrowth("deep_work", 35)).toEqual({ kingdomId: "forge", points: 35 });
    expect(kingdomGrowth("household", 20)).toEqual({ kingdomId: "hearth", points: 20 });
  });

  it("sends uncategorized work to the capital", () => {
    expect(kingdomGrowth("default", 15)).toEqual({ kingdomId: "capital", points: 15 });
  });

  it("sends an unknown category to the capital", () => {
    expect(kingdomGrowth("not_a_real_category", 15)).toEqual({ kingdomId: "capital", points: 15 });
  });

  it("declines zero or negative points", () => {
    expect(kingdomGrowth("health", 0)).toBeNull();
    expect(kingdomGrowth("health", -20)).toBeNull();
  });

  it("passes base points through unchanged", () => {
    // Growth must reflect the quest's own worth, never a boosted total.
    expect(kingdomGrowth("deep_work", 35)!.points).toBe(35);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- kingdom-growth`
Expected: FAIL — `Failed to resolve import "./kingdom-growth"`

- [ ] **Step 3: Write minimal implementation**

```typescript
// artifacts/api-server/src/lib/kingdom-growth.ts
import { sql } from "drizzle-orm";
import { kingdomPointsTable } from "@workspace/db";
import { kingdomForCategory, type KingdomId } from "./kingdoms";

export type KingdomGrowth = { kingdomId: KingdomId; points: number };

/**
 * Pure growth decision: which kingdom a completed quest feeds, and by how much.
 * Null means "nothing to record".
 *
 * The caller MUST pass base `tasks.points`, never the multiplier-boosted
 * `pointsAwarded`: an instrument meant to reflect real life must not move
 * because the user bought an XP perk.
 */
export function kingdomGrowth(category: string, basePoints: number): KingdomGrowth | null {
  if (basePoints <= 0) return null;
  return { kingdomId: kingdomForCategory(category), points: basePoints };
}

// Structurally typed against the transaction handle rather than importing
// drizzle's PgTransaction generics, which are painful to name at a call site
// and would couple this lib to the driver.
type InsertCapableTx = { insert: (table: typeof kingdomPointsTable) => any };

/**
 * Persist the growth decision, creating the row on first contact. Called inside
 * the completion transaction.
 *
 * INVARIANT: only ever adds. There is deliberately no matching shrink function —
 * uncomplete and delete leave kingdom points untouched, which is what makes a
 * quiet kingdom read as asleep rather than ruined.
 */
export async function growKingdom(
  tx: InsertCapableTx,
  userId: number,
  category: string,
  basePoints: number,
): Promise<void> {
  const growth = kingdomGrowth(category, basePoints);
  if (!growth) return;
  await tx
    .insert(kingdomPointsTable)
    .values({ userId, kingdomId: growth.kingdomId, lifetimePoints: growth.points })
    .onConflictDoUpdate({
      target: [kingdomPointsTable.userId, kingdomPointsTable.kingdomId],
      set: {
        lifetimePoints: sql`${kingdomPointsTable.lifetimePoints} + ${growth.points}`,
        updatedAt: new Date(),
      },
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server test -- kingdom-growth`
Expected: PASS — 5 tests

- [ ] **Step 5: Wire into the completion transaction**

In `artifacts/api-server/src/routes/tasks.ts`, add the import alongside the other lib imports near the top:

```typescript
import { growKingdom } from "../lib/kingdom-growth";
```

Then, immediately after the `await tx.update(usersTable).set({...})` block that ends with `.where(eq(usersTable.id, userId));` (currently line ~660) and *before* the `// Act IV coins:` comment, insert:

```typescript
    // Act VI Life Kingdoms: base points (NOT boostedBase) grow the kingdom that
    // owns this quest's category. Monotonic — /uncomplete deliberately does not
    // reverse this.
    await growKingdom(tx, userId, task.category, task.points);
```

- [ ] **Step 6: Verify uncomplete does NOT reverse it**

Read the `/uncomplete` handler (around line 928 onward). Confirm by inspection that it contains **no** call to `growKingdom` and no write to `kingdomPointsTable`. Do not add one. If a future reviewer asks why coins reverse but kingdoms do not: coins are a spendable currency and must balance; kingdom structure is a record of effort that was genuinely made.

- [ ] **Step 7: Typecheck and run the full server suite**

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS, no regressions

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/lib/kingdom-growth.ts artifacts/api-server/src/lib/kingdom-growth.test.ts artifacts/api-server/src/routes/tasks.ts
git commit -m "feat(api): grow kingdom points on completion, monotonic"
```

---

### Task 6: `GET /users/me/kingdoms`

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Modify: `artifacts/api-server/src/routes/users.ts`
- Regenerate: `lib/api-client-react/src/generated/**`, `lib/api-zod/src/generated/**`

**Interfaces:**
- Consumes: everything from Tasks 1–4
- Produces: `useGetKingdoms()` React Query hook. Response shape:

```typescript
{
  worldResting: boolean;
  kingdoms: Array<{
    id: string; name: string; isCapital: boolean;
    lifetimePoints: number;
    tier: number; tierName: string;
    liveliness: "dormant" | "stirring" | "steady" | "bustling";
  }>;
  invitation: { kingdomId: string; kingdomName: string } | null;
}
```

- [ ] **Step 1: Add the OpenAPI definition**

In `lib/api-spec/openapi.yaml`, add this path next to the other `/users/me/*` paths:

```yaml
  /users/me/kingdoms:
    get:
      operationId: getKingdoms
      summary: Life Kingdoms state — structure tiers, derived liveliness, and the neglect invitation
      tags: [users]
      responses:
        "200":
          description: Kingdom state
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/KingdomsResponse"
        "401":
          description: Unauthorized
```

And in `components.schemas`:

```yaml
    KingdomsResponse:
      type: object
      required: [worldResting, kingdoms, invitation]
      properties:
        worldResting:
          type: boolean
          description: True when recent activity is below the resting floor; the map renders one warm sleeping world rather than five neglect verdicts.
        kingdoms:
          type: array
          items:
            $ref: "#/components/schemas/KingdomState"
        invitation:
          oneOf:
            - $ref: "#/components/schemas/KingdomInvitation"
            - type: "null"

    KingdomState:
      type: object
      required: [id, name, isCapital, lifetimePoints, tier, tierName, liveliness]
      properties:
        id:
          type: string
          enum: [hearth, wellspring, forge, athenaeum, crossroads, capital]
        name:
          type: string
        isCapital:
          type: boolean
        lifetimePoints:
          type: integer
        tier:
          type: integer
        tierName:
          type: string
        liveliness:
          type: string
          enum: [dormant, stirring, steady, bustling]

    KingdomInvitation:
      type: object
      required: [kingdomId, kingdomName]
      properties:
        kingdomId:
          type: string
        kingdomName:
          type: string
```

- [ ] **Step 2: Regenerate the clients**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: files under `lib/api-client-react/src/generated` and `lib/api-zod/src/generated` update. Never hand-edit them.

- [ ] **Step 3: Implement the route**

In `artifacts/api-server/src/routes/users.ts`, extend the existing imports. **`eq` and `tasksTable` are almost certainly already imported in this file — extend those import statements rather than adding duplicates, which will not compile.** Add only what is missing:

```typescript
// extend the existing @workspace/db import with:  kingdomPointsTable
// extend the existing drizzle-orm import with:    and, gte
import {
  KINGDOMS, kingdomForCategory, kingdomTier, deriveLiveliness, deriveNeglectInvitation,
  isWorldResting, balanceRecentTotal, LIVELINESS_WINDOW_DAYS, type KingdomId,
} from "../lib/kingdoms";
```

Add the route next to `/users/me/hero-status`:

```typescript
router.get("/users/me/kingdoms", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  // Lifetime (persisted, monotonic).
  const rows = await db.select().from(kingdomPointsTable).where(eq(kingdomPointsTable.userId, userId));
  const lifetimeByKingdom: Partial<Record<KingdomId, number>> = {};
  for (const r of rows) lifetimeByKingdom[r.kingdomId as KingdomId] = r.lifetimePoints;

  // Recent (derived): base points of quests completed inside the window.
  const windowStart = new Date(Date.now() - LIVELINESS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recentTasks = await db
    .select({ category: tasksTable.category, points: tasksTable.points })
    .from(tasksTable)
    .where(and(
      eq(tasksTable.userId, userId),
      eq(tasksTable.completed, true),
      gte(tasksTable.completedAt, windowStart),
    ));

  const recentByKingdom: Partial<Record<KingdomId, number>> = {};
  for (const t of recentTasks) {
    const id = kingdomForCategory(t.category);
    recentByKingdom[id] = (recentByKingdom[id] ?? 0) + t.points;
  }

  const total = balanceRecentTotal(recentByKingdom);

  res.json({
    worldResting: isWorldResting(recentByKingdom),
    kingdoms: KINGDOMS.map((k) => {
      const lifetime = lifetimeByKingdom[k.id] ?? 0;
      const t = kingdomTier(lifetime);
      return {
        id: k.id,
        name: k.name,
        isCapital: k.isCapital,
        lifetimePoints: lifetime,
        tier: t.tier,
        tierName: t.name,
        liveliness: deriveLiveliness(recentByKingdom[k.id] ?? 0, total),
      };
    }),
    invitation: deriveNeglectInvitation({ lifetimeByKingdom, recentByKingdom }),
  });
});
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. If `tasksTable.completedAt` or `tasksTable.points` do not exist under those names, read `lib/db/src/schema/tasks.ts` and use the actual column names rather than guessing.

- [ ] **Step 5: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react lib/api-zod artifacts/api-server/src/routes/users.ts
git commit -m "feat(api): GET /users/me/kingdoms"
```

---

### Task 7: Vendor the art and build the sprite catalog

**Files:**
- Create: `artifacts/focusquest/public/kingdoms/terrain.png`, `buildings.png`, `CREDITS.csv`
- Create: `artifacts/focusquest/src/lib/kingdom-sprites.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `SpriteRef { sheet: "terrain" | "buildings"; sx: number; sy: number; w: number; h: number }`, `SPRITES: Record<string, SpriteRef>`, `SHEET_URLS: Record<"terrain" | "buildings", string>`

**BLOCKING PRE-STEP — licensing check.** Before downloading anything, confirm the Craftpix.net inclusion in the [LPC Revised] pack's credit list is compatible with CC-BY 3.0 / OGA-BY 3.0 redistribution. Craftpix is a commercial vendor and its standard licence forbids redistribution. If this cannot be confirmed, **stop and report back** — do not vendor the pack. Fallback if it fails: use `OpenGameArt/LiberatedPixelCup` (CC-BY-SA 3.0 / GPL 3.0 / OGA-BY 3.0, verified clean) — abundant terrain plus `Sharm/building-exterior/house.png` and `HughSpectrum/castle_*.png`, which supports a reduced building set.

- [ ] **Step 1: Download the pack**

Source: https://opengameart.org/content/lpc-revised-fully-configured-4-seasons-tilesets-for-tiled-map-editor
Take the summer terrain sheet and the buildings sheet. Save as `artifacts/focusquest/public/kingdoms/terrain.png` and `buildings.png`.

- [ ] **Step 2: Write CREDITS.csv**

```csv
file,authors,licenses,source
terrain.png,"JaidynReiman; Eliza Wyatt (DeathsDarling); Lanea Zimmerman (Sharm); Stephen Challener (Redshrike); Johannes Sjölund (Wulax); BlueCarrot16; BenCreating; Durrani; YuriNikolai","CC-BY 3.0, OGA-BY 3.0",https://opengameart.org/content/lpc-revised-fully-configured-4-seasons-tilesets-for-tiled-map-editor
buildings.png,"JaidynReiman; Eliza Wyatt (DeathsDarling); Lanea Zimmerman (Sharm); Stephen Challener (Redshrike); Johannes Sjölund (Wulax); BlueCarrot16; BenCreating; Durrani; YuriNikolai","CC-BY 3.0, OGA-BY 3.0",https://opengameart.org/content/lpc-revised-fully-configured-4-seasons-tilesets-for-tiled-map-editor
```

- [ ] **Step 3: Build the sprite catalog**

Open each sheet and record real source rects — do not invent coordinates. LPC tiles are 32×32; buildings occupy multi-tile blocks. Fill in the `sx`/`sy` values you actually observe.

```typescript
// artifacts/focusquest/src/lib/kingdom-sprites.ts
// Sprites are addressed as source rects into the vendored sheets — canvas
// drawImage takes a source rectangle natively, so no slicing pipeline is needed.
// Attribution lives in public/kingdoms/CREDITS.csv.

export type SheetId = "terrain" | "buildings";

export type SpriteRef = { sheet: SheetId; sx: number; sy: number; w: number; h: number };

export const SHEET_URLS: Record<SheetId, string> = {
  terrain: "/kingdoms/terrain.png",
  buildings: "/kingdoms/buildings.png",
};

export const TILE = 32;

/** Verified source rects. Coordinates MUST be read off the real sheets. */
export const SPRITES: Record<string, SpriteRef> = {
  "ground.grass":    { sheet: "terrain", sx: 0,   sy: 0,   w: TILE, h: TILE },
  "ground.dirt":     { sheet: "terrain", sx: 32,  sy: 0,   w: TILE, h: TILE },
  "ground.water":    { sheet: "terrain", sx: 64,  sy: 0,   w: TILE, h: TILE },
  "ground.rock":     { sheet: "terrain", sx: 96,  sy: 0,   w: TILE, h: TILE },
  "prop.tree":       { sheet: "terrain", sx: 0,   sy: 32,  w: TILE, h: TILE * 2 },
  "prop.bridge":     { sheet: "terrain", sx: 32,  sy: 32,  w: TILE * 2, h: TILE },
  "prop.sign":       { sheet: "terrain", sx: 96,  sy: 32,  w: TILE, h: TILE },
  "build.hut":       { sheet: "buildings", sx: 0,   sy: 0,  w: TILE * 2, h: TILE * 2 },
  "build.house":     { sheet: "buildings", sx: 64,  sy: 0,  w: TILE * 3, h: TILE * 3 },
  "build.hall":      { sheet: "buildings", sx: 160, sy: 0,  w: TILE * 4, h: TILE * 3 },
  "build.tower":     { sheet: "buildings", sx: 288, sy: 0,  w: TILE * 2, h: TILE * 4 },
  "build.keep":      { sheet: "buildings", sx: 352, sy: 0,  w: TILE * 5, h: TILE * 4 },
  // Liveliness overlay — a lit window/lantern. Find a small light-source tile on
  // the buildings sheet (the LPC lineage ships castle_lightsources art).
  "overlay.lantern": { sheet: "buildings", sx: 0,   sy: 256, w: TILE, h: TILE },
};
```

- [ ] **Step 4: Verify the sheets load**

Run: `pnpm --filter @workspace/focusquest dev`, then open `http://localhost:5173/kingdoms/terrain.png` and `/kingdoms/buildings.png` in the browser. Both must render.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/public/kingdoms artifacts/focusquest/src/lib/kingdom-sprites.ts
git commit -m "feat(art): vendor LPC Revised kingdom tilesets with credits"
```

---

### Task 8: Pure scene resolution

**Files:**
- Create: `artifacts/focusquest/src/lib/kingdom-scene.ts`
- Test: `artifacts/focusquest/src/lib/kingdom-scene.test.ts`

**Interfaces:**
- Consumes (all already exist, built in Task 7): `SPRITES`, `LANTERN_ID`, `TILE`, `spriteSize` from `./kingdom-sprites`
- Produces: `Liveliness` (declared locally — the frontend must not import server modules), `SceneLayer { spriteId: string; x: number; y: number; alpha?: number }`, `KingdomSceneSpec`, `KINGDOM_SCENES`, `SCENE_W`, `SCENE_H`, `resolveScene(kingdomId, tier, liveliness): SceneLayer[]`

**Sprite ids that actually exist — verified against the built catalog. Do not invent others:**
- Ground: `ground.grass`, `ground.dirt`, `ground.cobble`, `ground.sand`, `ground.water`
- Props: `prop.tree`, `prop.bush`, `prop.pine`, `prop.boulder`, `prop.boulder-pale`, `prop.stump`
- Buildings: `build.{shape}-{variant}`, shape ∈ `hut|house|hall|tower|keep`, variant ∈ `stone|gold|slate|brown|dark|brick` (e.g. `build.house-brown`). **Sizes differ per shape — always read them via `spriteSize(id)`, never hardcode.**
- Overlay: `LANTERN_ID` (the string `"overlay.lantern"`)

- [ ] **Step 1: Write the failing test**

```typescript
// artifacts/focusquest/src/lib/kingdom-scene.test.ts
import { describe, it, expect } from "vitest";
import { resolveScene, KINGDOM_SCENES, SCENE_W, SCENE_H } from "./kingdom-scene";
import { SPRITES, LANTERN_ID } from "./kingdom-sprites";

const LIVELINESS = ["dormant", "stirring", "steady", "bustling"] as const;
const builds = (ls: { spriteId: string }[]) => ls.filter((l) => l.spriteId.startsWith("build."));
const lanterns = (ls: { spriteId: string }[]) => ls.filter((l) => l.spriteId === LANTERN_ID);

describe("resolveScene", () => {
  it("defines a scene for all six kingdoms", () => {
    expect(Object.keys(KINGDOM_SCENES).sort()).toEqual(
      ["athenaeum", "capital", "crossroads", "forge", "hearth", "wellspring"],
    );
  });

  it("renders ground and props but no buildings at tier 0", () => {
    const layers = resolveScene("forge", 0, "steady");
    expect(layers.length).toBeGreaterThan(0);
    expect(builds(layers)).toHaveLength(0);
  });

  it("adds buildings as the tier climbs, never removing them", () => {
    let previous = 0;
    for (let tier = 0; tier <= 5; tier++) {
      const count = builds(resolveScene("hearth", tier, "steady")).length;
      expect(count).toBeGreaterThanOrEqual(previous);
      previous = count;
    }
    expect(previous).toBeGreaterThan(0);
  });

  it("keeps every earned building when dormant - quiet, never ruined", () => {
    const busy = builds(resolveScene("hearth", 4, "bustling")).map((l) => l.spriteId).sort();
    const quiet = builds(resolveScene("hearth", 4, "dormant")).map((l) => l.spriteId).sort();
    expect(quiet).toEqual(busy);
  });

  it("dims rather than damages when dormant", () => {
    const quiet = resolveScene("hearth", 4, "dormant");
    expect(quiet.some((l) => (l.alpha ?? 1) < 1)).toBe(true);
    expect(quiet.every((l) => !/ruin|rubble|broken|burn/.test(l.spriteId))).toBe(true);
  });

  it("keeps one light burning even when dormant", () => {
    // A fully dark village reads as abandoned; one lit lamp reads as a place
    // waiting for you. This is the asleep-vs-dead line.
    const lit = lanterns(resolveScene("hearth", 4, "dormant"));
    expect(lit).toHaveLength(1);
    expect(lit[0]!.alpha).toBe(1);
  });

  it("lights more windows as liveliness rises", () => {
    const count = (l: (typeof LIVELINESS)[number]) => lanterns(resolveScene("hearth", 5, l)).length;
    expect(count("dormant")).toBeLessThan(count("steady"));
    expect(count("steady")).toBeLessThan(count("bustling"));
  });

  it("shows no lanterns at tier 0 - nothing built to light", () => {
    expect(lanterns(resolveScene("hearth", 0, "bustling"))).toHaveLength(0);
  });

  it("resolves every sprite it references", () => {
    for (const id of Object.keys(KINGDOM_SCENES)) {
      for (let tier = 0; tier <= 5; tier++) {
        for (const liveliness of LIVELINESS) {
          for (const layer of resolveScene(id, tier, liveliness)) {
            expect(SPRITES[layer.spriteId], `missing sprite ${layer.spriteId}`).toBeDefined();
          }
        }
      }
    }
  });

  it("is deterministic", () => {
    expect(resolveScene("crossroads", 3, "steady")).toEqual(resolveScene("crossroads", 3, "steady"));
  });

  it("returns nothing for an unknown kingdom", () => {
    expect(resolveScene("atlantis", 3, "steady")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/focusquest test -- kingdom-scene`
Expected: FAIL — `Failed to resolve import "./kingdom-scene"`

- [ ] **Step 3: Write minimal implementation**

```typescript
// artifacts/focusquest/src/lib/kingdom-scene.ts
// Pure, renderer-agnostic scene resolution: (kingdom, tier, liveliness) -> a
// declarative display list. Knows nothing about canvas, React, or the DOM, so a
// future PixiJS renderer can consume the same output unchanged.
import { TILE, LANTERN_ID, spriteSize } from "./kingdom-sprites";

// Declared here rather than imported from the server: the frontend must not
// depend on api-server modules.
export type Liveliness = "dormant" | "stirring" | "steady" | "bustling";

export type SceneLayer = { spriteId: string; x: number; y: number; alpha?: number };

export type KingdomSceneSpec = {
  /** Repeating ground tile id. */
  ground: string;
  /** Scenery drawn at every tier, in draw order. */
  props: { spriteId: string; x: number; y: number }[];
  /** Buildings revealed in tier order — tier N shows the first N. */
  buildingSlots: { shape: string; x: number; y: number }[];
  /** Which composited colour variant this kingdom's buildings use. */
  variant: string;
};

export const SCENE_W = 320;
export const SCENE_H = 176;

/**
 * Buildings are anchored by their BOTTOM-CENTRE, because the composited sprites
 * have different heights per shape — anchoring by top-left would leave taller
 * buildings floating above the ground line.
 */
function anchor(shape: string, variant: string, x: number, y: number): SceneLayer | null {
  const id = `build.${shape}-${variant}`;
  const size = spriteSize(id);
  if (!size) return null;
  return { spriteId: id, x: Math.round(x - size.w / 2), y: Math.round(y - size.h) };
}

export const KINGDOM_SCENES: Record<string, KingdomSceneSpec> = {
  hearth: {
    ground: "ground.grass",
    variant: "brown",
    props: [
      { spriteId: "prop.tree", x: 4, y: 24 },
      { spriteId: "prop.bush", x: 232, y: 96 },
    ],
    buildingSlots: [
      { shape: "hut",   x: 76,  y: 168 },
      { shape: "house", x: 176, y: 156 },
      { shape: "hut",   x: 262, y: 172 },
      { shape: "hall",  x: 128, y: 176 },
      { shape: "tower", x: 292, y: 150 },
    ],
  },
  wellspring: {
    ground: "ground.water",
    variant: "stone",
    props: [
      { spriteId: "prop.bush", x: 0, y: 92 },
      { spriteId: "prop.tree", x: 220, y: 16 },
    ],
    buildingSlots: [
      { shape: "hut",   x: 64,  y: 166 },
      { shape: "house", x: 160, y: 152 },
      { shape: "hall",  x: 250, y: 170 },
      { shape: "tower", x: 108, y: 140 },
      { shape: "keep",  x: 196, y: 176 },
    ],
  },
  forge: {
    ground: "ground.cobble",
    variant: "slate",
    props: [
      { spriteId: "prop.boulder", x: 8, y: 128 },
      { spriteId: "prop.boulder-pale", x: 248, y: 40 },
    ],
    buildingSlots: [
      { shape: "hut",   x: 68,  y: 170 },
      { shape: "tower", x: 148, y: 148 },
      { shape: "hall",  x: 236, y: 168 },
      { shape: "keep",  x: 108, y: 176 },
      { shape: "tower", x: 292, y: 152 },
    ],
  },
  athenaeum: {
    ground: "ground.grass",
    variant: "gold",
    props: [
      { spriteId: "prop.pine", x: 0, y: 20 },
      { spriteId: "prop.tree", x: 216, y: 8 },
      { spriteId: "prop.bush", x: 116, y: 100 },
    ],
    buildingSlots: [
      { shape: "hut",   x: 80,  y: 168 },
      { shape: "house", x: 168, y: 154 },
      { shape: "hall",  x: 246, y: 172 },
      { shape: "tower", x: 120, y: 142 },
      { shape: "keep",  x: 200, y: 176 },
    ],
  },
  crossroads: {
    ground: "ground.dirt",
    variant: "brick",
    props: [
      { spriteId: "prop.stump", x: 24, y: 132 },
      { spriteId: "prop.bush", x: 212, y: 100 },
    ],
    buildingSlots: [
      { shape: "hut",   x: 72,  y: 170 },
      { shape: "house", x: 184, y: 152 },
      { shape: "hall",  x: 264, y: 174 },
      { shape: "tower", x: 40,  y: 146 },
      { shape: "keep",  x: 148, y: 176 },
    ],
  },
  capital: {
    ground: "ground.cobble",
    variant: "stone",
    props: [
      { spriteId: "prop.bush", x: 8, y: 100 },
      { spriteId: "prop.tree", x: 240, y: 12 },
    ],
    buildingSlots: [
      { shape: "house", x: 88,  y: 164 },
      { shape: "hall",  x: 176, y: 156 },
      { shape: "tower", x: 44,  y: 144 },
      { shape: "keep",  x: 238, y: 176 },
      { shape: "hut",   x: 292, y: 170 },
    ],
  },
};

/** Dormant dims the scene toward night. It NEVER swaps in damaged art — the
 *  anti-shame grammar is "asleep", not "ruined". */
const ALPHA_BY_LIVELINESS: Record<Liveliness, number> = {
  dormant: 0.55,
  stirring: 0.75,
  steady: 0.9,
  bustling: 1,
};

/**
 * How many buildings show a lit window. A dormant kingdom deliberately keeps ONE
 * light on — "someone left a lamp burning" reads as a place waiting for you,
 * where a fully dark village reads as abandoned. That single lantern is the
 * difference between asleep and dead, so do not optimise it away.
 */
function lanternCount(liveliness: Liveliness, revealed: number): number {
  if (revealed === 0) return 0;
  switch (liveliness) {
    case "dormant":  return 1;
    case "stirring": return Math.max(1, Math.ceil(revealed * 0.34));
    case "steady":   return Math.max(1, Math.ceil(revealed * 0.67));
    case "bustling": return revealed;
  }
}

export function resolveScene(kingdomId: string, tier: number, liveliness: Liveliness): SceneLayer[] {
  const spec = KINGDOM_SCENES[kingdomId];
  if (!spec) return [];

  const alpha = ALPHA_BY_LIVELINESS[liveliness];
  const layers: SceneLayer[] = [];

  // Ground fill.
  for (let y = 0; y < SCENE_H; y += TILE) {
    for (let x = 0; x < SCENE_W; x += TILE) {
      layers.push({ spriteId: spec.ground, x, y, alpha });
    }
  }

  for (const p of spec.props) layers.push({ ...p, alpha });

  // Tier N reveals the first N slots; earned buildings are never withdrawn.
  const revealed = Math.max(0, Math.min(tier, spec.buildingSlots.length));
  const placed: SceneLayer[] = [];
  for (let i = 0; i < revealed; i++) {
    const slot = spec.buildingSlots[i]!;
    const layer = anchor(slot.shape, spec.variant, slot.x, slot.y);
    if (layer) placed.push(layer);
  }
  // Painter's order: buildings further back drawn first so nearer ones overlap.
  placed.sort((a, b) => a.y - b.y);
  for (const p of placed) layers.push({ ...p, alpha });

  // Liveliness overlay: lit windows, drawn at full opacity so the light reads
  // against a dimmed scene.
  const count = lanternCount(liveliness, placed.length);
  for (let i = 0; i < count; i++) {
    const b = placed[i]!;
    const size = spriteSize(b.spriteId)!;
    layers.push({
      spriteId: LANTERN_ID,
      x: b.x + Math.round(size.w / 2) - 12,
      y: b.y + size.h - 30,
      alpha: 1,
    });
  }

  return layers;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/focusquest test -- kingdom-scene`
Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/lib/kingdom-scene.ts artifacts/focusquest/src/lib/kingdom-scene.test.ts
git commit -m "feat(ui): pure kingdom scene resolution"
```

---

### Task 9: The canvas renderer (the swappable seam)

**Files:**
- Create: `artifacts/focusquest/src/components/kingdom-scene.tsx`

**Interfaces:**
- Consumes: `resolveScene`, `SCENE_W`, `SCENE_H`, `Liveliness` from `@/lib/kingdom-scene` (Task 8); `SPRITES`, `TERRAIN_URL` from `@/lib/kingdom-sprites` (Task 7)
- Produces: `<KingdomScene kingdomId tier liveliness width? className? />`

**The sprite catalog has three kinds, and the renderer must handle each:**
- `{ kind: "terrain", sx, sy, w, h }` — a source rect into the single terrain sheet at `TERRAIN_URL`
- `{ kind: "image", url, w, h }` — a standalone composited building PNG
- `{ kind: "glow", w, h, rgb }` — a painted primitive with no art behind it (the lit window). Fill a rounded warm rect; do not try to load an image for it.

- [ ] **Step 1: Write the component**

```tsx
// artifacts/focusquest/src/components/kingdom-scene.tsx
import { useEffect, useRef } from "react";
import { resolveScene, SCENE_W, SCENE_H, type Liveliness } from "@/lib/kingdom-scene";
import { SPRITES, TERRAIN_URL } from "@/lib/kingdom-sprites";

// THE RENDERER SEAM. Everything above this component speaks only in SceneLayer[]
// (see lib/kingdom-scene.ts), so swapping canvas for PixiJS later means
// reimplementing this file alone. Do not let scene logic leak in here.

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
    imageCache.set(url, p);
  }
  return p;
}

export function KingdomScene({
  kingdomId, tier, liveliness, width = SCENE_W, className,
}: {
  kingdomId: string;
  tier: number;
  liveliness: Liveliness;
  width?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cancelled = false;

    (async () => {
      const layers = resolveScene(kingdomId, tier, liveliness);

      // Collect every distinct image URL this scene needs.
      const urls = new Set<string>();
      for (const layer of layers) {
        const sprite = SPRITES[layer.spriteId];
        if (!sprite) continue;
        if (sprite.kind === "terrain") urls.add(TERRAIN_URL);
        else if (sprite.kind === "image") urls.add(sprite.url);
      }

      // allSettled so one missing asset cannot blank the whole scene — the same
      // resilience rule PixelHero uses for hero layers.
      const list = [...urls];
      const results = await Promise.allSettled(list.map(loadImage));
      if (cancelled) return;

      const images = new Map<string, HTMLImageElement>();
      list.forEach((url, i) => {
        const r = results[i];
        if (r?.status === "fulfilled") images.set(url, r.value);
      });

      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, SCENE_W, SCENE_H);

      for (const layer of layers) {
        const sprite = SPRITES[layer.spriteId];
        if (!sprite) continue;
        ctx.globalAlpha = layer.alpha ?? 1;

        if (sprite.kind === "glow") {
          const [r, g, b] = sprite.rgb;
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.fillRect(layer.x, layer.y, sprite.w, sprite.h);
          continue;
        }

        const url = sprite.kind === "terrain" ? TERRAIN_URL : sprite.url;
        const img = images.get(url);
        if (!img) continue;

        if (sprite.kind === "terrain") {
          ctx.drawImage(img, sprite.sx, sprite.sy, sprite.w, sprite.h, layer.x, layer.y, sprite.w, sprite.h);
        } else {
          ctx.drawImage(img, layer.x, layer.y, sprite.w, sprite.h);
        }
      }
      ctx.globalAlpha = 1;
    })();

    return () => { cancelled = true; };
  }, [kingdomId, tier, liveliness]);

  return (
    <canvas
      ref={ref}
      width={SCENE_W}
      height={SCENE_H}
      className={className}
      style={{ width, height: (width * SCENE_H) / SCENE_W, imageRendering: "pixelated" }}
      role="img"
      aria-label={`${kingdomId} kingdom, tier ${tier}, ${liveliness}`}
    />
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add artifacts/focusquest/src/components/kingdom-scene.tsx
git commit -m "feat(ui): canvas kingdom renderer behind a swappable seam"
```

---

### Task 10: Dashboard strip

**Files:**
- Create: `artifacts/focusquest/src/components/kingdom-strip.tsx`
- Modify: `artifacts/focusquest/src/pages/dashboard.tsx`

**Interfaces:**
- Consumes: `useGetKingdoms()` from Task 6, `KingdomScene` from Task 9
- Produces: `<KingdomStrip />`

This strip is the actual instrument — `/insights` is `mobileShow: false` and therefore two taps deep on mobile.

- [ ] **Step 1: Write the component**

```tsx
// artifacts/focusquest/src/components/kingdom-strip.tsx
import { Link } from "wouter";
import { useGetKingdoms } from "@workspace/api-client-react";
import type { Liveliness } from "@/lib/kingdom-scene";

const LIVELINESS_DOT: Record<string, string> = {
  dormant:  "bg-muted-foreground/30",
  stirring: "bg-amber-400/50",
  steady:   "bg-amber-400",
  bustling: "bg-green-400",
};

/**
 * Compact five-kingdom liveliness readout. Excludes the capital, which grows but
 * carries no balance meaning. Copy is invitational, never corrective.
 */
export function KingdomStrip() {
  const { data } = useGetKingdoms();
  if (!data) return null;

  const kingdoms = data.kingdoms.filter((k) => !k.isCapital);

  return (
    <Link href="/insights" className="block rounded-lg border border-border p-3 hover:bg-muted/20 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Your kingdoms</span>
        <span className="text-[10px] text-muted-foreground/70">View map →</span>
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {kingdoms.map((k) => (
          <div key={k.id} className="flex flex-col items-center gap-1">
            <span className={`h-1.5 w-full rounded-full ${LIVELINESS_DOT[k.liveliness] ?? LIVELINESS_DOT.dormant}`} />
            <span className="text-[10px] text-muted-foreground truncate w-full text-center">{k.name}</span>
          </div>
        ))}
      </div>

      {data.worldResting ? (
        <p className="mt-2 text-xs text-muted-foreground italic">Your world is resting. It's all still here.</p>
      ) : data.invitation ? (
        <p className="mt-2 text-xs text-primary">{data.invitation.kingdomName} has been quiet lately.</p>
      ) : null}
    </Link>
  );
}
```

- [ ] **Step 2: Mount on the dashboard**

In `artifacts/focusquest/src/pages/dashboard.tsx`, add the import with the other component imports:

```tsx
import { KingdomStrip } from "@/components/kingdom-strip";
```

Render `<KingdomStrip />` **below** the momentum card. The momentum card answers "what do I do right now" and must stay the first thing the eye lands on; kingdoms are ambient awareness and must not compete with it.

- [ ] **Step 3: Verify in the browser**

Start the dev server via the preview tool, then confirm: the strip renders five kingdoms, the copy is invitational rather than corrective, and tapping it navigates to `/insights`. Check the console for errors.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/components/kingdom-strip.tsx artifacts/focusquest/src/pages/dashboard.tsx
git commit -m "feat(ui): kingdom liveliness strip on the dashboard"
```

---

### Task 11: Full map on insights

**Files:**
- Create: `artifacts/focusquest/src/components/kingdom-map.tsx`
- Modify: `artifacts/focusquest/src/pages/insights.tsx`

**Interfaces:**
- Consumes: `useGetKingdoms()` from Task 6, `KingdomScene` from Task 9
- Produces: `<KingdomMap />`

- [ ] **Step 1: Write the component**

```tsx
// artifacts/focusquest/src/components/kingdom-map.tsx
import { useGetKingdoms } from "@workspace/api-client-react";
import { KingdomScene } from "@/components/kingdom-scene";
import type { Liveliness } from "@/lib/kingdom-scene";

/**
 * The full map. Sits directly above the category breakdown on /insights so the
 * two read as the same data — the map is the felt version, the breakdown the
 * precise one.
 */
export function KingdomMap() {
  const { data } = useGetKingdoms();
  if (!data) return null;

  const kingdoms = data.kingdoms.filter((k) => !k.isCapital);
  const capital = data.kingdoms.find((k) => k.isCapital);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Your kingdoms</h2>
        <p className="text-xs text-muted-foreground">
          {data.worldResting
            ? "Your world is resting. Every place you've built is still standing."
            : "Each life area grows as you work in it. Quiet places are just sleeping."}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {kingdoms.map((k) => (
          <div key={k.id} className="rounded-lg border border-border overflow-hidden">
            <KingdomScene
              kingdomId={k.id}
              tier={k.tier}
              liveliness={(data.worldResting ? "stirring" : k.liveliness) as Liveliness}
              width={320}
              className="w-full block"
            />
            <div className="p-2 flex items-baseline justify-between">
              <span className="text-sm font-medium">{k.name}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{k.tierName}</span>
            </div>
          </div>
        ))}
      </div>

      {capital && capital.tier > 0 && (
        <p className="text-[10px] text-muted-foreground/70">
          Your capital is a {capital.tierName.toLowerCase()}, built from everything that didn't fit a category.
        </p>
      )}

      {!data.worldResting && data.invitation && (
        <p className="text-xs text-primary">
          {data.invitation.kingdomName} has been quiet lately — it's still there whenever you want to head back.
        </p>
      )}
    </section>
  );
}
```

**Note the `worldResting` override:** when the world is resting, every scene renders at `stirring` rather than `dormant`. Five simultaneously darkened scenes is exactly the "returned after two weeks to a dead landscape" experience the spec forbids — one warm sleeping world, not five verdicts.

- [ ] **Step 2: Mount on insights**

In `artifacts/focusquest/src/pages/insights.tsx`, add the import:

```tsx
import { KingdomMap } from "@/components/kingdom-map";
```

Render `<KingdomMap />` **directly above** the existing category-breakdown section.

- [ ] **Step 3: Verify in the browser**

Confirm five scenes render with visible art, tier names read correctly, the map sits directly above the category breakdown, and no console errors. Check mobile width via the preview tool's resize.

- [ ] **Step 4: Full test suite and typecheck**

Run: `pnpm --filter @workspace/focusquest test`
Run: `pnpm --filter @workspace/api-server test`
Run: `pnpm typecheck`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/components/kingdom-map.tsx artifacts/focusquest/src/pages/insights.tsx
git commit -m "feat(ui): full kingdom map above the insights category breakdown"
```

---

## Anti-shame verification checklist

Confirm before opening the PR. Each maps to a spec invariant.

- [ ] Kingdom points never decrease — `/uncomplete` and delete contain no `kingdomPointsTable` write (Task 5, Step 6)
- [ ] No liveliness state renders damaged art; `dormant` only dims and keeps one lantern lit (Task 8 tests)
- [ ] Neglect invitation never fires below `WORLD_RESTING_THRESHOLD` (Task 3 test)
- [ ] Map renders one warm resting world under global absence, never five verdicts (Task 11 override)
- [ ] Capital excluded from liveliness denominator and neglect detection (Tasks 2–3 tests)
- [ ] Growth uses base `task.points`, unaffected by XP/perk multipliers (Task 5 test)
- [ ] All user-facing copy is invitational, never corrective — no "you should", no "you failed to", no red states

## Deferred (explicitly not in this plan)

Pannable world · animation · per-kingdom questline integration · kingdom-gated cosmetics · PixiJS. The renderer seam and declarative scene description keep all of these cheap later.

Two items the spec mentions that are deliberately **not** implemented here, so their absence is a decision rather than an oversight:

- **Hero sprite as street figures.** The spec suggested reusing the customized hero as figures in the streets. It needs the hero look plus LPC character sheets wired into the kingdom renderer — a cross-system dependency worth its own increment. Liveliness is fully expressed by dimming plus lit windows without it.
- **Seasonal terrain.** Only the summer sheet is vendored (Task 7). Spec invariant 7 — *seasons must never encode neglect* — is therefore vacuously satisfied. If seasons are added later they must track the real calendar uniformly across all kingdoms, never activity.
