# Right-Sized Fellowship (Act VII q6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the social surfaces honest at small scale: the leaderboard defaults to a "You vs. last week" self-comparison, and the World Boss's weekly HP scales with the prior week's active-contributor count instead of an ever-escalating week-number curve.

**Architecture:** Two independent halves sharing one PR. (a) API: `worldBossHp` becomes a pure function of prior-week cohort size (`count(distinct userId)` on `world_boss_attacks` for the prior ISO week), snapshotted onto the week row exactly as today — attack flow, anti-shame floor, and exactly-once payout untouched. (b) API+web: a new authenticated `GET /leaderboard/my-week` computes three tz-aware windows (week-to-date, same-point-last-week, last-week-total) from a new pure `comparisonWindows` core reusing `previousLocalWeek`/`localDayStartUtc`; the leaderboard page gets a default "My Week" tab rendering the comparison with celebration-only pace framing, demoting the global list to an "Everyone" tab and dropping the "Global Rankings" copy.

**Tech Stack:** Express + drizzle (Neon PG), hand-authored `lib/api-spec/openapi.yaml` → orval codegen (`@workspace/api-client-react` hooks + `@workspace/api-zod`), React 19 + wouter + shadcn Tabs, vitest in both packages.

## Global Constraints

- **Anti-Shame Design law (act-wide, binding):** no deficit framing anywhere. The self-comparison shows a pace chip ONLY when ahead; behind/level renders plain numbers — no red, no down-arrows, no "behind" wording.
- **Act VII rule:** no new game features — this is copy, defaults, correctness, and scaling only. No new mechanics/currencies/content.
- **Boss invariants (PR #46, must survive):** attack-XP always earned (anti-shame floor); exactly-once defeat payout via the `defeatedAt IS NULL` claim; HP snapshotted on the week row at materialization; once-per-day attack dedup via unique(userId, dayKey).
- **No schema changes.** Zero migrations; the shared-Neon branch rules aren't in play.
- **Shared working tree:** verify `git branch --show-current` is `feat/right-sized-fellowship` before every commit.
- **Copy grammar:** quests/XP/coins vocabulary; "Global Rankings" must not survive; population-honest naming ("Fellowship").
- **Boss weeks are UTC ISO weeks** (`getWeekKey`/`dayKey`); **personal weeks are the user's local Mon-anchored weeks** (`previousLocalWeek`) — same accepted mismatch as the recap system (see `loadWeekStatsInputs` doc comment).

## File Structure

```
artifacts/api-server/src/lib/world-boss.ts          # MODIFY: cohort-based worldBossHp; consts change
artifacts/api-server/src/lib/world-boss.test.ts     # MODIFY: new formula tests
artifacts/api-server/src/lib/week-key.ts            # MODIFY: add priorWeekKey
artifacts/api-server/src/lib/week-key.test.ts       # CREATE: getWeekKey + priorWeekKey tests
artifacts/api-server/src/routes/world-boss.ts       # MODIFY: ensureBossWeek counts prior cohort
artifacts/api-server/src/lib/self-week.ts           # CREATE: comparisonWindows pure core
artifacts/api-server/src/lib/self-week.test.ts      # CREATE: window tests (tz, DST, boundaries)
artifacts/api-server/src/routes/leaderboard.ts      # MODIFY: add GET /leaderboard/my-week
lib/api-spec/openapi.yaml                           # MODIFY: path + MyWeekMetric/MyWeekComparison
lib/api-client-react, lib/api-zod                   # REGENERATE via codegen (no hand edits)
artifacts/focusquest/src/lib/my-week.ts             # CREATE: paceDelta/isFreshStart pure helpers
artifacts/focusquest/src/lib/my-week.test.ts        # CREATE: anti-shame chip tests
artifacts/focusquest/src/pages/leaderboard.tsx      # MODIFY: My Week default tab + copy
artifacts/focusquest/src/components/world-boss-panel.tsx  # MODIFY: one copy line
scripts/src/reseed-world-boss-week.ts               # CREATE: one-shot live-week resize (post-merge op)
```

---

### Task 1: Cohort-based `worldBossHp` + `priorWeekKey` (pure cores)

**Files:**
- Modify: `artifacts/api-server/src/lib/world-boss.ts`
- Modify: `artifacts/api-server/src/lib/world-boss.test.ts`
- Modify: `artifacts/api-server/src/lib/week-key.ts`
- Create: `artifacts/api-server/src/lib/week-key.test.ts`

**Interfaces:**
- Consumes: `getWeekKey(date?: Date): string` (existing).
- Produces: `worldBossHp(priorContributors: number): number`; `WORLD_BOSS` const with `HP_PER_CONTRIBUTOR: 300`, `HP_MIN: 300` (and unchanged `ATTACK_XP/DEFEAT_COINS/DEFEAT_XP`; `HP_BASE/HP_STEP/HP_CAP` deleted); `priorWeekKey(now?: Date): string`.

**Calibration (why 300):** battle power is `30 + level*5 + gearPower` and one daily attack deals `power × [0.75, 1.25]`. A modest member (~power 70) attacking 4–5 of 7 days covers ~300 damage — so HP of `300 × N` means a cohort wins by showing up more than half the week, solo (floor 300) included. Linear with no cap: per-person effort stays constant at any population, so a 300-person week (90,000 HP) is real but not trivial.

- [ ] **Step 1: Rewrite the failing tests**

Replace the `WORLD_BOSS consts` and `worldBossHp` describe blocks in `artifacts/api-server/src/lib/world-boss.test.ts` (keep `dayKey`, `rollDamage`, `crossedThreshold` blocks untouched):

```ts
describe("WORLD_BOSS consts", () => {
  it("exposes the tunable economy knobs", () => {
    expect(WORLD_BOSS.HP_PER_CONTRIBUTOR).toBe(300);
    expect(WORLD_BOSS.HP_MIN).toBe(300);
    expect(WORLD_BOSS.ATTACK_XP).toBe(15);
    expect(WORLD_BOSS.DEFEAT_COINS).toBe(50);
    expect(WORLD_BOSS.DEFEAT_XP).toBe(250);
  });
});

describe("worldBossHp", () => {
  it("scales linearly with prior-week active contributors", () => {
    expect(worldBossHp(1)).toBe(300);
    expect(worldBossHp(3)).toBe(900);
    expect(worldBossHp(10)).toBe(3000);
  });
  it("has no cap: big cohorts get proportionally big bosses", () => {
    expect(worldBossHp(17)).toBe(5100);  // above the old 5000 clamp
    expect(worldBossHp(300)).toBe(90000);
  });
  it("floors at HP_MIN so a quiet or first-ever week is solo-winnable", () => {
    expect(worldBossHp(0)).toBe(300);
  });
  it("sanitizes junk input to the floor", () => {
    expect(worldBossHp(-5)).toBe(300);
    expect(worldBossHp(Number.NaN)).toBe(300);
    expect(worldBossHp(2.9)).toBe(600); // fractional counts floor to ints
  });
});
```

Create `artifacts/api-server/src/lib/week-key.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getWeekKey, priorWeekKey } from "./week-key";

describe("getWeekKey", () => {
  it("formats ISO week keys", () => {
    expect(getWeekKey(new Date(Date.UTC(2026, 6, 21)))).toBe("2026-W30");
    expect(getWeekKey(new Date(Date.UTC(2026, 6, 20)))).toBe("2026-W30"); // Monday
    expect(getWeekKey(new Date(Date.UTC(2026, 6, 19)))).toBe("2026-W29"); // Sunday
  });
});

describe("priorWeekKey", () => {
  it("is the key of the week 7 days earlier", () => {
    expect(priorWeekKey(new Date(Date.UTC(2026, 6, 21)))).toBe("2026-W29");
    expect(priorWeekKey(new Date(Date.UTC(2026, 6, 20)))).toBe("2026-W29"); // Monday edge
  });
  it("crosses year boundaries without string arithmetic", () => {
    expect(priorWeekKey(new Date(Date.UTC(2026, 0, 1)))).toBe("2025-W52");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C artifacts/api-server test src/lib/world-boss.test.ts src/lib/week-key.test.ts`
Expected: FAIL — `HP_PER_CONTRIBUTOR` undefined; `priorWeekKey` not exported.

- [ ] **Step 3: Implement**

In `artifacts/api-server/src/lib/world-boss.ts`, replace the consts + `worldBossHp` (keep `dayKey`, `rollDamage`, `crossedThreshold`):

```ts
// Tunable economy knobs for the co-op World Boss. HP right-sizes to last
// week's turnout (Act VII q6); tune HP_PER_CONTRIBUTOR to real cadence.
// See docs/superpowers/specs/2026-07-15-world-boss-coop-design.md and the
// Act VII spec §Quest 6.
export const WORLD_BOSS = {
  HP_PER_CONTRIBUTOR: 300, // ≈ one member attacking 4–5 of 7 days at modest power
  HP_MIN: 300,             // 0- or 1-person prior week: still solo-winnable
  ATTACK_XP: 15,     // participation XP per daily attack (always earned)
  DEFEAT_COINS: 50,  // flat, to every contributor, when the boss is felled
  DEFEAT_XP: 250,    // flat, to every contributor, when the boss is felled
} as const;

// Shared HP for a week, sized by the PRIOR week's active contributors.
// Linear with no cap: per-person effort stays constant as the population
// grows, so a 3-person week is winnable and a 300-person week isn't trivial.
export function worldBossHp(priorContributors: number): number {
  const n = Number.isFinite(priorContributors) ? Math.max(0, Math.floor(priorContributors)) : 0;
  return Math.max(WORLD_BOSS.HP_MIN, n * WORLD_BOSS.HP_PER_CONTRIBUTOR);
}
```

In `artifacts/api-server/src/lib/week-key.ts`, append:

```ts
/** The ISO week key of 7 days before `now` — the World Boss's cohort-sizing
 * basis (prior week's active contributors). Date-based, so year boundaries
 * need no string arithmetic. */
export function priorWeekKey(now: Date = new Date()): string {
  return getWeekKey(new Date(now.getTime() - 7 * 86400000));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C artifacts/api-server test src/lib/world-boss.test.ts src/lib/week-key.test.ts`
Expected: PASS (note: `routes/world-boss.ts` still calls `worldBossHp(weekKey)` — typecheck breaks until Task 2, which is why Tasks 1+2 commit together only if needed; prefer fixing Task 2 before commit).

- [ ] **Step 5: Do NOT commit yet** — Task 2 restores typecheck; they ship as one commit.

### Task 2: `ensureBossWeek` sizes HP from the prior-week cohort

**Files:**
- Modify: `artifacts/api-server/src/routes/world-boss.ts`

**Interfaces:**
- Consumes: `worldBossHp(priorContributors)`, `priorWeekKey(now)` from Task 1.
- Produces: `ensureBossWeek(weekKey: string, priorKey: string)` — existing-row fast path unchanged for callers.

- [ ] **Step 1: Rewire ensureBossWeek**

Replace the `ensureBossWeek` function and its two call sites in `artifacts/api-server/src/routes/world-boss.ts`:

```ts
import { WORLD_BOSS, worldBossHp, dayKey, rollDamage, crossedThreshold } from "../lib/world-boss";
import { getWeekKey, priorWeekKey } from "../lib/week-key";

// Distinct attackers in `weekKey` — the cohort basis for HP sizing.
async function priorContributorCount(weekKey: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${worldBossAttacksTable.userId})`.mapWith(Number) })
    .from(worldBossAttacksTable)
    .where(eq(worldBossAttacksTable.weekKey, weekKey));
  return row?.n ?? 0;
}

