# World Boss (Co-op Raid) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared weekly World Boss that the whole server chips down with once-per-day attacks; when the community fells it, every contributor shares a coin+XP reward.

**Architecture:** A server-wide `world_boss_weeks` row (lazily created per ISO week) holds a shared HP bar; each `world_boss_attacks` row is one user's daily hit (damage = their battle-power roll). Damage accumulates atomically; the attack that crosses HP claims the kill (`defeatedAt IS NULL … RETURNING`) and pays every contributor exactly once — all inside one transaction. Pure logic lives in a tested `src/lib/world-boss.ts`; the route stays thin. The existing solo weekly boss is untouched.

**Tech Stack:** TypeScript, Express 5, Drizzle ORM (Postgres/Neon), Vitest, OpenAPI + orval codegen (react-query hooks + zod), React 19 + framer-motion (focusquest web app).

## Global Constraints

- **Anti-shame law (non-negotiable):** participation XP is granted on every attack regardless of outcome; a never-felled boss yields no punishment and no error wall; the daily attack is an opportunity never an obligation; allyless players participate fully; the defeat reward is **flat** for every contributor (dealt ≥1 damage that week), never contribution-scaled.
- **Async / free-tier only:** request/response, no realtime, no new cron. Weekly rollover is implicit by `weekKey`.
- **Coins flow only through `awardCoins(tx, userId, amount, reason)`** so `balance == sum(coin_transactions.amount)` holds. New ledger reason: `"world_boss_defeat"`.
- **Concurrency discipline (mirror the hardened solo boss):** `unique(userId, dayKey)` insert-as-dedup for attacks; atomic `totalDamage` increment; single-winner defeat claim via `defeatedAt IS NULL … RETURNING`.
- **Tunable consts (starting values):** `HP_BASE = 1500`, `HP_STEP = 300`, `HP_CAP = 5000`, `ATTACK_XP = 15`, `DEFEAT_COINS = 50`, `DEFEAT_XP = 250`.
- **Package manager is pnpm.** Codegen: `cd lib/api-spec && pnpm codegen`. API tests: `cd artifacts/api-server && pnpm test`. DB push: `cd lib/db && pnpm push` (requires `DATABASE_URL`).
- **Follow existing patterns:** pure logic in `src/lib/*.ts` with vitest; routes thin and not unit-tested; commit frequently.

## File Structure

- `lib/db/src/schema/world-boss.ts` — **create** — two tables: `worldBossWeeksTable`, `worldBossAttacksTable`.
- `lib/db/src/schema/index.ts` — **modify** — export the new schema module.
- `lib/db/src/schema/coin-transactions.ts` — **modify** — add `"world_boss_defeat"` to `CoinReason`.
- `artifacts/api-server/src/lib/week-key.ts` — **create** — extract `getWeekKey` (shared by solo + co-op).
- `artifacts/api-server/src/lib/week-key.test.ts` — **create** — unit tests for `getWeekKey`.
- `artifacts/api-server/src/routes/battle.ts` — **modify** — import `getWeekKey` from the new util; `export` `getUserPower` for reuse.
- `artifacts/api-server/src/lib/world-boss.ts` — **create** — consts + pure helpers (`worldBossHp`, `dayKey`, `rollDamage`, `crossedThreshold`).
- `artifacts/api-server/src/lib/world-boss.test.ts` — **create** — unit tests for the pure helpers.
- `lib/api-spec/openapi.yaml` — **modify** — add `/world-boss/current`, `/world-boss/attack`, and 3 schemas.
- `lib/api-client-react/src/generated/**`, `lib/api-zod/src/generated/**` — **regenerated** by codegen (do not hand-edit).
- `artifacts/api-server/src/routes/world-boss.ts` — **create** — GET/POST route.
- `artifacts/api-server/src/routes/index.ts` — **modify** — mount the world-boss router.
- `artifacts/focusquest/src/components/world-boss-panel.tsx` — **create** — the World Boss card.
- `artifacts/focusquest/src/pages/avatar.tsx` — **modify** — render `<WorldBossPanel />` alongside `<BattlePanel />`.

---

### Task 1: DB schema — world_boss tables + coin reason

