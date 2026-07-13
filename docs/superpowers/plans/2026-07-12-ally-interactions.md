# Ally Interactions & Info Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let allies poke/cheer each other with canned reactions (persisted inbox + push) and view an expanded ally profile showing hero, badges, today's progress, and recent milestones.

**Architecture:** One new `ally_nudges` table backs persistence, unread counts, and rate-limiting. Milestones reuse existing `activity` rows (`level_up`/`badge_earned`/`streak_milestone`/`all_day_bonus`) — no new tracking. Pure decision logic (reaction validation, rate-limit, milestone freshness) is extracted into unit-tested libs; Express routes and React UI are hand-written and verified end-to-end. Ally-scoped reads reuse the existing avatar/badge builders, refactored to take a `userId`.

**Tech Stack:** pnpm monorepo · Drizzle ORM (Postgres/Neon, `push` — no migration files) · Express · OpenAPI-first client codegen (orval → `@workspace/api-zod` + `@workspace/api-client-react`) · React + wouter + TanStack Query + shadcn/ui · vitest.

## Global Constraints

- **API change flow:** edit `lib/api-spec/openapi.yaml`, then regenerate with `pnpm --filter @workspace/api-spec codegen`. **Never hand-edit** files under `*/src/generated`.
- **DB change flow:** edit `lib/db/src/schema/*`, then `pnpm --filter @workspace/db push`. There are NO migration files. `drizzle.config.ts` does not load `.env` — export first: `export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"`. Additive columns/tables apply without a destructive prompt.
- **Tests:** `pnpm --filter @workspace/api-server test` (vitest). Filter one file: `pnpm --filter @workspace/api-server test -- nudges`.
- **Typecheck gate:** `pnpm typecheck` at repo root.
- **Test pattern (important):** api-server has **no route/supertest harness** — only pure-function unit tests (see `src/lib/partnerships.test.ts`). Do NOT introduce a supertest harness. Extract pure logic into libs and unit-test those; verify routes and UI via the end-to-end step in Task 14.
- **Auth:** every ally-scoped endpoint requires `req.isAuthenticated()` and an **accepted** partnership between `req.gameUserId` and the target user; otherwise `403`. Self-targeting is `400`.
- **Canned reactions only** — no free text is ever accepted from users. The server validates every `reaction` against the fixed set for its `kind`.
- **Rate limit:** one `poke` **and** one `cheer` per sender→recipient per local calendar day.
- **Privacy:** ally progress is exposed as **counts only** (`questsCompletedToday`/`questsDueToday`/`allDoneToday`) — never task titles or content.
- **Push:** best-effort, decoupled from persistence. A failed/expired subscription (`sendPushNotification` returns `false`) is deleted and never blocks storing the nudge.
- **Branch:** work is on `feat/ally-interactions` (already created off `main`).

---

## File Structure

**Create:**
- `lib/db/src/schema/ally-nudges.ts` — `ally_nudges` table + type.
- `artifacts/api-server/src/lib/nudges.ts` — reaction registry, kind/reaction validation, rate-limit decision (pure).
- `artifacts/api-server/src/lib/nudges.test.ts` — unit tests for the above.
- `artifacts/api-server/src/lib/ally-milestones.ts` — milestone type set + `hasFreshMilestone` (pure).
- `artifacts/api-server/src/lib/ally-milestones.test.ts` — unit tests.
- `artifacts/focusquest/src/lib/nudge-reactions.ts` — client display registry (keys + labels) for the picker.
- `artifacts/focusquest/src/components/nudge-picker.tsx` — popover reaction picker (shared by card + detail).
- `artifacts/focusquest/src/pages/partner-detail.tsx` — the ally info screen at `/partners/:id`.

**Modify:**
- `lib/db/src/schema/index.ts` — export the new schema.
- `artifacts/api-server/src/routes/avatar.ts` — extract `buildHeroLook(userId)`, export it.
- `artifacts/api-server/src/routes/badges.ts` — extract & export `getEarnedBadges(userId)`.
- `artifacts/api-server/src/routes/accountability.ts` — `requireAcceptedPartnership` helper; ally-detail, nudge-send, inbox, mark-read endpoints; augment the partners list.
- `lib/api-spec/openapi.yaml` — new paths + schemas; augment `Partnership`.
- `artifacts/focusquest/src/pages/partners.tsx` — card progress + poke/cheer + Inbox tab + link to detail.
- `artifacts/focusquest/src/App.tsx` — register `/partners/:id`.
- `artifacts/focusquest/src/components/layout.tsx` — unread badge on the Allies nav item.

---

## Task 1: `ally_nudges` schema + push to Neon

**Files:**
- Create: `lib/db/src/schema/ally-nudges.ts`
- Modify: `lib/db/src/schema/index.ts:5-6` (add export line)

**Interfaces:**
- Produces: `allyNudgesTable` (Drizzle table) and `AllyNudge` type, exported from `@workspace/db`. Columns: `id`, `senderId`, `recipientId`, `kind`, `reaction`, `contextType` (nullable), `readAt` (nullable), `createdAt`.

- [ ] **Step 1: Create the schema file**

Create `lib/db/src/schema/ally-nudges.ts`:

```ts
import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const allyNudgesTable = pgTable("ally_nudges", {
  id:          serial("id").primaryKey(),
  senderId:    integer("sender_id").notNull().references(() => usersTable.id),
  recipientId: integer("recipient_id").notNull().references(() => usersTable.id),
  kind:        text("kind").notNull(),          // 'poke' | 'cheer'
  reaction:    text("reaction").notNull(),      // canned reaction key
  contextType: text("context_type"),            // optional cue label
  readAt:      timestamp("read_at"),            // null = unread
  createdAt:   timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("ally_nudges_recipient_idx").on(t.recipientId),
  index("ally_nudges_sender_recipient_kind_idx").on(t.senderId, t.recipientId, t.kind, t.createdAt),
]);

export type AllyNudge = typeof allyNudgesTable.$inferSelect;
```

- [ ] **Step 2: Export from the schema barrel**

In `lib/db/src/schema/index.ts`, add after the `partnerships` export (line 5):

```ts
export * from "./ally-nudges";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @workspace/db typecheck` (or `pnpm typecheck`)
Expected: PASS, no errors.

- [ ] **Step 4: Push schema to Neon**

Run:
```bash
export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"
pnpm --filter @workspace/db push
```
Expected: `[✓] Changes applied` (table `ally_nudges` created). If a re-run is blocked by the auto-mode guardrail, the first run is authoritative.

- [ ] **Step 5: Commit**

```bash
git add lib/db/src/schema/ally-nudges.ts lib/db/src/schema/index.ts
git commit -m "feat(db): ally_nudges table for poke/cheer nudges"
```

---

## Task 2: Nudge reaction registry + validation + rate-limit (pure lib, TDD)

**Files:**
- Create: `artifacts/api-server/src/lib/nudges.ts`
- Test: `artifacts/api-server/src/lib/nudges.test.ts`