// Lazily materialize this week's boss row and return it. HP is sized from the
// prior week's turnout at creation and snapshotted (mid-week population changes
// never move a live boss's HP). The unique(weekKey) constraint makes the insert
// an atomic no-op if another request already created it; racers computed the
// same prior-week count, so either winner wrote the same HP.
async function ensureBossWeek(weekKey: string, priorKey: string) {
  const [existing] = await db.select().from(worldBossWeeksTable)
    .where(eq(worldBossWeeksTable.weekKey, weekKey));
  if (existing) return existing;
  await db.insert(worldBossWeeksTable)
    .values({ weekKey, hp: worldBossHp(await priorContributorCount(priorKey)) })
    .onConflictDoNothing();
  const [boss] = await db.select().from(worldBossWeeksTable)
    .where(eq(worldBossWeeksTable.weekKey, weekKey));
  return boss!;
}
```

In `GET /world-boss/current`, change the prologue to:

```ts
  const now = new Date();
  const weekKey = getWeekKey(now);
  const today = dayKey(now);
  const boss = await ensureBossWeek(weekKey, priorWeekKey(now));
```

In `POST /world-boss/attack`, change the prologue to:

```ts
  const now = new Date();
  const weekKey = getWeekKey(now);
  const today = dayKey(now);
  await ensureBossWeek(weekKey, priorWeekKey(now));