**Files:**
- Create: `lib/db/src/schema/world-boss.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `lib/db/src/schema/coin-transactions.ts:5-12`

**Interfaces:**
- Produces: `worldBossWeeksTable`, `worldBossAttacksTable`, types `WorldBossWeek`, `WorldBossAttack`; `CoinReason` now includes `"world_boss_defeat"`.

- [ ] **Step 1: Create the schema module**

Create `lib/db/src/schema/world-boss.ts`:

```ts
import { pgTable, serial, text, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// One shared boss per ISO week for the whole server. Created lazily on the first
// view/attack of a new week. `unique(weekKey)` makes lazy creation an atomic
// onConflictDoNothing insert.
export const worldBossWeeksTable = pgTable("world_boss_weeks", {
  id:          serial("id").primaryKey(),
  weekKey:     text("week_key").notNull().unique(), // e.g. "2026-W29"
  hp:          integer("hp").notNull(),             // snapshotted from the HP curve at creation
  totalDamage: integer("total_damage").notNull().default(0),
  defeatedAt:  timestamp("defeated_at"),            // null until felled
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

// One row per user per day: a single daily attack. `unique(userId, dayKey)` is the
// atomic once-per-day dedup — the insert IS the dedup (mirrors weekly_battles).
export const worldBossAttacksTable = pgTable("world_boss_attacks", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  weekKey:   text("week_key").notNull(),  // denormalized for cheap per-week aggregation
  dayKey:    text("day_key").notNull(),   // "YYYY-MM-DD" (UTC) — the dedup key
  damage:    integer("damage").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  unique("world_boss_attacks_user_day_unique").on(t.userId, t.dayKey),
]);

export type WorldBossWeek = typeof worldBossWeeksTable.$inferSelect;
export type WorldBossAttack = typeof worldBossAttacksTable.$inferSelect;
```

- [ ] **Step 2: Export the module**

In `lib/db/src/schema/index.ts`, append:

```ts
export * from "./world-boss";
```

- [ ] **Step 3: Add the coin reason**

In `lib/db/src/schema/coin-transactions.ts`, add `"world_boss_defeat"` to the `CoinReason` union:

```ts
export type CoinReason =
  | "quest_complete"
  | "focus_session"
  | "streak_milestone"
  | "questline_complete"
  | "boss_win"
  | "redeem"
  | "quest_uncomplete"
  | "world_boss_defeat";
```

- [ ] **Step 4: Typecheck the libs**

Run: `pnpm run typecheck:libs`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add lib/db/src/schema/world-boss.ts lib/db/src/schema/index.ts lib/db/src/schema/coin-transactions.ts
git commit -m "feat(db): world_boss_weeks + world_boss_attacks tables, world_boss_defeat coin reason"
```

---

### Task 2: Extract shared ISO week-key util (+ tests)

Extract `getWeekKey` out of `battle.ts` into a tested util so the solo boss and the World Boss agree on week boundaries. Behavior is unchanged — pure move + test.

**Files:**
- Create: `artifacts/api-server/src/lib/week-key.ts`
- Create: `artifacts/api-server/src/lib/week-key.test.ts`
- Modify: `artifacts/api-server/src/routes/battle.ts:14-20` (remove local `getWeekKey`, import it)

**Interfaces:**
- Produces: `getWeekKey(date?: Date): string` → ISO week key like `"2026-W29"`.
- Consumes (in battle.ts): replaces the previously-local `getWeekKey`.

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/week-key.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getWeekKey } from "./week-key";

describe("getWeekKey", () => {
  it("formats as YYYY-Www with a zero-padded week number", () => {
    // 2026-01-01 is a Thursday → ISO week 1 of 2026.
    expect(getWeekKey(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-W01");
  });

  it("returns the same key for every day within one ISO week", () => {
    const mon = getWeekKey(new Date(Date.UTC(2026, 6, 13))); // Mon 2026-07-13
    const sun = getWeekKey(new Date(Date.UTC(2026, 6, 19))); // Sun 2026-07-19
    expect(mon).toBe(sun);
    expect(mon).toBe("2026-W29");
  });

  it("rolls to the next key across the week boundary", () => {
    const sun = getWeekKey(new Date(Date.UTC(2026, 6, 19))); // Sun 2026-07-19
    const mon = getWeekKey(new Date(Date.UTC(2026, 6, 20))); // Mon 2026-07-20
    expect(sun).toBe("2026-W29");
    expect(mon).toBe("2026-W30");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd artifacts/api-server && pnpm exec vitest run src/lib/week-key.test.ts`
Expected: FAIL — cannot find module `./week-key`.

- [ ] **Step 3: Create the util (copy the exact logic from battle.ts)**

Create `artifacts/api-server/src/lib/week-key.ts`:

```ts
// ISO-8601 week key, e.g. "2026-W29". Shared by the solo weekly boss and the
// co-op World Boss so both agree on week boundaries.
export function getWeekKey(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd artifacts/api-server && pnpm exec vitest run src/lib/week-key.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Update battle.ts to use the shared util**

In `artifacts/api-server/src/routes/battle.ts`: delete the local `getWeekKey` function (the `function getWeekKey(...) { ... }` block) and add an import at the top with the other imports:

```ts
import { getWeekKey } from "../lib/week-key";
```

- [ ] **Step 6: Verify the whole api suite still passes**

Run: `cd artifacts/api-server && pnpm test`
Expected: PASS (all existing tests green, including the new week-key tests).

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/lib/week-key.ts artifacts/api-server/src/lib/week-key.test.ts artifacts/api-server/src/routes/battle.ts
git commit -m "refactor(api): extract getWeekKey to shared tested util"
```

---

### Task 3: World Boss pure logic + consts (+ tests)

The TDD core. Everything decision-shaped and testable lives here; the route just wires it.

**Files:**
- Create: `artifacts/api-server/src/lib/world-boss.ts`
- Create: `artifacts/api-server/src/lib/world-boss.test.ts`

**Interfaces:**
- Produces:
  - `WORLD_BOSS` const: `{ HP_BASE: 1500, HP_STEP: 300, HP_CAP: 5000, ATTACK_XP: 15, DEFEAT_COINS: 50, DEFEAT_XP: 250 }`
  - `worldBossHp(weekKey: string): number`
  - `dayKey(date?: Date): string` → `"YYYY-MM-DD"` (UTC)
  - `rollDamage(power: number, rng?: () => number): number`
  - `crossedThreshold(prevTotal: number, newTotal: number, hp: number): boolean`

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/lib/world-boss.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { WORLD_BOSS, worldBossHp, dayKey, rollDamage, crossedThreshold } from "./world-boss";

describe("WORLD_BOSS consts", () => {
  it("exposes the tunable economy knobs", () => {
    expect(WORLD_BOSS.HP_BASE).toBe(1500);
    expect(WORLD_BOSS.HP_STEP).toBe(300);
    expect(WORLD_BOSS.HP_CAP).toBe(5000);
    expect(WORLD_BOSS.ATTACK_XP).toBe(15);
    expect(WORLD_BOSS.DEFEAT_COINS).toBe(50);
    expect(WORLD_BOSS.DEFEAT_XP).toBe(250);
  });
});

describe("worldBossHp", () => {
  it("is HP_BASE in week 1 and escalates by HP_STEP per week", () => {
    expect(worldBossHp("2026-W01")).toBe(1500);
    expect(worldBossHp("2026-W02")).toBe(1800);
    expect(worldBossHp("2026-W10")).toBe(1500 + 9 * 300); // 4200
  });
  it("clamps at HP_CAP", () => {
    expect(worldBossHp("2026-W52")).toBe(5000);
  });
  it("falls back to base when the week number can't be parsed", () => {
    expect(worldBossHp("garbage")).toBe(1500);
  });
});

describe("dayKey", () => {
  it("formats the UTC date as YYYY-MM-DD", () => {
    expect(dayKey(new Date(Date.UTC(2026, 6, 5, 23, 59)))).toBe("2026-07-05");
    expect(dayKey(new Date(Date.UTC(2026, 11, 31, 0, 0)))).toBe("2026-12-31");
  });
});

describe("rollDamage", () => {
  it("is 75% of power at the low roll and 125% at the high roll", () => {
    expect(rollDamage(200, () => 0)).toBe(150);   // 200 * 0.75
    expect(rollDamage(200, () => 1)).toBe(250);   // 200 * 1.25
  });
  it("rounds to an integer", () => {
    expect(rollDamage(101, () => 0.5)).toBe(Math.round(101)); // 101 * 1.0
  });
  it("never returns negative for zero power", () => {
    expect(rollDamage(0, () => 0)).toBe(0);
  });
});

describe("crossedThreshold", () => {
  it("true only when this attack takes the total from below hp to >= hp", () => {
    expect(crossedThreshold(1400, 1550, 1500)).toBe(true);
    expect(crossedThreshold(1500, 1600, 1500)).toBe(false); // already at/over before
    expect(crossedThreshold(1000, 1400, 1500)).toBe(false); // still short
    expect(crossedThreshold(1499, 1500, 1500)).toBe(true);  // exact landing
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd artifacts/api-server && pnpm exec vitest run src/lib/world-boss.test.ts`
Expected: FAIL — cannot find module `./world-boss`.

- [ ] **Step 3: Implement the pure helpers**

Create `artifacts/api-server/src/lib/world-boss.ts`:

```ts
// Tunable economy knobs for the co-op World Boss. HP is the primary balance knob;
// tune to real turnout. See docs/superpowers/specs/2026-07-15-world-boss-coop-design.md.
export const WORLD_BOSS = {
  HP_BASE: 1500,
  HP_STEP: 300,
  HP_CAP: 5000,
  ATTACK_XP: 15,     // participation XP per daily attack (always earned)
  DEFEAT_COINS: 50,  // flat, to every contributor, when the boss is felled
  DEFEAT_XP: 250,    // flat, to every contributor, when the boss is felled
} as const;

// Shared HP for a given ISO week: escalates gently by week number, clamped.
export function worldBossHp(weekKey: string): number {
  const match = weekKey.match(/W(\d+)$/);
  const weekNo = match ? parseInt(match[1], 10) : 1;
  return Math.min(WORLD_BOSS.HP_BASE + (weekNo - 1) * WORLD_BOSS.HP_STEP, WORLD_BOSS.HP_CAP);
}

// UTC calendar day, "YYYY-MM-DD" — the once-per-day dedup key.
export function dayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

// Damage for one attack: 75%–125% of battle power. RNG injected for tests.
export function rollDamage(power: number, rng: () => number = Math.random): number {
  return Math.round(power * (0.75 + rng() * 0.5));
}

// Did THIS attack land the felling blow? (crossed from below hp to >= hp)
export function crossedThreshold(prevTotal: number, newTotal: number, hp: number): boolean {
  return prevTotal < hp && newTotal >= hp;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd artifacts/api-server && pnpm exec vitest run src/lib/world-boss.test.ts`
Expected: PASS (all groups).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/world-boss.ts artifacts/api-server/src/lib/world-boss.test.ts
git commit -m "feat(api): World Boss pure logic — HP curve, damage roll, defeat threshold"
```

---

### Task 4: OpenAPI contract + codegen

Add the two endpoints and their schemas to the hand-written spec, then regenerate the react-query hooks and zod types.

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (add paths after the `/battle/enter` block ~line 1730; add schemas after `BattleResult` ~line 3269)
- Regenerated: `lib/api-client-react/src/generated/**`, `lib/api-zod/src/generated/**`

**Interfaces:**
- Produces (generated hooks/keys): `useGetWorldBossCurrent`, `useAttackWorldBoss`, `getGetWorldBossCurrentQueryKey`.
- Produces (response contract): `WorldBossStatus`, `WorldBossAttackResult`, `WorldBossContributor`.

- [ ] **Step 1: Add the paths**

In `lib/api-spec/openapi.yaml`, directly after the `/battle/enter` path block (before the next `/…:` path), add:

```yaml
  /world-boss/current:
    get:
      operationId: getWorldBossCurrent
      tags: [avatar]
      summary: Get this week's shared World Boss status
      responses:
        "200":
          description: World Boss status for the current viewer
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/WorldBossStatus"

  /world-boss/attack:
    post:
      operationId: attackWorldBoss
      tags: [avatar]
      summary: Deal this day's attack to the shared World Boss
      responses:
        "200":
          description: Attack outcome (may be a soft no-op if already attacked today or already felled)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/WorldBossAttackResult"
```

- [ ] **Step 2: Add the schemas**

In `lib/api-spec/openapi.yaml`, directly after the `BattleResult` schema block (before `DopamineReward`), add:

```yaml
    WorldBossContributor:
      type: object
      required: [userId, displayName, avatarColor, damage, isAlly]
      properties:
        userId: { type: integer }
        displayName: { type: string }
        avatarColor: { type: string }
        damage: { type: integer }
        isAlly: { type: boolean }

    WorldBossStatus:
      type: object
      required:
        [weekKey, hp, totalDamage, defeated, attackedToday, yourContribution, yourPower, attackXp, defeatCoins, defeatXp, contributors]
      properties:
        weekKey: { type: string }
        hp: { type: integer }
        totalDamage: { type: integer }
        defeated: { type: boolean }
        defeatedAt: { type: ["string", "null"] }
        attackedToday: { type: boolean }
        yourContribution: { type: integer }
        yourPower: { type: integer }
        attackXp: { type: integer }
        defeatCoins: { type: integer }
        defeatXp: { type: integer }
        contributors:
          type: array
          items:
            $ref: "#/components/schemas/WorldBossContributor"

    WorldBossAttackResult:
      type: object
      required: [attacked, hp, totalDamage, defeated, justDefeated, xpAwarded, coinsAwarded]
      properties:
        attacked: { type: boolean }
        reason:
          type: ["string", "null"]
          enum: [already_today, defeated, null]
        damage: { type: ["integer", "null"] }
        hp: { type: integer }
        totalDamage: { type: integer }
        defeated: { type: boolean }
        justDefeated: { type: boolean }
        xpAwarded: { type: integer }
        coinsAwarded: { type: integer }
```

- [ ] **Step 3: Run codegen**

Run: `cd lib/api-spec && pnpm codegen`
Expected: orval regenerates split files under both `lib/api-client-react/src/generated` and `lib/api-zod/src/generated`, then `typecheck:libs` passes. Confirm the hook exists:

Run: `grep -r "useGetWorldBossCurrent" lib/api-client-react/src/generated | head -1`
Expected: a match (the generated hook).

- [ ] **Step 4: Commit (spec + regenerated clients together)**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "feat(api-spec): world-boss current/attack contract, regen client/zod"
```

---

### Task 5: World Boss route + mount

Implement the two endpoints. Reuse `getUserPower` from `battle.ts` (export it) and the pure helpers from Task 3. No route unit test (matches repo convention); correctness is guarded by the pure-logic tests and typecheck, and the transaction mirrors the proven solo-boss pattern.

**Files:**
- Modify: `artifacts/api-server/src/routes/battle.ts:28` (export `getUserPower`)
- Create: `artifacts/api-server/src/routes/world-boss.ts`
- Modify: `artifacts/api-server/src/routes/index.ts` (import + mount)

**Interfaces:**
- Consumes: `getUserPower(userId): Promise<number>` (from battle.ts), `getWeekKey` (week-key.ts), `WORLD_BOSS`, `worldBossHp`, `dayKey`, `rollDamage`, `crossedThreshold` (world-boss.ts), `awardCoins` (award-coins.ts), `getLevelInfo` (gamification).

- [ ] **Step 1: Export `getUserPower` from battle.ts**

In `artifacts/api-server/src/routes/battle.ts`, change the declaration:

```ts
async function getUserPower(userId: number): Promise<number> {
```

to:

```ts
export async function getUserPower(userId: number): Promise<number> {
```

- [ ] **Step 2: Create the route**

Create `artifacts/api-server/src/routes/world-boss.ts`:

```ts
import { Router, type IRouter } from "express";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import {
  db, usersTable, partnershipsTable, activityTable,
  worldBossWeeksTable, worldBossAttacksTable,
} from "@workspace/db";
import { getLevelInfo } from "../lib/gamification";
import { getWeekKey } from "../lib/week-key";
import { getUserPower } from "./battle";
import { WORLD_BOSS, worldBossHp, dayKey, rollDamage, crossedThreshold } from "../lib/world-boss";
import { awardCoins } from "../lib/award-coins";

const router: IRouter = Router();

// Lazily materialize this week's boss row and return it. The unique(weekKey)
// constraint makes the insert an atomic no-op if another request already created it.
async function ensureBossWeek(weekKey: string) {
  await db.insert(worldBossWeeksTable)
    .values({ weekKey, hp: worldBossHp(weekKey) })
    .onConflictDoNothing();
  const [boss] = await db.select().from(worldBossWeeksTable)
    .where(eq(worldBossWeeksTable.weekKey, weekKey));
  return boss!;
}

// Set of the viewer's accepted-ally user ids.
async function allyIds(userId: number): Promise<Set<number>> {
  const rows = await db.select().from(partnershipsTable)
    .where(and(
      eq(partnershipsTable.status, "accepted"),
      sql`(${partnershipsTable.requesterId} = ${userId} OR ${partnershipsTable.recipientId} = ${userId})`,
    ));
  const ids = new Set<number>();
  for (const p of rows) ids.add(p.requesterId === userId ? p.recipientId : p.requesterId);
  return ids;
}

router.get("/world-boss/current", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const weekKey = getWeekKey();
  const today = dayKey();
  const boss = await ensureBossWeek(weekKey);
  const yourPower = await getUserPower(userId);
  const allies = await allyIds(userId);

  // Per-user damage totals for the week, with display fields.
  const rows = await db
    .select({
      userId: worldBossAttacksTable.userId,
      damage: sql<number>`sum(${worldBossAttacksTable.damage})`.mapWith(Number),
      displayName: usersTable.displayName,
      username: usersTable.username,
      avatarColor: usersTable.avatarColor,
    })
    .from(worldBossAttacksTable)
    .innerJoin(usersTable, eq(usersTable.id, worldBossAttacksTable.userId))
    .where(eq(worldBossAttacksTable.weekKey, weekKey))
    .groupBy(worldBossAttacksTable.userId, usersTable.displayName, usersTable.username, usersTable.avatarColor)
    .orderBy(desc(sql`sum(${worldBossAttacksTable.damage})`));

  const contributors = rows.map((r) => ({
    userId: r.userId,
    displayName: r.displayName ?? r.username,
    avatarColor: r.avatarColor,
    damage: r.damage,
    isAlly: allies.has(r.userId),
  }));

  const [mine] = await db
    .select({ total: sql<number>`coalesce(sum(${worldBossAttacksTable.damage}), 0)`.mapWith(Number) })
    .from(worldBossAttacksTable)
    .where(and(eq(worldBossAttacksTable.userId, userId), eq(worldBossAttacksTable.weekKey, weekKey)));

  const [todayRow] = await db.select().from(worldBossAttacksTable)
    .where(and(eq(worldBossAttacksTable.userId, userId), eq(worldBossAttacksTable.dayKey, today)));

  res.json({
    weekKey,
    hp: boss.hp,
    totalDamage: boss.totalDamage,
    defeated: boss.defeatedAt !== null,
    defeatedAt: boss.defeatedAt ? boss.defeatedAt.toISOString() : null,
    attackedToday: !!todayRow,
    yourContribution: mine?.total ?? 0,
    yourPower,
    attackXp: WORLD_BOSS.ATTACK_XP,
    defeatCoins: WORLD_BOSS.DEFEAT_COINS,
    defeatXp: WORLD_BOSS.DEFEAT_XP,
    contributors,
  });
});

router.post("/world-boss/attack", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const weekKey = getWeekKey();
  const today = dayKey();
  await ensureBossWeek(weekKey);
  const power = await getUserPower(userId);
  const damage = rollDamage(power);

  type Outcome =
    | { kind: "already_today" }
    | { kind: "defeated_already" }
    | { kind: "ok"; totalDamage: number; hp: number; justDefeated: boolean; coinsAwarded: number };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const [boss] = await tx.select().from(worldBossWeeksTable)
      .where(eq(worldBossWeeksTable.weekKey, weekKey));
    if (boss!.defeatedAt !== null) return { kind: "defeated_already" };

    // Atomic once-per-day dedup: the insert IS the guard.
    const [attack] = await tx.insert(worldBossAttacksTable)
      .values({ userId, weekKey, dayKey: today, damage })
      .onConflictDoNothing()
      .returning();
    if (!attack) return { kind: "already_today" };

    // Accumulate shared damage atomically; RETURNING gives the post-increment total.
    const [bumped] = await tx.update(worldBossWeeksTable)
      .set({ totalDamage: sql`${worldBossWeeksTable.totalDamage} + ${damage}` })
      .where(eq(worldBossWeeksTable.weekKey, weekKey))
      .returning();
    const newTotal = bumped!.totalDamage;

    // Participation XP for the attacker — always earned (anti-shame floor).
    const [attacker] = await tx.select().from(usersTable).where(eq(usersTable.id, userId));
    const aPoints = attacker!.totalPoints + WORLD_BOSS.ATTACK_XP;
    await tx.update(usersTable).set({
      totalPoints: aPoints,
      weeklyPoints: attacker!.weeklyPoints + WORLD_BOSS.ATTACK_XP,
      currentLevel: getLevelInfo(aPoints).level,
    }).where(eq(usersTable.id, userId));
    await tx.insert(activityTable).values({
      userId,
      type: "task_completed",
      description: `World Boss: dealt ${damage} damage.`,
      points: WORLD_BOSS.ATTACK_XP,
    });

    // Did this attack fell the boss? Claim the kill exactly once.
    let justDefeated = false;
    let coinsAwarded = 0;
    if (crossedThreshold(newTotal - damage, newTotal, boss!.hp)) {
      const [claimed] = await tx.update(worldBossWeeksTable)
        .set({ defeatedAt: new Date() })
        .where(and(eq(worldBossWeeksTable.weekKey, weekKey), sql`${worldBossWeeksTable.defeatedAt} IS NULL`))
        .returning();
      if (claimed) {
        justDefeated = true;
        coinsAwarded = WORLD_BOSS.DEFEAT_COINS;
        // Flat reward to EVERY contributor (dealt >= 1 damage this week).
        const contribRows = await tx.selectDistinct({ userId: worldBossAttacksTable.userId })
          .from(worldBossAttacksTable)
          .where(eq(worldBossAttacksTable.weekKey, weekKey));
        const contribIds = contribRows.map((r) => r.userId);
        const contributors = await tx.select().from(usersTable)
          .where(inArray(usersTable.id, contribIds));
        for (const c of contributors) {
          const cPoints = c.totalPoints + WORLD_BOSS.DEFEAT_XP;
          await tx.update(usersTable).set({
            totalPoints: cPoints,
            weeklyPoints: c.weeklyPoints + WORLD_BOSS.DEFEAT_XP,
            currentLevel: getLevelInfo(cPoints).level,
          }).where(eq(usersTable.id, c.id));
          await awardCoins(tx, c.id, WORLD_BOSS.DEFEAT_COINS, "world_boss_defeat");
          await tx.insert(activityTable).values({
            userId: c.id,
            type: "task_completed",
            description: `World Boss felled! +${WORLD_BOSS.DEFEAT_COINS} coins, +${WORLD_BOSS.DEFEAT_XP} XP.`,
            points: WORLD_BOSS.DEFEAT_XP,
          });
        }
      }
    }

    return { kind: "ok", totalDamage: newTotal, hp: boss!.hp, justDefeated, coinsAwarded };
  });

  if (outcome.kind === "already_today") {
    res.json({ attacked: false, reason: "already_today", damage: null, hp: 0, totalDamage: 0, defeated: false, justDefeated: false, xpAwarded: 0, coinsAwarded: 0 });
    return;
  }
  if (outcome.kind === "defeated_already") {
    res.json({ attacked: false, reason: "defeated", damage: null, hp: 0, totalDamage: 0, defeated: true, justDefeated: false, xpAwarded: 0, coinsAwarded: 0 });
    return;
  }
  res.json({
    attacked: true,
    reason: null,
    damage,
    hp: outcome.hp,
    totalDamage: outcome.totalDamage,
    defeated: outcome.totalDamage >= outcome.hp,
    justDefeated: outcome.justDefeated,
    xpAwarded: WORLD_BOSS.ATTACK_XP,
    coinsAwarded: outcome.coinsAwarded,
  });
});

export default router;
```

- [ ] **Step 3: Mount the router**

In `artifacts/api-server/src/routes/index.ts`: add the import next to the other route imports:

```ts
import worldBossRouter from "./world-boss";
```

and add the mount after `router.use(battleRouter);`:

```ts
router.use(worldBossRouter);
```

- [ ] **Step 4: Typecheck + full test suite**

Run: `cd artifacts/api-server && pnpm run typecheck && pnpm test`
Expected: PASS — typecheck clean, all existing tests still green.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/world-boss.ts artifacts/api-server/src/routes/index.ts artifacts/api-server/src/routes/battle.ts
git commit -m "feat(api): World Boss current/attack routes — shared HP, atomic defeat payout"
```

---

### Task 6: Push schema to Neon

The two new tables are additive. Push them to the shared Neon DB. (Per project practice, the human/driver runs the live push; see the shared-live-db discipline — coordinate if another branch's schema is live-but-unmerged.)

**Files:** none (live DB operation).

- [ ] **Step 1: Push**

Run (from repo root, with `DATABASE_URL` loaded into the environment):

```bash
cd lib/db && pnpm push
```

Expected: drizzle-kit reports creating `world_boss_weeks` and `world_boss_attacks` (and the two unique constraints), no changes to existing tables.

- [ ] **Step 2: Sanity-check the tables exist**

Confirm via drizzle output (or a `\d world_boss_weeks` in a psql session) that both tables and the `world_boss_attacks_user_day_unique` constraint are present. No commit (schema DDL was committed in Task 1).

---

### Task 7: Web UI — World Boss card

Add a `WorldBossPanel` card and render it alongside `BattlePanel` on the avatar page. Mirror `BattlePanel`'s conventions (Card, `useToast`, `useQueryClient`, framer-motion, `PowerBar`). Refresh the coin balance when an attack fells the boss.

**Files:**
- Create: `artifacts/focusquest/src/components/world-boss-panel.tsx`
- Modify: `artifacts/focusquest/src/pages/avatar.tsx` (render `<WorldBossPanel />`)

**Interfaces:**
- Consumes (generated): `useGetWorldBossCurrent`, `useAttackWorldBoss`, `getGetWorldBossCurrentQueryKey`, `getGetCoinsQueryKey`.

- [ ] **Step 1: Inspect the reference markup**

Read `artifacts/focusquest/src/pages/avatar.tsx` lines ~300–465 (the `BattlePanel` and `PowerBar` components) to match Card imports, `useToast`, and the exact `PowerBar`/motion usage. Confirm the coins query-key helper name by:

Run: `grep -rn "getGetCoinsQueryKey" artifacts/focusquest/src | head -1`
Expected: the generated helper name to import (adjust in Step 2 if it differs).

- [ ] **Step 2: Create the component**

Create `artifacts/focusquest/src/components/world-boss-panel.tsx`:

```tsx
import { useState } from "react";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Swords, Users, Coins } from "lucide-react";
import {
  useGetWorldBossCurrent,
  useAttackWorldBoss,
  getGetWorldBossCurrentQueryKey,
  getGetCoinsQueryKey,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export function WorldBossPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: boss, isLoading } = useGetWorldBossCurrent();
  const attack = useAttackWorldBoss();
  const [rolled, setRolled] = useState<number | null>(null);

  if (isLoading || !boss) return null;

  const pct = boss.hp > 0 ? Math.min(100, Math.round((boss.totalDamage / boss.hp) * 100)) : 0;
  const canAttack = !boss.defeated && !boss.attackedToday && !attack.isPending;

  async function onAttack() {
    try {
      const res = await attack.mutateAsync();
      if (!res.attacked) {
        toast({
          title: res.reason === "defeated" ? "Already felled 🎉" : "Attack ready tomorrow",
          description: res.reason === "defeated"
            ? "The World Boss is down for this week."
            : "You've already struck today — come back tomorrow.",
        });
      } else {
        setRolled(res.damage ?? 0);
        if (res.justDefeated) {
          toast({ title: "World Boss felled! 🎉", description: `+${res.coinsAwarded} coins & bonus XP to every raider!` });
          qc.invalidateQueries({ queryKey: getGetCoinsQueryKey() });
        } else {
          toast({ title: `Hit for ${res.damage}!`, description: `+${boss.attackXp} XP for joining the raid.` });
        }
      }
      await qc.invalidateQueries({ queryKey: getGetWorldBossCurrentQueryKey() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      toast({ title: "Raid error", description: msg, variant: "destructive" });
    }
  }

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Swords className="w-5 h-5 text-red-400" />
          <div>
            <h3 className="font-bold text-lg">World Boss</h3>
            <p className="text-sm text-muted-foreground">{boss.weekKey} · everyone vs. one boss</p>
          </div>
        </div>
        {boss.defeated && <span className="text-sm font-bold text-primary">Defeated 🎉</span>}
      </div>

      {/* Shared HP bar */}
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-muted-foreground">{pct}% felled this week</span>
          <span className="font-medium">{boss.totalDamage.toLocaleString()} / {boss.hp.toLocaleString()}</span>
        </div>
        <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-red-400"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
          />
        </div>
      </div>

      {rolled !== null && !boss.defeated && (
        <p className="text-sm text-center text-muted-foreground">
          You dealt <span className="font-bold text-foreground">{rolled}</span> damage!
        </p>
      )}

      <Button className="w-full" disabled={!canAttack} onClick={onAttack}>
        {boss.defeated ? "Boss defeated" : boss.attackedToday ? "Attack ready tomorrow" : attack.isPending ? "Attacking…" : `Attack (power ${boss.yourPower})`}
      </Button>

      {/* Raid party */}
      <div className="space-y-1">
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Users className="w-4 h-4" /> Raid party
        </div>
        {boss.contributors.length === 0 && (
          <p className="text-xs text-muted-foreground">Be the first to strike this week!</p>
        )}
        {boss.contributors.map((c) => (
          <div key={c.userId} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: c.avatarColor }} />
              {c.displayName}
              {c.isAlly && <span className="text-xs text-primary">· ally</span>}
            </span>
            <span className="font-medium">{c.damage.toLocaleString()}</span>
          </div>
        ))}
      </div>

      <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
        <Coins className="w-3 h-3" /> Fell it together for +{boss.defeatCoins} coins &amp; +{boss.defeatXp} XP each
      </p>
    </Card>
  );
}
```

> Note: if Step 1 shows different local aliases (e.g. the coins key helper is exported under another name, or `Card`/`Button`/`useToast` live at different import paths than the `@/…` aliases used in `avatar.tsx`), match whatever `avatar.tsx` already imports.

- [ ] **Step 3: Render it on the avatar page**

In `artifacts/focusquest/src/pages/avatar.tsx`, import the panel near the top:

```tsx
import { WorldBossPanel } from "@/components/world-boss-panel";
```

and render `<WorldBossPanel />` immediately before or after `<BattlePanel />` in the page's JSX (wherever `BattlePanel` is rendered).

- [ ] **Step 4: Typecheck + web tests**

Run: `cd artifacts/focusquest && pnpm run typecheck && pnpm test`
Expected: PASS — typecheck clean, existing web tests green.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/components/world-boss-panel.tsx artifacts/focusquest/src/pages/avatar.tsx
git commit -m "feat(web): World Boss card — shared HP bar, attack, raid party"
```

---

### Task 8: Full verification + PR

**Files:** none (verification + integration).

- [ ] **Step 1: Whole-repo typecheck**

Run: `pnpm run typecheck`
Expected: PASS across libs and artifacts.

- [ ] **Step 2: Run api + web test suites**

Run: `cd artifacts/api-server && pnpm test` then `cd artifacts/focusquest && pnpm test`
Expected: PASS. Confirm the new `week-key` and `world-boss` suites are included and green.

- [ ] **Step 3: Manual smoke to the auth wall**

Start the api-server and focusquest dev servers; confirm the app builds and the avatar page renders without console errors up to the Auth0 login wall. (Full authed earn→attack→defeat drive is the human's, since Auth0 login is off-limits to the agent — same constraint as the coins feature.)

- [ ] **Step 4: Open the PR**

Push the branch and open a PR titled `feat: World Boss (co-op raid) — Act IV`, summarizing: shared weekly world boss, daily chip-away attacks, atomic single-winner defeat payout to all contributors, anti-shame participation floor, solo boss untouched. Link the spec and this plan.

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1), daily dedup + shared HP + synchronous atomic defeat payout (Task 5), pure HP/damage/threshold logic + tests (Task 3), shared week-key (Task 2), contract + hooks (Task 4), UI with HP bar/attack/raid party + coin refresh (Task 7), anti-shame participation floor (Task 5 participation XP), live push (Task 6), verification (Task 8). All spec sections map to a task.
- **Anti-shame:** participation XP is unconditional in the attack tx; soft `attacked:false` responses (never 4xx) for already-attacked/defeated; flat contributor reward. Covered.
- **Type consistency:** `getWeekKey`, `getUserPower`, `WORLD_BOSS`, `worldBossHp`, `dayKey`, `rollDamage`, `crossedThreshold` names are used identically across tasks; generated hook names (`useGetWorldBossCurrent`, `useAttackWorldBoss`, `getGetWorldBossCurrentQueryKey`) follow orval's operationId convention from Task 4.
- **Out of scope (per spec):** named guilds, participant-scaled HP, contribution-scaled rewards, cron nudges/push-on-defeat, nudge-ally-to-attack, overkill/phases — none included.