**Interfaces:**
- Produces:
  - `type NudgeKind = "poke" | "cheer"`
  - `interface NudgeReaction { key: string; label: string }`
  - `POKE_REACTIONS: NudgeReaction[]`, `CHEER_REACTIONS: NudgeReaction[]`
  - `reactionsFor(kind: NudgeKind): NudgeReaction[]`
  - `isValidKind(x: string): x is NudgeKind`
  - `isValidReaction(kind: NudgeKind, key: string): boolean`
  - `reactionLabel(kind: NudgeKind, key: string): string | null`
  - `canSendNudge(sameKindCountToday: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/nudges.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  isValidKind, isValidReaction, reactionLabel, reactionsFor, canSendNudge,
} from "./nudges";

describe("nudge kinds", () => {
  it("accepts poke and cheer", () => {
    expect(isValidKind("poke")).toBe(true);
    expect(isValidKind("cheer")).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isValidKind("shove")).toBe(false);
    expect(isValidKind("")).toBe(false);
  });
});

describe("reaction validation", () => {
  it("accepts a known key for the right kind", () => {
    expect(isValidReaction("poke", "get_moving")).toBe(true);
    expect(isValidReaction("cheer", "crushing_it")).toBe(true);
  });
  it("rejects a key from the other kind", () => {
    expect(isValidReaction("poke", "crushing_it")).toBe(false);
    expect(isValidReaction("cheer", "get_moving")).toBe(false);
  });
  it("rejects an unknown key", () => {
    expect(isValidReaction("poke", "nope")).toBe(false);
  });
  it("resolves labels and returns null for unknown", () => {
    expect(reactionLabel("poke", "get_moving")).toMatch(/get moving/i);
    expect(reactionLabel("poke", "nope")).toBeNull();
  });
  it("lists four reactions per kind", () => {
    expect(reactionsFor("poke")).toHaveLength(4);
    expect(reactionsFor("cheer")).toHaveLength(4);
  });
});

describe("rate limit", () => {
  it("allows the first nudge of a kind today", () => {
    expect(canSendNudge(0)).toBe(true);
  });
  it("blocks a second nudge of the same kind today", () => {
    expect(canSendNudge(1)).toBe(false);
    expect(canSendNudge(3)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- nudges`
Expected: FAIL — cannot resolve `./nudges`.

- [ ] **Step 3: Write the implementation**

Create `artifacts/api-server/src/lib/nudges.ts`:

```ts
/**
 * Canned reactions for ally poke/cheer nudges, plus pure validation and
 * rate-limit logic. No free text is ever accepted from users; every reaction
 * must match one of the fixed keys below for its kind.
 */

export type NudgeKind = "poke" | "cheer";

export interface NudgeReaction {
  key: string;
  label: string;
}

export const POKE_REACTIONS: NudgeReaction[] = [
  { key: "get_moving",        label: "Get moving! 💪" },
  { key: "dont_break_streak", label: "Don't break the streak! 🔥" },
  { key: "still_time",        label: "Still time today! ⏳" },
  { key: "checking_in",       label: "Checking in on you 👀" },
];

export const CHEER_REACTIONS: NudgeReaction[] = [
  { key: "crushing_it",    label: "You're crushing it! 🎉" },
  { key: "nice_level",     label: "Level up! Nice! ⭐" },
  { key: "streak_respect", label: "Streak respect 🔥" },
  { key: "proud",          label: "Proud of you! 🙌" },
];

export function isValidKind(x: string): x is NudgeKind {
  return x === "poke" || x === "cheer";
}

export function reactionsFor(kind: NudgeKind): NudgeReaction[] {
  return kind === "poke" ? POKE_REACTIONS : CHEER_REACTIONS;
}

export function reactionLabel(kind: NudgeKind, key: string): string | null {
  return reactionsFor(kind).find((r) => r.key === key)?.label ?? null;
}

export function isValidReaction(kind: NudgeKind, key: string): boolean {
  return reactionLabel(kind, key) !== null;
}

/**
 * Rate limit: at most one nudge of a given kind per sender→recipient per local
 * calendar day. `sameKindCountToday` is the number of nudges of this kind the
 * sender has already sent this recipient since the start of the sender's day.
 */
export function canSendNudge(sameKindCountToday: number): boolean {
  return sameKindCountToday === 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server test -- nudges`
Expected: PASS (all assertions green).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/nudges.ts artifacts/api-server/src/lib/nudges.test.ts
git commit -m "feat(api): canned nudge reactions + validation + rate-limit logic"
```

---

## Task 3: Milestone filtering + freshness (pure lib, TDD)

**Files:**
- Create: `artifacts/api-server/src/lib/ally-milestones.ts`
- Test: `artifacts/api-server/src/lib/ally-milestones.test.ts`

**Interfaces:**
- Produces:
  - `MILESTONE_TYPES: readonly ["level_up","badge_earned","streak_milestone","all_day_bonus"]`
  - `isMilestoneType(t: string): boolean`
  - `interface ActivityLike { type: string; createdAt: Date }`
  - `hasFreshMilestone(rows: ActivityLike[], now: Date, windowHours: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/ally-milestones.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MILESTONE_TYPES, isMilestoneType, hasFreshMilestone } from "./ally-milestones";

describe("MILESTONE_TYPES", () => {
  it("is exactly the four celebratable types", () => {
    expect([...MILESTONE_TYPES]).toEqual([
      "level_up", "badge_earned", "streak_milestone", "all_day_bonus",
    ]);
  });
  it("classifies types", () => {
    expect(isMilestoneType("level_up")).toBe(true);
    expect(isMilestoneType("task_completed")).toBe(false);
  });
});