```

- [ ] **Step 2: Typecheck + full API suite**

Run: `pnpm -C artifacts/api-server typecheck && pnpm -C artifacts/api-server test`
Expected: PASS, no remaining `worldBossHp(weekKey)` string-arg callers (grep to confirm: `grep -rn "worldBossHp(" artifacts/api-server/src`).

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/lib/world-boss.ts artifacts/api-server/src/lib/world-boss.test.ts artifacts/api-server/src/lib/week-key.ts artifacts/api-server/src/lib/week-key.test.ts artifacts/api-server/src/routes/world-boss.ts
git commit -m "feat(world-boss): HP scales with prior-week active contributors"
```

### Task 3: `comparisonWindows` pure core

**Files:**
- Create: `artifacts/api-server/src/lib/self-week.ts`
- Create: `artifacts/api-server/src/lib/self-week.test.ts`

**Interfaces:**
- Consumes: `previousLocalWeek(now, tz)` from `./weekly-recap`; `localDayStartUtc(dateKey, tz)` from `./date-buckets`.
- Produces: `comparisonWindows(now: Date, tz: string): ComparisonWindows` where `ComparisonWindows = { weekStartDateKey: string; current: Window; samePoint: Window; lastWeek: Window }` and `Window = { start: Date; end: Date }` ([start, end) half-open).

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/lib/self-week.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { comparisonWindows } from "./self-week";

describe("comparisonWindows", () => {
  it("splits a UTC user's timeline into week-to-date, same-point, and full last week", () => {
    // Wed 2026-07-22 15:30Z. This Monday: Jul 20. Prev Monday: Jul 13.
    const now = new Date(Date.UTC(2026, 6, 22, 15, 30));
    const w = comparisonWindows(now, "UTC");
    expect(w.weekStartDateKey).toBe("2026-07-20");
    expect(w.current.start.toISOString()).toBe("2026-07-20T00:00:00.000Z");
    expect(w.current.end.toISOString()).toBe(now.toISOString());
    expect(w.samePoint.start.toISOString()).toBe("2026-07-13T00:00:00.000Z");
    expect(w.samePoint.end.toISOString()).toBe("2026-07-15T15:30:00.000Z"); // same elapsed
    expect(w.lastWeek.start.toISOString()).toBe("2026-07-13T00:00:00.000Z");
    expect(w.lastWeek.end.toISOString()).toBe("2026-07-20T00:00:00.000Z");
  });

  it("anchors Mondays in the user's zone, not UTC", () => {
    // 2026-07-21 03:00Z is still Monday Jul 20, 22:00 in Chicago (CDT, UTC-5).
    const now = new Date(Date.UTC(2026, 6, 21, 3, 0));
    const w = comparisonWindows(now, "America/Chicago");
    expect(w.weekStartDateKey).toBe("2026-07-20");
    expect(w.current.start.toISOString()).toBe("2026-07-20T05:00:00.000Z"); // Mon 00:00 CDT
    expect(w.samePoint.start.toISOString()).toBe("2026-07-13T05:00:00.000Z");
    // elapsed = 22h → same-point cutoff lands Mon Jul 13, 22:00 CDT.
    expect(w.samePoint.end.toISOString()).toBe("2026-07-14T03:00:00.000Z");
  });

  it("keeps the closed week honest across a DST shift (spring forward)", () => {
    // US DST began Sun 2026-03-08. Thu Mar 12 18:00Z, Chicago:
    // prev Monday Mar 2 (CST, 06:00Z), this Monday Mar 9 (CDT, 05:00Z) — a 167h week.
    const now = new Date(Date.UTC(2026, 2, 12, 18, 0));
    const w = comparisonWindows(now, "America/Chicago");
    expect(w.lastWeek.start.toISOString()).toBe("2026-03-02T06:00:00.000Z");
    expect(w.lastWeek.end.toISOString()).toBe("2026-03-09T05:00:00.000Z");
    expect(w.current.start.toISOString()).toBe("2026-03-09T05:00:00.000Z");
  });

  it("yields a hair-thin same-point window on Monday morning", () => {
    // Monday 2026-07-20 00:05Z, UTC user: 5 minutes into the week.
    const now = new Date(Date.UTC(2026, 6, 20, 0, 5));
    const w = comparisonWindows(now, "UTC");
    expect(w.samePoint.start.toISOString()).toBe("2026-07-13T00:00:00.000Z");
    expect(w.samePoint.end.toISOString()).toBe("2026-07-13T00:05:00.000Z");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C artifacts/api-server test src/lib/self-week.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `artifacts/api-server/src/lib/self-week.ts`:

```ts
import { previousLocalWeek } from "./weekly-recap";
import { localDayStartUtc } from "./date-buckets";

export interface Window { start: Date; end: Date } // [start, end)

export interface ComparisonWindows {
  weekStartDateKey: string; // this local Monday, YYYY-MM-DD
  current: Window;   // this local Mon 00:00 → now
  samePoint: Window; // prev Mon 00:00 → prev Mon + elapsed-so-far
  lastWeek: Window;  // prev Mon 00:00 → this Mon 00:00 (the closed week)
}

/** The three honest windows for "You vs. last week": like-for-like pace
 * (same elapsed time into each week) plus the closed week's total. Elapsed
 * time mirrors in real milliseconds, so across a DST shift the same-point
 * cutoff can skew by ≤1h — the recap system's accepted grade of tz tradeoff.
 * previousLocalWeek's endDateKeyExclusive IS this week's Monday. */
export function comparisonWindows(now: Date, tz: string): ComparisonWindows {
  const week = previousLocalWeek(now, tz);
  const prevStart = localDayStartUtc(week.startDateKey, tz);
  const thisStart = localDayStartUtc(week.endDateKeyExclusive, tz);
  const elapsed = Math.max(0, now.getTime() - thisStart.getTime());
  const samePointEnd = new Date(Math.min(prevStart.getTime() + elapsed, thisStart.getTime()));
  return {
    weekStartDateKey: week.endDateKeyExclusive,
    current: { start: thisStart, end: now },
    samePoint: { start: prevStart, end: samePointEnd },
    lastWeek: { start: prevStart, end: thisStart },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C artifacts/api-server test src/lib/self-week.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/self-week.ts artifacts/api-server/src/lib/self-week.test.ts
git commit -m "feat(api): comparisonWindows core for You-vs-last-week"
```

### Task 4: `GET /leaderboard/my-week` + OpenAPI + codegen

**Files:**
- Modify: `artifacts/api-server/src/routes/leaderboard.ts`
- Modify: `lib/api-spec/openapi.yaml`
- Regenerate: `lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/*`

**Interfaces:**
- Consumes: `comparisonWindows` (Task 3), `resolveTimeZone` from `../lib/date-buckets`.
- Produces: JSON `{ timezone, weekStartDateKey, quests, xp, focusMinutes }` with each metric `{ current, samePointLastWeek, lastWeekTotal }` (all integers); generated hook `useGetMyWeek()` + type `MyWeekComparison`/`MyWeekMetric` in `@workspace/api-client-react`.

- [ ] **Step 1: Implement the route**

In `artifacts/api-server/src/routes/leaderboard.ts`, replace the import block and add the endpoint before `export default`:

```ts
import { Router, type IRouter } from "express";
import { desc, eq, and, gt, gte, lt, isNotNull, sql } from "drizzle-orm";
import { db, usersTable, tasksTable, activityTable, focusSessionsTable } from "@workspace/db";
import { getLevelInfo } from "../lib/gamification";
import { resolveTimeZone } from "../lib/date-buckets";
import { comparisonWindows, type Window } from "../lib/self-week";

// Windowed sums for the self-comparison. Same grammars as the recap loader:
// quests = completed tasks by completedAt; xp = positive activity points;
// focus = focused seconds (>0 filters opened-and-abandoned sessions).
async function totalsInWindow(userId: number, w: Window) {
  const [q] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(tasksTable)
    .where(and(
      eq(tasksTable.userId, userId), eq(tasksTable.completed, true),
      isNotNull(tasksTable.completedAt),
      gte(tasksTable.completedAt, w.start), lt(tasksTable.completedAt, w.end),
    ));
  const [x] = await db
    .select({ n: sql<number>`coalesce(sum(${activityTable.points}), 0)`.mapWith(Number) })
    .from(activityTable)
    .where(and(
      eq(activityTable.userId, userId), gt(activityTable.points, 0),
      gte(activityTable.createdAt, w.start), lt(activityTable.createdAt, w.end),
    ));
  const [f] = await db
    .select({ n: sql<number>`coalesce(sum(${focusSessionsTable.focusedSeconds}), 0)`.mapWith(Number) })
    .from(focusSessionsTable)
    .where(and(
      eq(focusSessionsTable.userId, userId), gt(focusSessionsTable.focusedSeconds, 0),
      gte(focusSessionsTable.startedAt, w.start), lt(focusSessionsTable.startedAt, w.end),
    ));
  return {
    quests: q?.n ?? 0,
    xp: x?.n ?? 0,
    focusMinutes: Math.round((f?.n ?? 0) / 60),
  };
}

router.get("/leaderboard/my-week", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const tz = resolveTimeZone(user?.timezone);
  const windows = comparisonWindows(new Date(), tz);

  const [current, samePoint, lastWeek] = await Promise.all([
    totalsInWindow(userId, windows.current),
    totalsInWindow(userId, windows.samePoint),
    totalsInWindow(userId, windows.lastWeek),
  ]);

  res.json({
    timezone: tz,
    weekStartDateKey: windows.weekStartDateKey,
    quests: { current: current.quests, samePointLastWeek: samePoint.quests, lastWeekTotal: lastWeek.quests },
    xp: { current: current.xp, samePointLastWeek: samePoint.xp, lastWeekTotal: lastWeek.xp },
    focusMinutes: { current: current.focusMinutes, samePointLastWeek: samePoint.focusMinutes, lastWeekTotal: lastWeek.focusMinutes },
  });
});
```

- [ ] **Step 2: OpenAPI path + schemas**

In `lib/api-spec/openapi.yaml`, directly after the `/leaderboard:` path block, add:

```yaml
  /leaderboard/my-week:
    get:
      operationId: getMyWeek
      tags: [leaderboard]
      summary: The viewer's week-so-far vs the same point last week
      responses:
        "200":
          description: Self-comparison over the viewer's local Monday-anchored weeks
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/MyWeekComparison"
```

Directly after the `LeaderboardEntry` schema, add:

```yaml
    MyWeekMetric:
      type: object
      required: [current, samePointLastWeek, lastWeekTotal]
      properties:
        current:
          type: integer
        samePointLastWeek:
          type: integer
        lastWeekTotal:
          type: integer

    MyWeekComparison:
      type: object
      required: [timezone, weekStartDateKey, quests, xp, focusMinutes]
      properties:
        timezone:
          type: string
        weekStartDateKey:
          type: string
        quests:
          $ref: "#/components/schemas/MyWeekMetric"
        xp:
          $ref: "#/components/schemas/MyWeekMetric"
        focusMinutes:
          $ref: "#/components/schemas/MyWeekMetric"
```

- [ ] **Step 3: Codegen + typecheck**

Run: `pnpm -C lib/api-spec codegen`
Expected: orval regenerates `api-client-react` + `api-zod`; the chained `typecheck:libs` passes. Confirm the hook exists: `grep -n "useGetMyWeek" lib/api-client-react/src/generated/api.ts`.

- [ ] **Step 4: API suite + typecheck**

Run: `pnpm -C artifacts/api-server typecheck && pnpm -C artifacts/api-server test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/leaderboard.ts lib/api-spec/openapi.yaml lib/api-client-react lib/api-zod
git commit -m "feat(api): GET /leaderboard/my-week self-comparison endpoint"
```

### Task 5: Web pure helpers — celebration-only pace framing

**Files:**
- Create: `artifacts/focusquest/src/lib/my-week.ts`
- Create: `artifacts/focusquest/src/lib/my-week.test.ts`

**Interfaces:**
- Consumes: `MyWeekMetric`, `MyWeekComparison` types from `@workspace/api-client-react` (Task 4 codegen).
- Produces: `paceDelta(metric: MyWeekMetric): number | null`; `isFreshStart(c: MyWeekComparison): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/focusquest/src/lib/my-week.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { paceDelta, isFreshStart } from "./my-week";
import type { MyWeekComparison } from "@workspace/api-client-react";

const metric = (current: number, samePointLastWeek: number, lastWeekTotal: number) =>
  ({ current, samePointLastWeek, lastWeekTotal });

const comparison = (over: Partial<MyWeekComparison> = {}): MyWeekComparison => ({
  timezone: "UTC",
  weekStartDateKey: "2026-07-20",
  quests: metric(0, 0, 0),
  xp: metric(0, 0, 0),
  focusMinutes: metric(0, 0, 0),
  ...over,
});

describe("paceDelta (anti-shame: celebration-only)", () => {
  it("returns the positive lead over last week's pace", () => {
    expect(paceDelta(metric(5, 2, 10))).toBe(3);
  });
  it("returns null when level — no zero-chip", () => {
    expect(paceDelta(metric(4, 4, 9))).toBeNull();
  });
  it("returns null when behind — never a deficit", () => {
    expect(paceDelta(metric(1, 6, 12))).toBeNull();
  });
  it("returns null on an all-zero metric", () => {
    expect(paceDelta(metric(0, 0, 0))).toBeNull();
  });
});

describe("isFreshStart", () => {
  it("is true only when every metric is zero in both weeks", () => {
    expect(isFreshStart(comparison())).toBe(true);
  });
  it("is false once anything happened this week", () => {
    expect(isFreshStart(comparison({ xp: metric(10, 0, 0) }))).toBe(false);
  });
  it("is false when last week had signal (returning user)", () => {
    expect(isFreshStart(comparison({ quests: metric(0, 0, 4) }))).toBe(false);
  });
  it("is false when only the same-point number is nonzero", () => {
    expect(isFreshStart(comparison({ focusMinutes: metric(0, 3, 0) }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C artifacts/focusquest test src/lib/my-week.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `artifacts/focusquest/src/lib/my-week.ts`:

```ts
import type { MyWeekComparison, MyWeekMetric } from "@workspace/api-client-react";

/** Celebration-only pace framing (anti-shame law): a delta exists only when
 * the user is AHEAD of their own last-week pace. Behind or level returns
 * null — the numbers stand without judgment, no red, no down-arrows. */
export function paceDelta(metric: MyWeekMetric): number | null {
  const delta = metric.current - metric.samePointLastWeek;
  return delta > 0 ? delta : null;
}

/** True when both weeks are all-zero: render the gentle fresh-start line
 * instead of three zero-vs-zero comparisons. */
export function isFreshStart(c: MyWeekComparison): boolean {
  const metrics = [c.quests, c.xp, c.focusMinutes];
  return metrics.every(
    (m) => m.current === 0 && m.samePointLastWeek === 0 && m.lastWeekTotal === 0,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C artifacts/focusquest test src/lib/my-week.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/lib/my-week.ts artifacts/focusquest/src/lib/my-week.test.ts
git commit -m "feat(web): my-week pace helpers (celebration-only framing)"
```

### Task 6: Leaderboard page — "My Week" default tab + population-honest copy

**Files:**
- Modify: `artifacts/focusquest/src/pages/leaderboard.tsx`
- Modify: `artifacts/focusquest/src/components/world-boss-panel.tsx` (one line)

**Interfaces:**
- Consumes: `useGetMyWeek()` hook + `MyWeekMetric` (Task 4), `paceDelta`/`isFreshStart` (Task 5). Existing: `useGetLeaderboard`, `useGetMe`, `PageTabs`, shadcn `Tabs`.
- Produces: page renders "My Week" content by default; global list under an "Everyone" tab; no "Global Rankings" string anywhere.

- [ ] **Step 1: Rewrite the page**

Replace `artifacts/focusquest/src/pages/leaderboard.tsx` in full:

```tsx
import { useState } from "react";
import { useGetLeaderboard, useGetMe, useGetMyWeek, GetLeaderboardPeriod, type MyWeekMetric } from "@workspace/api-client-react";
import { Trophy, Medal, Star, Zap, Swords, Timer, Sparkles } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageTabs } from "@/components/page-tabs";
import { paceDelta, isFreshStart } from "@/lib/my-week";

function RankIcon({ rank }: { rank: number }) {
  if (rank === 1) return <Trophy className="w-5 h-5 text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.8)]" />;
  if (rank === 2) return <Medal className="w-5 h-5 text-slate-300 drop-shadow-[0_0_8px_rgba(209,213,219,0.8)]" />;
  if (rank === 3) return <Medal className="w-5 h-5 text-amber-600 drop-shadow-[0_0_8px_rgba(217,119,6,0.8)]" />;
  return <span className="font-bold text-muted-foreground tabular-nums">{rank}</span>;
}

function SkeletonRow() {
  return (
    <div className="grid grid-cols-12 gap-4 p-4 items-center animate-pulse">
      <div className="col-span-2 flex justify-center">
        <div className="w-6 h-6 rounded-full bg-muted" />
      </div>
      <div className="col-span-6 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-muted" />
        <div className="space-y-1.5">
          <div className="h-3 w-24 bg-muted rounded" />
          <div className="h-2.5 w-12 bg-muted rounded" />
        </div>
      </div>
      <div className="col-span-4 flex flex-col items-end gap-1.5">
        <div className="h-3 w-16 bg-muted rounded" />
        <div className="h-2.5 w-12 bg-muted rounded" />
      </div>
    </div>
  );
}

function MetricCard({ icon, label, metric }: { icon: React.ReactNode; label: string; metric: MyWeekMetric }) {
  const delta = paceDelta(metric);
  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-lg space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="flex items-end gap-2 flex-wrap">
        <span className="text-4xl font-bold tabular-nums leading-none">{metric.current.toLocaleString()}</span>
        {delta !== null && (
          <span className="text-[11px] bg-primary/15 text-primary border border-primary/30 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            +{delta.toLocaleString()} ahead of last week&rsquo;s pace
          </span>
        )}
      </div>
      <div className="text-xs text-muted-foreground space-y-0.5">
        <div>By this time last week: <span className="tabular-nums font-semibold">{metric.samePointLastWeek.toLocaleString()}</span></div>
        <div>Last week total: <span className="tabular-nums font-semibold">{metric.lastWeekTotal.toLocaleString()}</span></div>
      </div>
    </div>
  );
}

function MyWeekPanel() {
  const { data: week, isLoading } = useGetMyWeek();

  if (isLoading || !week) {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-5 h-36 animate-pulse" />
        ))}
      </div>
    );
  }

  if (isFreshStart(week)) {
    return (
      <div className="bg-card border border-border rounded-xl py-16 px-6 text-center space-y-3 shadow-lg">
        <Sparkles className="w-8 h-8 text-primary mx-auto" />
        <p className="font-semibold text-foreground">Fresh start</p>
        <p className="text-sm text-muted-foreground">
          This page fills in as you quest — next week it becomes your favorite rivalry.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard icon={<Swords className="w-4 h-4" />} label="Quests cleared" metric={week.quests} />
        <MetricCard icon={<Star className="w-4 h-4" />} label="XP earned" metric={week.xp} />
        <MetricCard icon={<Timer className="w-4 h-4" />} label="Focus minutes" metric={week.focusMinutes} />
      </div>
      <p className="text-xs text-muted-foreground text-center">
        Weeks start Monday in your timezone. Pace compares the same stretch of each week.
      </p>
    </div>
  );
}

function EveryonePanel() {
  const [period, setPeriod] = useState<GetLeaderboardPeriod>(GetLeaderboardPeriod.weekly);
  const { data: leaderboard, isLoading } = useGetLeaderboard({ period });
  const { data: me } = useGetMe();

  const isEmpty = !isLoading && leaderboard?.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Tabs value={period} onValueChange={(v) => setPeriod(v as GetLeaderboardPeriod)}>
          <TabsList className="bg-card border border-border">
            <TabsTrigger
              value={GetLeaderboardPeriod.weekly}
              className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
            >
              This Week
            </TabsTrigger>
            <TabsTrigger
              value={GetLeaderboardPeriod.alltime}
              className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
            >
              All Time
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-lg">
        <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-muted/40 text-[11px] font-bold text-muted-foreground uppercase tracking-wider border-b border-border">
          <div className="col-span-2 text-center">Rank</div>
          <div className="col-span-6">Commander</div>
          <div className="col-span-4 text-right">Score</div>
        </div>

        <div className="divide-y divide-border">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
          ) : isEmpty ? (
            <div className="py-20 flex flex-col items-center gap-4 text-center px-6">
              <div className="w-16 h-16 rounded-full bg-muted/40 flex items-center justify-center border border-border">
                <Trophy className="w-8 h-8 text-muted-foreground opacity-40" />
              </div>
              <div>
                <p className="font-semibold text-foreground">No one&rsquo;s on the board yet</p>
                <p className="text-sm text-muted-foreground mt-1">Complete quests to claim the top spot.</p>
              </div>
            </div>
          ) : (
            leaderboard?.map((entry) => {
              const isMe = me != null && entry.user.id === me.id;
              return (
                <div
                  key={entry.user.id}
                  className={`
                    grid grid-cols-12 gap-4 px-4 py-3.5 items-center transition-colors
                    hover:bg-muted/30
                    ${isMe ? "bg-primary/5 border-l-2 border-primary" : ""}
                  `}
                  aria-current={isMe ? "true" : undefined}
                >
                  <div className="col-span-2 flex justify-center">
                    <RankIcon rank={entry.rank} />
                  </div>

                  <div className="col-span-6 flex items-center gap-3 min-w-0">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm border-2 border-border bg-muted text-foreground flex-shrink-0"
                      style={
                        entry.user.avatarColor
                          ? {
                              borderColor: entry.user.avatarColor,
                              backgroundColor: `${entry.user.avatarColor}22`,
                              boxShadow: `0 0 6px ${entry.user.avatarColor}55`,
                            }
                          : undefined
                      }
                    >
                      {entry.user.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold flex items-center gap-2 flex-wrap">
                        <span className="truncate">{entry.user.username}</span>
                        {isMe && (
                          <span className="text-[10px] bg-primary text-background px-1.5 py-0.5 rounded uppercase font-bold tracking-wider flex-shrink-0">
                            You
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">Lv. {entry.user.currentLevel} · {entry.user.levelName}</div>
                    </div>
                  </div>

                  <div className="col-span-4 text-right">
                    <div className={`font-bold flex items-center justify-end gap-1 ${isMe ? "text-primary" : "text-foreground"}`}>
                      <Star className="w-3.5 h-3.5 fill-current flex-shrink-0" />
                      <span className="tabular-nums">{entry.points.toLocaleString()}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {entry.tasksCompleted} quests
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {!isLoading && !isEmpty && (
        <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1.5">
          <Zap className="w-3 h-3" />
          Weekly XP resets every Monday. Complete quests to climb the ranks.
        </p>
      )}
    </div>
  );
}

type FellowshipView = "myweek" | "everyone";

export default function Leaderboard() {
  // "You vs. last week" is the default: at any population it's a full room (Act VII q6).
  const [view, setView] = useState<FellowshipView>("myweek");

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <PageTabs group="allies" />
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <Trophy className="w-7 h-7 text-primary" />
            Fellowship
          </h1>
          <p className="text-muted-foreground mt-1">You vs. last week — the only match that matters.</p>
        </div>

        <Tabs value={view} onValueChange={(v) => setView(v as FellowshipView)}>
          <TabsList className="bg-card border border-border">
            <TabsTrigger
              value="myweek"
              className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
            >
              My Week
            </TabsTrigger>
            <TabsTrigger
              value="everyone"
              className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary"
            >
              Everyone
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {view === "myweek" ? <MyWeekPanel /> : <EveryonePanel />}
    </div>
  );
}
```

- [ ] **Step 2: Right-size the boss card's one line of copy**

In `artifacts/focusquest/src/components/world-boss-panel.tsx`, change:

```tsx
            <p className="text-sm text-muted-foreground">{boss.weekKey} · everyone vs. one boss</p>
```

to:

```tsx
            <p className="text-sm text-muted-foreground">{boss.weekKey} · this week&rsquo;s raiders vs. one boss</p>
```

- [ ] **Step 3: Web suite + typecheck + grep the dead copy**

Run: `pnpm -C artifacts/focusquest test && pnpm -C artifacts/focusquest typecheck`
Expected: PASS.
Run: `grep -rn "Global Rankings" artifacts/focusquest/src`
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add artifacts/focusquest/src/pages/leaderboard.tsx artifacts/focusquest/src/components/world-boss-panel.tsx
git commit -m "feat(web): Fellowship page defaults to You-vs-last-week"
```

### Task 7: One-shot reseed of the live current week + full verification

**Files:**
- Create: `scripts/src/reseed-world-boss-week.ts` (mirror the invocation style of the existing scripts in `scripts/` — check `scripts/package.json` for how seed/backfill commands are wired and copy that convention)

**Why:** the current week's row was already materialized under the old curve (W30 → clamped 5000 HP) — comically unwinnable for the live ~2-person population. The formula only applies at materialization, so without this the right-sizing waits a week.

**Interfaces:**
- Consumes: `@workspace/db` (`db`, `worldBossWeeksTable`, `worldBossAttacksTable`), drizzle `eq/and/isNull/sql`.
- Produces: idempotent CLI run; safe to re-run any time.

- [ ] **Step 1: Write the script**

Create `scripts/src/reseed-world-boss-week.ts` (adjust imports/registration to match the existing scripts-package conventions found in Step 0 of this task):

```ts
// One-shot for Act VII q6: resize the ALREADY-materialized current World Boss
// week to the new cohort formula (the formula otherwise applies only to weeks
// materialized after deploy). Constants mirror api-server's lib/world-boss.ts
// (HP_PER_CONTRIBUTOR / HP_MIN = 300) — a one-shot script may duplicate them.
//
// Guards:
//  - never touches a defeated week (payout already settled);
//  - never sets hp <= totalDamage: a stored total >= hp would make
//    crossedThreshold unreachable and the defeat payout could never fire.
// Idempotent: re-running recomputes the same target.
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, worldBossWeeksTable, worldBossAttacksTable } from "@workspace/db";

const HP_PER_CONTRIBUTOR = 300;
const HP_MIN = 300;

function getWeekKey(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

async function main() {
  const now = new Date();
  const weekKey = getWeekKey(now);
  const priorKey = getWeekKey(new Date(now.getTime() - 7 * 86400000));

  const [prior] = await db
    .select({ n: sql<number>`count(distinct ${worldBossAttacksTable.userId})`.mapWith(Number) })
    .from(worldBossAttacksTable)
    .where(eq(worldBossAttacksTable.weekKey, priorKey));
  const cohort = prior?.n ?? 0;
  const targetHp = Math.max(HP_MIN, cohort * HP_PER_CONTRIBUTOR);

  const updated = await db.update(worldBossWeeksTable)
    .set({ hp: sql`greatest(${targetHp}, ${worldBossWeeksTable.totalDamage} + 1)` })
    .where(and(eq(worldBossWeeksTable.weekKey, weekKey), isNull(worldBossWeeksTable.defeatedAt)))
    .returning();

  if (updated.length === 0) {
    console.log(`No live boss row for ${weekKey} (not materialized yet, or already defeated) — nothing to do.`);
  } else {
    console.log(`Resized ${weekKey}: cohort=${cohort} (week ${priorKey}) → hp=${updated[0]!.hp} (totalDamage=${updated[0]!.totalDamage}).`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Typecheck the scripts package**

Run: `pnpm -C scripts typecheck` (or the package's convention)
Expected: PASS. (Do NOT run the script against Neon yet — it runs once post-merge, per the shared-live-DB convention.)

- [ ] **Step 3: Full verification sweep**

Run: `pnpm -C artifacts/api-server test && pnpm -C artifacts/focusquest test && pnpm typecheck`
Expected: all suites green, workspace typecheck green.

- [ ] **Step 4: Commit**

```bash
git add scripts/src/reseed-world-boss-week.ts
git commit -m "chore(scripts): one-shot reseed of live boss week to cohort HP"
```

### Task 8: Browser verification (dev servers)

**Files:** none (verification only).

- [ ] **Step 1:** Start API + web dev servers via the Browser pane (`.claude/launch.json` — add entries if missing, per its README format).
- [ ] **Step 2:** Walk through: `/leaderboard` renders with "My Week" tab active by default; three metric cards show; pace chip appears only where current > same-point; "Everyone" tab shows the ranked table with This Week/All Time period toggle; no "Global Rankings" string anywhere; boss card copy reads "this week's raiders vs. one boss". Screenshot for the PR.
- [ ] **Step 3:** `GET /leaderboard/my-week` responds 401 unauthenticated (curl) and 200 with the session cookie via the app.

---

## Post-plan workflow (session, not plan tasks)

PR `feat/right-sized-fellowship` → review pass → merge → run reseed script once against Neon (feedback memory: I run live applies myself) → update campaign map artifact to 33/38 + memory files.

## Self-Review

- **Spec coverage:** default self-view tab ✓ (Task 6); population-honest copy ✓ (Task 6, grep step); boss HP scales with prior-week cohort ✓ (Tasks 1–2); formula in quest plan ✓ (calibration note, Task 1); anti-shame floor + exactly-once payout preserved ✓ (Task 2 touches only `ensureBossWeek` + prologues; attack tx untouched); "boss HP responds to cohort size in unit tests" ✓ (Task 1); "solo user's leaderboard defaults to a meaningful self-view with no empty-room framing" ✓ (Tasks 5–6, fresh-start state); out-of-scope respected (no new surfaces, nothing removed, no matchmaking) ✓.
- **Placeholder scan:** clean — every code step carries full code; Task 7's "match conventions" instruction is bounded by complete fallback code.
- **Type consistency:** `worldBossHp(number)` used in Tasks 1/2/7 ✓; `Window`/`ComparisonWindows` named identically in Tasks 3/4 ✓; `MyWeekMetric` fields `current/samePointLastWeek/lastWeekTotal` consistent across Tasks 4/5/6 ✓; `useGetMyWeek` matches operationId `getMyWeek` ✓.