describe("hasFreshMilestone", () => {
  const now = new Date("2026-07-12T12:00:00Z");

  it("is true when a milestone is within the window", () => {
    const rows = [{ type: "level_up", createdAt: new Date("2026-07-12T06:00:00Z") }];
    expect(hasFreshMilestone(rows, now, 48)).toBe(true);
  });
  it("is false when the milestone is older than the window", () => {
    const rows = [{ type: "level_up", createdAt: new Date("2026-07-09T06:00:00Z") }];
    expect(hasFreshMilestone(rows, now, 48)).toBe(false);
  });
  it("ignores non-milestone activity even if recent", () => {
    const rows = [{ type: "task_completed", createdAt: new Date("2026-07-12T11:59:00Z") }];
    expect(hasFreshMilestone(rows, now, 48)).toBe(false);
  });
  it("is false for an empty feed", () => {
    expect(hasFreshMilestone([], now, 48)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- ally-milestones`
Expected: FAIL — cannot resolve `./ally-milestones`.

- [ ] **Step 3: Write the implementation**

Create `artifacts/api-server/src/lib/ally-milestones.ts`:

```ts
/**
 * Milestones are not tracked separately — they are the celebratable subset of
 * the existing `activity` feed. This module names that subset and decides
 * whether an ally has a "fresh" milestone worth cheering.
 */

export const MILESTONE_TYPES = [
  "level_up",
  "badge_earned",
  "streak_milestone",
  "all_day_bonus",
] as const;

export type MilestoneType = (typeof MILESTONE_TYPES)[number];

export function isMilestoneType(t: string): boolean {
  return (MILESTONE_TYPES as readonly string[]).includes(t);
}

export interface ActivityLike {
  type: string;
  createdAt: Date;
}

/**
 * True when any milestone-typed row falls within `windowHours` before `now`.
 */
export function hasFreshMilestone(
  rows: ActivityLike[],
  now: Date,
  windowHours: number,
): boolean {
  const cutoff = now.getTime() - windowHours * 60 * 60 * 1000;
  return rows.some(
    (r) => isMilestoneType(r.type) && r.createdAt.getTime() >= cutoff,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server test -- ally-milestones`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/ally-milestones.ts artifacts/api-server/src/lib/ally-milestones.test.ts
git commit -m "feat(api): milestone-type set + fresh-milestone detection"
```

---

## Task 4: Reusable by-userId hero + badge builders

**Files:**
- Modify: `artifacts/api-server/src/routes/avatar.ts:17-73`
- Modify: `artifacts/api-server/src/routes/badges.ts:19-46`

**Interfaces:**
- Produces:
  - `avatar.ts`: `export async function buildHeroLook(userId: number)` returning `{ avatarColor, avatarClass, avatarSkin, avatarHairStyle, avatarHairColor, avatarBodyBuild, avatarFace, avatarBeardStyle, avatarBeardColor, avatarGlasses, avatarEarrings, level, battlePower, equippedGear } | null`. `buildAvatarResponse` now composes it with the `available*` arrays (behavior unchanged).
  - `badges.ts`: `export async function getEarnedBadges(userId: number)` returning the `{ badge, earnedAt }[]` array (same shape the `/users/me/badges` route already returns).

- [ ] **Step 1: Extract `buildHeroLook` in avatar.ts**

Replace the body of `buildAvatarResponse` (`artifacts/api-server/src/routes/avatar.ts:17-66`) with an extracted `buildHeroLook` plus a thin `buildAvatarResponse` wrapper:

```ts
export async function buildHeroLook(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return null;

  const ownedGear = await db
    .select({ gear: gearItemsTable, userGear: userGearTable })
    .from(userGearTable)
    .innerJoin(gearItemsTable, eq(userGearTable.gearItemId, gearItemsTable.id))
    .where(eq(userGearTable.userId, userId));

  const equipped = ownedGear.filter(g => g.userGear.equipped);
  const equippedPower = equipped.reduce((sum, g) => sum + g.gear.statPower, 0);
  const levelInfo = getLevelInfo(user.totalPoints);

  return {
    avatarColor:      user.avatarColor,
    avatarClass:      user.avatarClass,
    avatarSkin:       user.avatarSkin ?? "light",
    avatarHairStyle:  user.avatarHairStyle  ?? "short",
    avatarHairColor:  user.avatarHairColor  ?? "brown",
    avatarBodyBuild:  user.avatarBodyBuild  ?? "male",
    avatarFace:       user.avatarFace       ?? "neutral",
    avatarBeardStyle: user.avatarBeardStyle ?? "none",
    avatarBeardColor: user.avatarBeardColor ?? "brown",
    avatarGlasses:    user.avatarGlasses    ?? "none",
    avatarEarrings:   user.avatarEarrings   ?? "none",
    level:            levelInfo.level,
    battlePower:      calcBattlePower(levelInfo.level, equippedPower),
    equippedGear:     equipped.map(g => ({
      id:        g.gear.id,
      name:      g.gear.name,
      slot:      g.gear.slot,
      rarity:    g.gear.rarity,
      statPower: g.gear.statPower,
      icon:      g.gear.icon,
      spriteId:  g.gear.spriteId ?? null,
    })),
  };
}

async function buildAvatarResponse(userId: number) {
  const hero = await buildHeroLook(userId);
  if (!hero) return null;
  return {
    ...hero,
    availableColors:  ids(colors),
    availableClasses: ids(classes),
    availableSkins:   ids(skins),
    availableHairStyles: ids(hairStyles),
    availableHairColors: ids(hairColors),
    availableBuilds:     ids(builds),
    availableFaces:      ids(faces),
    availableBeardStyles: ids(beardStyles),
    availableBeardColors: ids(beardColors),
    availableGlasses:     ids(glasses),
    availableEarrings:    ids(earrings),
  };
}
```

Note: `calcBattlePower` is already defined above in this file and already `export`ed at the bottom — no change needed there.

- [ ] **Step 2: Extract `getEarnedBadges` in badges.ts**

In `artifacts/api-server/src/routes/badges.ts`, add an exported helper and call it from the route. Replace the `/users/me/badges` handler body (lines 19-46) with:

```ts
export async function getEarnedBadges(userId: number) {
  const userBadges = await db.select({
    id: badgesTable.id,
    name: badgesTable.name,
    description: badgesTable.description,
    icon: badgesTable.icon,
    category: badgesTable.category,
    requirement: badgesTable.requirement,
    earnedAt: userBadgesTable.earnedAt,
  }).from(userBadgesTable)
    .innerJoin(badgesTable, eq(userBadgesTable.badgeId, badgesTable.id))
    .where(eq(userBadgesTable.userId, userId));

  return userBadges.map((ub) => ({
    badge: {
      id: ub.id,
      name: ub.name,
      description: ub.description,
      icon: ub.icon,
      category: ub.category,
      requirement: ub.requirement,
    },
    earnedAt: ub.earnedAt.toISOString(),
  }));
}

router.get("/users/me/badges", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  res.json(await getEarnedBadges(req.gameUserId));
});
```

- [ ] **Step 3: Typecheck + existing tests still pass**

Run: `pnpm typecheck` and `pnpm --filter @workspace/api-server test`
Expected: PASS. (No behavior change to `/avatar` or `/users/me/badges`.)

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/avatar.ts artifacts/api-server/src/routes/badges.ts
git commit -m "refactor(api): extract by-userId buildHeroLook + getEarnedBadges"
```

---

## Task 5: Ally-detail endpoint + accepted-partnership guard

**Files:**
- Modify: `artifacts/api-server/src/routes/accountability.ts` (imports; add helper + route)

**Interfaces:**
- Consumes: `buildHeroLook` (Task 4), `getEarnedBadges` (Task 4), `MILESTONE_TYPES` (Task 3), `resolveTimeZone`/`localDateKey` (`../lib/date-buckets`), `allyNudgesTable` (Task 1).
- Produces: `GET /accountability/partners/:id` returning `{ partner, progress, hero, badges, milestones, sentTodayPoke, sentTodayCheer }`. A reusable local `async function requireAcceptedPartnership(userId, otherId): Promise<Partnership | null>`.

- [ ] **Step 1: Add imports**

At the top of `artifacts/api-server/src/routes/accountability.ts`, extend the drizzle-orm and db imports and add the new libs:

```ts
import { eq, or, and, desc, inArray, gte } from "drizzle-orm";
import { db, usersTable, partnershipsTable, activityTable, tasksTable, allyNudgesTable } from "@workspace/db";
import { getLevelInfo } from "../lib/gamification";
import { resolvePartnerRequest } from "../lib/partnerships";
import { buildHeroLook } from "./avatar";
import { getEarnedBadges } from "./badges";
import { MILESTONE_TYPES } from "../lib/ally-milestones";
import { resolveTimeZone, localDateKey } from "../lib/date-buckets";
```

- [ ] **Step 2: Add the `requireAcceptedPartnership` helper**

Add above the route definitions (after `formatUserSummary`):

```ts
/**
 * Returns the accepted partnership row linking `userId` and `otherId` (in either
 * direction), or null if there is none / it is not accepted.
 */
async function requireAcceptedPartnership(userId: number, otherId: number) {
  const [p] = await db.select().from(partnershipsTable).where(
    and(
      eq(partnershipsTable.status, "accepted"),
      or(
        and(eq(partnershipsTable.requesterId, userId), eq(partnershipsTable.recipientId, otherId)),
        and(eq(partnershipsTable.requesterId, otherId), eq(partnershipsTable.recipientId, userId)),
      ),
    ),
  );
  return p ?? null;
}

/** Count today's sent nudges of each kind for a sender→recipient pair. */
async function sentTodayFlags(senderId: number, recipientId: number, dayStart: Date) {
  const rows = await db.select().from(allyNudgesTable).where(
    and(
      eq(allyNudgesTable.senderId, senderId),
      eq(allyNudgesTable.recipientId, recipientId),
      gte(allyNudgesTable.createdAt, dayStart),
    ),
  );
  return {
    sentTodayPoke:  rows.some((r) => r.kind === "poke"),
    sentTodayCheer: rows.some((r) => r.kind === "cheer"),
  };
}
```

- [ ] **Step 3: Add the ally-detail route**

Add before `export default router;`:

```ts
router.get("/accountability/partners/:id/detail", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const partnerId = parseInt(raw, 10);
  if (isNaN(partnerId)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (partnerId === userId) { res.status(400).json({ error: "Cannot view yourself as an ally" }); return; }

  const partnership = await requireAcceptedPartnership(userId, partnerId);
  if (!partnership) { res.status(403).json({ error: "Not an active ally" }); return; }

  const [partner] = await db.select().from(usersTable).where(eq(usersTable.id, partnerId));
  if (!partner) { res.status(404).json({ error: "Partner not found" }); return; }

  const timeZone = resolveTimeZone(typeof req.query.tz === "string" ? req.query.tz : undefined);
  const now = new Date();
  const today = localDateKey(now, timeZone);
  const dayStart = new Date(today + "T00:00:00Z");

  const todayTasks = await db.select().from(tasksTable)
    .where(and(eq(tasksTable.userId, partnerId), eq(tasksTable.dueDate, today)));
  const questsDueToday = todayTasks.length;
  const questsCompletedToday = todayTasks.filter((t) => t.completed).length;

  const hero = await buildHeroLook(partnerId);
  const badges = await getEarnedBadges(partnerId);

  const milestones = await db.select().from(activityTable)
    .where(and(
      eq(activityTable.userId, partnerId),
      inArray(activityTable.type, [...MILESTONE_TYPES]),
    ))
    .orderBy(desc(activityTable.createdAt))
    .limit(20);

  const flags = await sentTodayFlags(userId, partnerId, dayStart);

  res.json({
    partner: formatUserSummary(partner),
    progress: {
      questsDueToday,
      questsCompletedToday,
      allDoneToday: questsDueToday > 0 && questsCompletedToday === questsDueToday,
    },
    hero,
    badges,
    milestones: milestones.map((a) => ({
      id: a.id,
      userId: a.userId,
      type: a.type,
      description: a.description,
      points: a.points,
      createdAt: a.createdAt.toISOString(),
    })),
    ...flags,
  });
});
```

Note: the path is `/detail` (not the bare `/:id`) so it never collides with the existing `/:id/accept`, `/:id/decline`, `/:id/feed` routes.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/accountability.ts
git commit -m "feat(api): ally detail endpoint (hero, badges, progress, milestones)"
```

---

## Task 6: Send-nudge endpoint (persist + push + rate limit)

**Files:**
- Modify: `artifacts/api-server/src/routes/accountability.ts` (imports; add route)

**Interfaces:**
- Consumes: `requireAcceptedPartnership` (Task 5), `isValidKind`/`isValidReaction`/`reactionLabel`/`canSendNudge` (Task 2), `sendPushNotification` (`../lib/push-notifications`), `pushSubscriptionsTable` (`@workspace/db`), `localDateKey`/`resolveTimeZone` (already imported in Task 5).
- Produces: `POST /accountability/partners/:id/nudge`, body `{ kind, reaction, contextType? }` → `201 { id, kind, reaction, createdAt }`; `429` when rate-limited; `400` on bad kind/reaction.

- [ ] **Step 1: Extend imports**

Add to `artifacts/api-server/src/routes/accountability.ts`:

```ts
import { pushSubscriptionsTable } from "@workspace/db";
import { sendPushNotification } from "../lib/push-notifications";
import { isValidKind, isValidReaction, reactionLabel, canSendNudge, type NudgeKind } from "../lib/nudges";
```

(Merge `pushSubscriptionsTable` into the existing `@workspace/db` import line rather than adding a duplicate import.)

- [ ] **Step 2: Add the nudge route**

Add before `export default router;`:

```ts
router.post("/accountability/partners/:id/nudge", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const recipientId = parseInt(raw, 10);
  if (isNaN(recipientId)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (recipientId === userId) { res.status(400).json({ error: "Cannot nudge yourself" }); return; }

  const { kind, reaction, contextType } = req.body as {
    kind?: string; reaction?: string; contextType?: string;
  };
  if (!kind || !isValidKind(kind)) { res.status(400).json({ error: "Invalid nudge kind" }); return; }
  if (!reaction || !isValidReaction(kind, reaction)) {
    res.status(400).json({ error: "Invalid reaction" }); return;
  }

  const partnership = await requireAcceptedPartnership(userId, recipientId);
  if (!partnership) { res.status(403).json({ error: "Not an active ally" }); return; }

  // Rate limit: one nudge of this kind per recipient per local day.
  const timeZone = resolveTimeZone(typeof req.query.tz === "string" ? req.query.tz : undefined);
  const dayStart = new Date(localDateKey(new Date(), timeZone) + "T00:00:00Z");
  const priorToday = await db.select().from(allyNudgesTable).where(
    and(
      eq(allyNudgesTable.senderId, userId),
      eq(allyNudgesTable.recipientId, recipientId),
      eq(allyNudgesTable.kind, kind),
      gte(allyNudgesTable.createdAt, dayStart),
    ),
  );
  if (!canSendNudge(priorToday.length)) {
    res.status(429).json({
      error: kind === "poke" ? "You've already poked this ally today." : "You've already cheered this ally today.",
    });
    return;
  }

  const [nudge] = await db.insert(allyNudgesTable).values({
    senderId: userId,
    recipientId,
    kind,
    reaction,
    contextType: typeof contextType === "string" ? contextType : null,
  }).returning();

  // Best-effort push to the recipient; never blocks persistence.
  const [sender] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const label = reactionLabel(kind as NudgeKind, reaction) ?? "";
  const title = `${sender?.username ?? "An ally"} ${kind === "poke" ? "poked" : "cheered"} you`;
  const subs = await db.select().from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, recipientId));
  for (const sub of subs) {
    const ok = await sendPushNotification(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      { title, body: label, tag: `nudge-${kind}` },
    );
    if (!ok) {
      await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, sub.endpoint));
    }
  }

  res.status(201).json({
    id: nudge.id,
    kind: nudge.kind,
    reaction: nudge.reaction,
    createdAt: nudge.createdAt.toISOString(),
  });
});
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/accountability.ts
git commit -m "feat(api): send poke/cheer nudge with rate limit + best-effort push"
```

---

## Task 7: Inbox + mark-read endpoints

**Files:**
- Modify: `artifacts/api-server/src/routes/accountability.ts` (add two routes)

**Interfaces:**
- Consumes: `allyNudgesTable`, `usersTable`, `formatUserSummary`, `reactionLabel`, `isValidKind`.
- Produces:
  - `GET /accountability/nudges` → array of `{ id, kind, reaction, reactionLabel, contextType, sender, createdAt, readAt }`, newest first (received by the caller).
  - `POST /accountability/nudges/read`, body `{ ids?: number[] }` → `{ success: true, updated: number }`.

- [ ] **Step 1: Add the inbox route**

Add before `export default router;`:

```ts
router.get("/accountability/nudges", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const rows = await db.select().from(allyNudgesTable)
    .where(eq(allyNudgesTable.recipientId, userId))
    .orderBy(desc(allyNudgesTable.createdAt))
    .limit(50);

  const senderIds = [...new Set(rows.map((r) => r.senderId))];
  const senders = senderIds.length
    ? await db.select().from(usersTable).where(inArray(usersTable.id, senderIds))
    : [];
  const senderById = new Map(senders.map((s) => [s.id, s]));

  res.json(rows.map((r) => {
    const sender = senderById.get(r.senderId);
    return {
      id: r.id,
      kind: r.kind,
      reaction: r.reaction,
      reactionLabel: isValidKind(r.kind) ? reactionLabel(r.kind, r.reaction) : null,
      contextType: r.contextType,
      sender: sender ? formatUserSummary(sender) : null,
      createdAt: r.createdAt.toISOString(),
      readAt: r.readAt ? r.readAt.toISOString() : null,
    };
  }));
});
```

- [ ] **Step 2: Add the mark-read route**

Add before `export default router;`:

```ts
router.post("/accountability/nudges/read", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { ids } = req.body as { ids?: number[] };
  const now = new Date();

  const scope = Array.isArray(ids) && ids.length > 0
    ? and(
        eq(allyNudgesTable.recipientId, userId),
        inArray(allyNudgesTable.id, ids.filter((n) => Number.isInteger(n))),
      )
    : eq(allyNudgesTable.recipientId, userId);

  const updated = await db.update(allyNudgesTable)
    .set({ readAt: now })
    .where(and(scope, isNull(allyNudgesTable.readAt)))
    .returning({ id: allyNudgesTable.id });

  res.json({ success: true, updated: updated.length });
});
```

- [ ] **Step 3: Add `isNull` to the drizzle-orm import**

Update the import line to include `isNull`:

```ts
import { eq, or, and, desc, inArray, gte, isNull } from "drizzle-orm";
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/accountability.ts
git commit -m "feat(api): ally nudge inbox + mark-read endpoints"
```

---

## Task 8: Augment the partners list with progress + freshness + sent flags

**Files:**
- Modify: `artifacts/api-server/src/routes/accountability.ts` (the existing `GET /accountability/partners` handler, lines ~23-47)

**Interfaces:**
- Consumes: `hasFreshMilestone` (Task 3), `MILESTONE_TYPES`, `tasksTable`, `activityTable`, `allyNudgesTable`, `resolveTimeZone`/`localDateKey`.
- Produces: each accepted partnership entry additionally carries `progress: { questsDueToday, questsCompletedToday, allDoneToday }`, `hasFreshMilestone: boolean`, `sentTodayPoke: boolean`, `sentTodayCheer: boolean`. Pending/declined entries carry these as `null`/`false`.

- [ ] **Step 1: Add `hasFreshMilestone` to imports**

```ts
import { MILESTONE_TYPES, hasFreshMilestone } from "../lib/ally-milestones";
```

(Replace the Task 5 `MILESTONE_TYPES`-only import with this combined one.)

- [ ] **Step 2: Rewrite the list handler**

Replace the `GET /accountability/partners` handler body:

```ts
router.get("/accountability/partners", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const timeZone = resolveTimeZone(typeof req.query.tz === "string" ? req.query.tz : undefined);
  const now = new Date();
  const today = localDateKey(now, timeZone);
  const dayStart = new Date(today + "T00:00:00Z");

  const partnerships = await db.select().from(partnershipsTable)
    .where(or(
      eq(partnershipsTable.requesterId, userId),
      eq(partnershipsTable.recipientId, userId),
    ));

  const result = await Promise.all(partnerships.map(async (p) => {
    const partnerId = p.requesterId === userId ? p.recipientId : p.requesterId;
    const [partner] = await db.select().from(usersTable).where(eq(usersTable.id, partnerId));

    let progress: { questsDueToday: number; questsCompletedToday: number; allDoneToday: boolean } | null = null;
    let freshMilestone = false;
    let sentTodayPoke = false;
    let sentTodayCheer = false;

    if (p.status === "accepted") {
      const todayTasks = await db.select().from(tasksTable)
        .where(and(eq(tasksTable.userId, partnerId), eq(tasksTable.dueDate, today)));
      const due = todayTasks.length;
      const done = todayTasks.filter((t) => t.completed).length;
      progress = { questsDueToday: due, questsCompletedToday: done, allDoneToday: due > 0 && done === due };

      const recentActivity = await db.select().from(activityTable)
        .where(and(
          eq(activityTable.userId, partnerId),
          inArray(activityTable.type, [...MILESTONE_TYPES]),
        ))
        .orderBy(desc(activityTable.createdAt))
        .limit(10);
      freshMilestone = hasFreshMilestone(recentActivity, now, 48);

      const flags = await sentTodayFlags(userId, partnerId, dayStart);
      sentTodayPoke = flags.sentTodayPoke;
      sentTodayCheer = flags.sentTodayCheer;
    }

    return {
      id: p.id,
      requesterId: p.requesterId,
      recipientId: p.recipientId,
      status: p.status,
      partner: partner ? formatUserSummary(partner) : null,
      createdAt: p.createdAt.toISOString(),
      progress,
      hasFreshMilestone: freshMilestone,
      sentTodayPoke,
      sentTodayCheer,
    };
  }));

  res.json(result);
});
```

- [ ] **Step 3: Typecheck + full api-server test run**

Run: `pnpm typecheck` and `pnpm --filter @workspace/api-server test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/accountability.ts
git commit -m "feat(api): enrich partners list with progress, milestones, sent flags"
```

---

## Task 9: OpenAPI spec + client codegen

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (paths under accountability; new schemas; augment `Partnership`)

**Interfaces:**
- Produces (generated hooks in `@workspace/api-client-react`): `useGetPartnerDetail`, `useSendNudge`, `useGetNudges`, `useMarkNudgesRead`, plus augmented `Partnership` type with `progress`, `hasFreshMilestone`, `sentTodayPoke`, `sentTodayCheer`.

- [ ] **Step 1: Add the new paths**

In `lib/api-spec/openapi.yaml`, immediately after the `/accountability/partners/{id}/feed` block (ends at line ~957), add:

```yaml
  /accountability/partners/{id}/detail:
    get:
      operationId: getPartnerDetail
      tags: [accountability]
      summary: Expanded ally profile (hero, badges, progress, milestones)
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
        - name: tz
          in: query
          schema:
            type: string
      responses:
        "200":
          description: Ally detail
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AllyDetail"

  /accountability/partners/{id}/nudge:
    post:
      operationId: sendNudge
      tags: [accountability]
      summary: Send a poke or cheer to an ally
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/NudgeInput"
      responses:
        "201":
          description: Nudge sent
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SentNudge"

  /accountability/nudges:
    get:
      operationId: getNudges
      tags: [accountability]
      summary: List nudges received by the current user
      responses:
        "200":
          description: Received nudges
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/Nudge"

  /accountability/nudges/read:
    post:
      operationId: markNudgesRead
      tags: [accountability]
      summary: Mark received nudges as read
      requestBody:
        required: false
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/MarkNudgesReadInput"
      responses:
        "200":
          description: Marked read
          content:
            application/json:
              schema:
                type: object
                required: [success, updated]
                properties:
                  success: { type: boolean }
                  updated: { type: integer }
```

- [ ] **Step 2: Augment the `Partnership` schema**

In `lib/api-spec/openapi.yaml`, inside the `Partnership` schema (`properties:` block, after `createdAt` at line ~1841), add:

```yaml
        progress:
          $ref: "#/components/schemas/AllyProgress"
        hasFreshMilestone:
          type: boolean
        sentTodayPoke:
          type: boolean
        sentTodayCheer:
          type: boolean
```

- [ ] **Step 3: Add the new schemas**

Add after the `PartnerRequestInput` schema (line ~1848):

```yaml
    AllyProgress:
      type: object
      required: [questsDueToday, questsCompletedToday, allDoneToday]
      properties:
        questsDueToday:
          type: integer
        questsCompletedToday:
          type: integer
        allDoneToday:
          type: boolean

    HeroLook:
      type: object
      required: [avatarColor, avatarClass, avatarSkin, level, battlePower, equippedGear]
      properties:
        avatarColor: { type: string }
        avatarClass: { type: string }
        avatarSkin: { type: string }
        avatarHairStyle: { type: string }
        avatarHairColor: { type: string }
        avatarBodyBuild: { type: string }
        avatarFace: { type: string }
        avatarBeardStyle: { type: string }
        avatarBeardColor: { type: string }
        avatarGlasses: { type: string }
        avatarEarrings: { type: string }
        level: { type: integer }
        battlePower: { type: integer }
        equippedGear:
          type: array
          items:
            $ref: "#/components/schemas/EquippedGearItem"

    AllyDetail:
      type: object
      required: [partner, progress, badges, milestones, sentTodayPoke, sentTodayCheer]
      properties:
        partner:
          $ref: "#/components/schemas/UserSummary"
        progress:
          $ref: "#/components/schemas/AllyProgress"
        hero:
          $ref: "#/components/schemas/HeroLook"
        badges:
          type: array
          items:
            $ref: "#/components/schemas/UserBadge"
        milestones:
          type: array
          items:
            $ref: "#/components/schemas/ActivityItem"
        sentTodayPoke:
          type: boolean
        sentTodayCheer:
          type: boolean

    NudgeInput:
      type: object
      required: [kind, reaction]
      properties:
        kind:
          type: string
          enum: [poke, cheer]
        reaction:
          type: string
        contextType:
          type: string

    SentNudge:
      type: object
      required: [id, kind, reaction, createdAt]
      properties:
        id: { type: integer }
        kind:
          type: string
          enum: [poke, cheer]
        reaction: { type: string }
        createdAt: { type: string }

    Nudge:
      type: object
      required: [id, kind, reaction, createdAt, readAt]
      properties:
        id: { type: integer }
        kind:
          type: string
          enum: [poke, cheer]
        reaction: { type: string }
        reactionLabel:
          type: ["string", "null"]
        contextType:
          type: ["string", "null"]
        sender:
          $ref: "#/components/schemas/UserSummary"
        createdAt: { type: string }
        readAt:
          type: ["string", "null"]

    MarkNudgesReadInput:
      type: object
      properties:
        ids:
          type: array
          items:
            type: integer
```

- [ ] **Step 4: Regenerate the client**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: files under `lib/api-client-react/src/generated` and `lib/api-zod/src/generated` regenerate with new hooks/types. Do not hand-edit them.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (generated code compiles).

- [ ] **Step 6: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "feat(api-spec): ally detail, nudge, inbox endpoints + generated client"
```

---

## Task 10: Client reaction registry + nudge picker component

**Files:**
- Create: `artifacts/focusquest/src/lib/nudge-reactions.ts`
- Create: `artifacts/focusquest/src/components/nudge-picker.tsx`

**Interfaces:**
- Consumes: `useSendNudge` (Task 9), `Popover` (shadcn — verify it exists at `@/components/ui/popover`; if absent, install via the shadcn CLI as used elsewhere), `useToast`, `browserTimeZone` (`@/lib/timezone`).
- Produces:
  - `nudge-reactions.ts`: `POKE_REACTIONS` / `CHEER_REACTIONS` (`{ key, label }[]`) and `reactionsFor(kind)`.
  - `<NudgePicker partnerId kind disabled onSent />` — a button that opens a popover of that kind's reactions and sends the chosen one.

- [ ] **Step 1: Create the client reaction registry**

Create `artifacts/focusquest/src/lib/nudge-reactions.ts` (mirrors the server keys — keys MUST match `artifacts/api-server/src/lib/nudges.ts`):

```ts
export type NudgeKind = "poke" | "cheer";
export interface NudgeReaction { key: string; label: string; }

export const POKE_REACTIONS: NudgeReaction[] = [
  { key: "get_moving",        label: "Get moving! 💪" },
  { key: "dont_break_streak", label: "Don't break the streak! 🔥" },
  { key: "still_time",        label: "Still time today! ⏳" },
  { key: "checking_in",       label: "Checking in on you 👀" },
];

export const CHEER_REACTIONS: NudgeReaction[] = [
  { key: "crushing_it",    label: "You're crushing it! 🎉" },
  { key: "nice_level",     label: "Level up! Nice! ⭐" },
  { key: "streak_respect", label: "Streak respect 🔥" },
  { key: "proud",          label: "Proud of you! 🙌" },
];

export function reactionsFor(kind: NudgeKind): NudgeReaction[] {
  return kind === "poke" ? POKE_REACTIONS : CHEER_REACTIONS;
}
```

- [ ] **Step 2: Confirm the Popover primitive exists**

Run: `ls artifacts/focusquest/src/components/ui/popover.tsx`
Expected: exists (used elsewhere, e.g. quick-add). If it does NOT exist, add it with the project's shadcn setup before continuing (`npx shadcn@latest add popover` from `artifacts/focusquest`).

- [ ] **Step 3: Create the picker component**

Create `artifacts/focusquest/src/components/nudge-picker.tsx`:

```tsx
import { useState } from "react";
import { useSendNudge, getGetPartnersQueryKey } from "@workspace/api-client-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { reactionsFor, type NudgeKind } from "@/lib/nudge-reactions";
import { Hand, PartyPopper } from "lucide-react";

/** Pull a human-readable message out of an API error, falling back if absent. */
function nudgeError(err: unknown, fallback: string): string {
  const data = (err as { data?: unknown } | null)?.data;
  if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") {
    return (data as { error: string }).error;
  }
  return fallback;
}

export function NudgePicker({
  partnerId, kind, disabled, emphasized, onSent,
}: {
  partnerId: number;
  kind: NudgeKind;
  disabled?: boolean;
  emphasized?: boolean;
  onSent?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const sendNudge = useSendNudge();

  const label = kind === "poke" ? "Poke" : "Cheer";
  const Icon = kind === "poke" ? Hand : PartyPopper;

  const handlePick = (reaction: string) => {
    sendNudge.mutate({ id: partnerId, data: { kind, reaction } }, {
      onSuccess: () => {
        toast({ title: kind === "poke" ? "Poke sent!" : "Cheer sent!" });
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: getGetPartnersQueryKey() });
        onSent?.();
      },
      onError: (err) => {
        setOpen(false);
        toast({ title: "Couldn't send", description: nudgeError(err, "Please try again."), variant: "destructive" });
      },
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant={emphasized ? "default" : "outline"}
          disabled={disabled || sendNudge.isPending}
          className={emphasized ? "" : "border-primary/40 text-primary hover:bg-primary/10"}
        >
          <Icon className="w-4 h-4 mr-1.5" /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1.5">
        <div className="flex flex-col gap-1">
          {reactionsFor(kind).map((r) => (
            <button
              key={r.key}
              onClick={() => handlePick(r.key)}
              disabled={sendNudge.isPending}
              className="text-left text-sm px-3 py-2 rounded-md hover:bg-muted transition-colors disabled:opacity-50"
            >
              {r.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @workspace/focusquest typecheck` (or `pnpm typecheck`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/lib/nudge-reactions.ts artifacts/focusquest/src/components/nudge-picker.tsx
git commit -m "feat(ui): nudge reaction registry + poke/cheer picker component"
```

---

## Task 11: Ally card — progress + contextual poke/cheer + link to detail

**Files:**
- Modify: `artifacts/focusquest/src/pages/partners.tsx` (the `activePartners.map` card block, lines ~124-138; imports)

**Interfaces:**
- Consumes: `NudgePicker` (Task 10), `Link` from `wouter`, augmented `Partnership` fields (`progress`, `hasFreshMilestone`, `sentTodayPoke`, `sentTodayCheer`) from Task 9.

- [ ] **Step 1: Add imports**

At the top of `artifacts/focusquest/src/pages/partners.tsx`, add:

```tsx
import { Link } from "wouter";
import { NudgePicker } from "@/components/nudge-picker";
```

- [ ] **Step 2: Replace the active-partner card**

Replace the `<Card>` block inside `activePartners.map(p => ( ... ))` (lines ~125-137) with:

```tsx
<Card key={p.id} className="bg-card border-border hover:border-primary/50 transition-colors">
  <CardContent className="p-6">
    <Link href={`/partners/${p.partner?.id}`} className="block text-center cursor-pointer">
      <div className="w-16 h-16 bg-muted rounded-full mx-auto mb-4 flex items-center justify-center text-2xl font-bold text-muted-foreground border-2 border-primary/20">
        {p.partner?.username.charAt(0).toUpperCase()}
      </div>
      <h3 className="font-bold text-lg">{p.partner?.username}</h3>
      <p className="text-sm text-primary font-medium">{p.partner?.levelName}</p>
    </Link>

    <div className="mt-4 pt-4 border-t border-border flex justify-around text-sm text-muted-foreground">
      <div><span className="font-bold text-foreground block">{p.partner?.totalPoints}</span>XP</div>
      <div><span className="font-bold text-foreground block">{p.partner?.streakDays}</span>Streak</div>
      {p.progress && (
        <div>
          <span className="font-bold text-foreground block">
            {p.progress.questsCompletedToday}/{p.progress.questsDueToday}
          </span>
          Today
        </div>
      )}
    </div>

    <div className="mt-4 flex justify-center gap-2">
      <NudgePicker
        partnerId={p.partner!.id}
        kind="poke"
        disabled={p.sentTodayPoke}
        emphasized={!!p.progress && !p.progress.allDoneToday && p.progress.questsDueToday > 0}
      />
      <NudgePicker
        partnerId={p.partner!.id}
        kind="cheer"
        disabled={p.sentTodayCheer}
        emphasized={p.hasFreshMilestone}
      />
    </div>
  </CardContent>
</Card>
```

- [ ] **Step 3: Verify in the browser (see Task 14 for launch)**

Load the running app, go to `/partners`, confirm each active ally card shows "done/due Today", both Poke and Cheer buttons render, and the contextually-fitting one is filled/emphasized. Sending disables that button and toasts.

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm typecheck`
```bash
git add artifacts/focusquest/src/pages/partners.tsx
git commit -m "feat(ui): ally card progress + contextual poke/cheer + detail link"
```

---

## Task 12: Ally info screen route `/partners/:id`

**Files:**
- Create: `artifacts/focusquest/src/pages/partner-detail.tsx`
- Modify: `artifacts/focusquest/src/App.tsx:22` (import) and `:158` (route)

**Interfaces:**
- Consumes: `useGetPartnerDetail` (Task 9), `PixelHero` (`@/components/pixel-hero`), `HeroLook` type mapping (mirror `avatar.tsx:472-491`), `NudgePicker` (Task 10), `browserTimeZone`, wouter `useParams`/`useRoute`.

- [ ] **Step 1: Create the detail page**

Create `artifacts/focusquest/src/pages/partner-detail.tsx`:

```tsx
import { useRoute, Link } from "wouter";
import { useGetPartnerDetail } from "@workspace/api-client-react";
import { browserTimeZone } from "@/lib/timezone";
import { PixelHero } from "@/components/pixel-hero";
import { NudgePicker } from "@/components/nudge-picker";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Trophy } from "lucide-react";
import type {
  HeroLook, Skin, Build, HairStyle, HairColor, FaceId, AvatarClass, EquippedGearLook,
} from "@/lib/hero/types";

const MILESTONE_ICON: Record<string, string> = {
  level_up: "⭐", badge_earned: "🏅", streak_milestone: "🔥", all_day_bonus: "🎯",
};

export default function PartnerDetail() {
  const [, params] = useRoute("/partners/:id");
  const partnerId = params ? parseInt(params.id, 10) : NaN;

  const { data, isLoading, error } = useGetPartnerDetail(
    partnerId,
    { tz: browserTimeZone() },
    { query: { enabled: Number.isInteger(partnerId), queryKey: ["partnerDetail", partnerId] } },
  );

  if (isLoading) {
    return <div className="text-center py-20 text-primary animate-pulse">Loading ally…</div>;
  }
  if (error || !data) {
    return (
      <div className="text-center py-20 space-y-4">
        <p className="text-muted-foreground">Couldn't load this ally.</p>
        <Link href="/partners" className="text-primary underline">Back to allies</Link>
      </div>
    );
  }

  const h = data.hero;
  const heroLook: HeroLook | null = h ? {
    skin: (h.avatarSkin ?? "light") as Skin,
    build: (h.avatarBodyBuild ?? "male") as Build,
    hairStyle: (h.avatarHairStyle ?? "short") as HairStyle,
    hairColor: (h.avatarHairColor ?? "brown") as HairColor,
    face: (h.avatarFace ?? "neutral") as FaceId,
    beardStyle: (h.avatarBeardStyle ?? "none") as HeroLook["beardStyle"],
    beardColor: (h.avatarBeardColor ?? "brown") as HeroLook["beardColor"],
    glasses: (h.avatarGlasses ?? "none") as HeroLook["glasses"],
    earrings: (h.avatarEarrings ?? "none") as HeroLook["earrings"],
    avatarClass: (h.avatarClass ?? "fighter") as AvatarClass,
    tier: Math.min(3, Math.floor(((h.level ?? 1) - 1) / 10)) as 0 | 1 | 2 | 3,
    equipped: (h.equippedGear ?? [])
      .filter((g) => g.spriteId)
      .map((g) => ({
        slot: g.slot as EquippedGearLook["slot"],
        spriteId: g.spriteId as string,
        rarity: g.rarity as EquippedGearLook["rarity"],
      })),
  } : null;

  const behind = data.progress.questsDueToday > 0 && !data.progress.allDoneToday;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-3xl mx-auto">
      <Link href="/partners" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Allies
      </Link>

      {/* Header: hero + identity + actions */}
      <Card className="bg-card border-border">
        <CardContent className="p-6 flex flex-col sm:flex-row items-center gap-6">
          <div className="shrink-0">
            {heroLook
              ? <PixelHero look={heroLook} size={140} />
              : <div className="w-[140px] h-[140px] rounded-xl bg-muted flex items-center justify-center text-4xl font-bold text-muted-foreground">
                  {data.partner.username.charAt(0).toUpperCase()}
                </div>}
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h1 className="text-2xl font-bold">{data.partner.username}</h1>
            <p className="text-primary font-medium">Lv. {data.partner.currentLevel} • {data.partner.levelName}</p>
            <div className="mt-3 flex justify-center sm:justify-start gap-6 text-sm text-muted-foreground">
              <div><span className="font-bold text-foreground block">{data.partner.totalPoints}</span>XP</div>
              <div><span className="font-bold text-foreground block">{data.partner.streakDays}</span>Streak</div>
              <div>
                <span className="font-bold text-foreground block">
                  {data.progress.questsCompletedToday}/{data.progress.questsDueToday}
                </span>Today
              </div>
            </div>
            <div className="mt-4 flex justify-center sm:justify-start gap-2">
              <NudgePicker partnerId={partnerId} kind="poke" disabled={data.sentTodayPoke} emphasized={behind} />
              <NudgePicker partnerId={partnerId} kind="cheer" disabled={data.sentTodayCheer} emphasized={data.milestones.length > 0} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Badges */}
      <div>
        <h2 className="text-lg font-bold mb-3 flex items-center gap-2"><Trophy className="w-5 h-5 text-primary" /> Badges ({data.badges.length})</h2>
        {data.badges.length === 0 ? (
          <p className="text-muted-foreground text-sm">No badges earned yet.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {data.badges.map((ub) => (
              <div key={ub.badge.id} className="text-center p-3 bg-card border border-border rounded-xl">
                <div className="text-2xl mb-1">{ub.badge.icon}</div>
                <div className="text-xs font-semibold truncate">{ub.badge.name}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent milestones */}
      <div>
        <h2 className="text-lg font-bold mb-3">Recent milestones</h2>
        {data.milestones.length === 0 ? (
          <p className="text-muted-foreground text-sm">No milestones yet.</p>
        ) : (
          <div className="space-y-2">
            {data.milestones.map((m) => (
              <div key={m.id} className="flex items-center gap-3 p-3 bg-card border border-border rounded-lg">
                <span className="text-xl">{MILESTONE_ICON[m.type] ?? "✨"}</span>
                <span className="text-sm">{m.description}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register the route in App.tsx**

In `artifacts/focusquest/src/App.tsx`, add the import alongside the other page imports (after line 17):

```tsx
import PartnerDetail from "@/pages/partner-detail";
```

Then add the route **before** `<Route path="/partners" component={Partners} />` (so the more specific path is matched first is not required with wouter `Switch`, but keep detail above list for clarity):

```tsx
<Route path="/partners/:id" component={PartnerDetail} />
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/focusquest/src/pages/partner-detail.tsx artifacts/focusquest/src/App.tsx
git commit -m "feat(ui): ally info screen with hero, badges, milestones"
```

---

## Task 13: Nudge Inbox tab + unread badges

**Files:**
- Modify: `artifacts/focusquest/src/pages/partners.tsx` (add Inbox tab + trigger; imports)
- Modify: `artifacts/focusquest/src/components/layout.tsx:159` (unread badge on Allies nav item)

**Interfaces:**
- Consumes: `useGetNudges`, `useMarkNudgesRead`, `getGetNudgesQueryKey` (Task 9).
- Produces: an "Inbox" tab listing received nudges; opening it marks all read. An unread count derived from `nudges.filter(n => !n.readAt)`.

- [ ] **Step 1: Add imports to partners.tsx**

```tsx
import { useGetNudges, useMarkNudgesRead, getGetNudgesQueryKey } from "@workspace/api-client-react";
import { Bell } from "lucide-react";
```

- [ ] **Step 2: Fetch nudges and derive unread count**

Inside `Partners()`, after the existing query hooks (after line ~42):

```tsx
const { data: nudges } = useGetNudges({ query: { queryKey: ["nudges"] } });
const markRead = useMarkNudgesRead();
const unreadCount = (nudges ?? []).filter((n) => !n.readAt).length;

const handleOpenInbox = (value: string) => {
  if (value === "inbox" && unreadCount > 0) {
    markRead.mutate({ data: {} }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetNudgesQueryKey() }),
    });
  }
};
```

- [ ] **Step 3: Wire the tab change handler + add the Inbox trigger**

Change the `<Tabs defaultValue="allies" ...>` opening tag to include `onValueChange={handleOpenInbox}`. Then add a new trigger inside `<TabsList>` after the "Find Allies" trigger (line ~112):

```tsx
<TabsTrigger value="inbox" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary rounded-md">
  Inbox {unreadCount > 0 && <span className="ml-2 bg-destructive text-destructive-foreground px-2 py-0.5 rounded-full text-xs">{unreadCount}</span>}
</TabsTrigger>
```

- [ ] **Step 4: Add the Inbox tab content**

Add after the closing `</TabsContent>` of the "find" tab (line ~221):

```tsx
<TabsContent value="inbox" className="mt-6 space-y-3">
  {(nudges ?? []).length === 0 ? (
    <div className="text-center py-16 text-muted-foreground">
      <Bell className="w-10 h-10 mx-auto mb-3 opacity-40" />
      No nudges yet. Your allies' pokes and cheers will show up here.
    </div>
  ) : (
    (nudges ?? []).map((n) => (
      <div key={n.id} className={`flex items-center gap-4 p-4 rounded-xl border ${n.readAt ? "bg-card border-border" : "bg-primary/5 border-primary/30"}`}>
        <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center font-bold shrink-0">
          {n.sender?.username.charAt(0).toUpperCase() ?? "?"}
        </div>
        <div className="flex-1">
          <p className="text-sm">
            <span className="font-bold">{n.sender?.username ?? "An ally"}</span>
            {" "}{n.kind === "poke" ? "poked you" : "cheered you"}
          </p>
          <p className="text-sm text-muted-foreground">{n.reactionLabel ?? n.reaction}</p>
        </div>
      </div>
    ))
  )}
</TabsContent>
```

- [ ] **Step 5: Unread badge on the Allies nav item**

In `artifacts/focusquest/src/components/layout.tsx`, the nav renders `allNavItems`. Add a small unread indicator on the `/partners` item. At the top of the `Layout` component body, fetch nudges and compute unread:

```tsx
import { useGetNudges } from "@workspace/api-client-react";
// ...inside Layout(), near other hooks:
const { data: navNudges } = useGetNudges({ query: { queryKey: ["nudges"] } });
const allyUnread = (navNudges ?? []).filter((n) => !n.readAt).length;
```

Then, in BOTH the desktop nav map (line ~219) and the mobile nav map (line ~274), when `item.href === "/partners"` and `allyUnread > 0`, render a badge dot. Inside each mapped link, after the icon, add:

```tsx
{item.href === "/partners" && allyUnread > 0 && (
  <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[10px] min-w-4 h-4 px-1 rounded-full flex items-center justify-center">
    {allyUnread}
  </span>
)}
```

Ensure the link/anchor is `relative`-positioned so the absolute badge anchors to it (add `relative` to its className if not present).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/focusquest/src/pages/partners.tsx artifacts/focusquest/src/components/layout.tsx
git commit -m "feat(ui): nudge inbox tab + unread badges on Allies nav"
```

---

## Task 14: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Ensure `.claude/launch.json` has a dev server entry**

Check for a config that runs both the API and the web app (or the web app proxying to the API). If none exists, create one that starts the focusquest dev server. Then start it via the preview tool (NOT `pnpm` in Bash).

- [ ] **Step 2: Run the full test + typecheck gate**

Run:
```bash
pnpm --filter @workspace/api-server test
pnpm typecheck
```
Expected: all PASS.

- [ ] **Step 3: Exercise the flow in the browser**

With two allied test accounts (or a seeded accepted partnership):
1. `/partners` — active ally card shows "done/due Today", Poke + Cheer buttons; the contextually-fitting one is emphasized.
2. Click Poke → pick a reaction → toast "Poke sent!", button disables. Re-clicking after reload → toast with the 429 message ("already poked today").
3. Click an ally card → `/partners/:id` renders their `PixelHero`, badges grid, and recent milestones; Poke/Cheer work here too.
4. As the *recipient* account: the Allies nav item shows an unread badge; open `/partners` → Inbox tab shows the nudge; opening the tab clears the unread badge.
5. Confirm the ally detail response contains no task titles (only counts) — check the network response for `/accountability/partners/:id/detail`.

- [ ] **Step 4: Capture proof + final check**

Screenshot the ally detail screen and the Inbox with a received nudge. Confirm no console/network errors.

---

## Self-Review Notes (for the implementer)

- **Route path choice:** ally detail is `/accountability/partners/{id}/detail` (not bare `/{id}`) to avoid colliding with existing `/{id}/accept|decline|feed` handlers.
- **Timezone caveat:** ally "today" is computed with the *requester's* tz (the app has no stored per-user tz). Cross-timezone allies may see progress off by up to a day. Acceptable for v1; matches the existing caller-supplied-tz pattern.
- **Registry duplication:** the reaction registry exists on both server (`lib/nudges.ts`, source of truth for validation) and client (`lib/nudge-reactions.ts`, for the picker). Keys MUST stay in sync; there are only 8. If this ever grows, promote to a shared `@workspace/*` package.
- **`hero` may be null** in `AllyDetail` if the partner row vanished mid-request; the detail page renders an initial-letter fallback.
