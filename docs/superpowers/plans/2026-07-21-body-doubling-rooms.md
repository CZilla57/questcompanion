# Body-Doubling Rooms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Act IV's final quest — ally co-working rooms with ambient presence, optional shared sprints, and an exactly-once together-bonus — on polling + web push + server-anchored timestamps (zero new infra).

**Architecture:** Three additive tables (`body_double_rooms`/`_members`/`_sprints`); a pure decision lib mirroring the hyperfocus/envelope style; one Express route file reusing accountability's partnership guard and the focus-session critical-section grammar; a one-UPDATE cron sweep; OpenAPI + orval codegen; a Body Double card on the Focus page polling at 10 s (room) / 30 s (list) where **the poll is the heartbeat**.

**Tech Stack:** Drizzle + Neon Postgres, Express 5, OpenAPI→orval→TanStack Query, React + Tailwind, vitest.

**Spec:** `docs/superpowers/specs/2026-07-21-body-doubling-rooms-design.md` (D1–D5 approved via PR #80).

## Global Constraints

- Anti-shame copy verbatim where given: ended-room join → "This room has wrapped up"; no "0 allies joined" anywhere; stale presence renders as **heads-down (positive)**, never "away"/"idle".
- Payout eligibility = `left_at IS NULL` — NEVER heartbeat freshness (locked-phone workers get paid).
- XP writes additive-only (`totalPoints`/`weeklyPoints` increments; `currentLevel` column stays write-only). No coins, no `CoinReason` changes, no envelope state writes (`pushes_sent_*`/`last_push_at` untouched).
- Sprint minutes ∈ {15, 25, 50} only. Bonus = existing `computeIntervalXp(minutes)` (15→8, 25→10, 50→15 XP). Requires ≥ 2 eligible members; solo completion pays 0 quietly.
- Derived-not-stored: sprint end time is always `started_at + minutes`; presence is derived at read.
- Migration is additive-only, generated via `pnpm --filter @workspace/db generate --name body_double` (NEVER `drizzle-kit push` — it's removed).
- Commands that need the DB: `export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\r')"` first (CRLF checkout gotcha). `generate`/`check` run offline with the placeholder URL.
- Never hand-edit `*/src/generated` — regen via `pnpm --filter @workspace/api-spec codegen`.
- Branch: `feat/body-double-impl` off main @ ≥ 49d05bb (spec merge).

---

### Task 1: Schema + migration `0004_body_double`

**Files:**
- Create: `lib/db/src/schema/body-double.ts`
- Modify: `lib/db/src/schema/index.ts` (add one export line)
- Generated: `lib/db/drizzle/0004_body_double.sql` + `lib/db/drizzle/meta/*` (commit both)

**Interfaces:**
- Produces: `bodyDoubleRoomsTable`, `bodyDoubleMembersTable`, `bodyDoubleSprintsTable`, types `BodyDoubleRoom`, `BodyDoubleMember`, `BodyDoubleSprint` — all exported from `@workspace/db`.

- [ ] **Step 1: Write the schema file**

`lib/db/src/schema/body-double.ts`:

```ts
import { pgTable, serial, integer, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

// Act IV Body-Doubling Rooms. A room is an open door: accepted allies of the
// host may drop in and co-work with ambient presence. All FKs to users cascade
// so the account-delete schema walk stays FK-safe.
export const bodyDoubleRoomsTable = pgTable("body_double_rooms", {
  id: serial("id").primaryKey(),
  hostId: integer("host_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("open"), // 'open' | 'ended'
  createdAt: timestamp("created_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
});

export const bodyDoubleMembersTable = pgTable("body_double_members", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull().references(() => bodyDoubleRoomsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
  // The ONLY "gone" signal — presence staleness never means "left" (anti-shame:
  // a locked phone is a body double working, not a body double gone).
  leftAt: timestamp("left_at"),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(), // touched by the state poll
  lastWaveAt: timestamp("last_wave_at"),
}, (t) => [
  // Rejoin = clear left_at on the existing row, never a second row.
  unique("body_double_members_room_user_unique").on(t.roomId, t.userId),
]);

export const bodyDoubleSprintsTable = pgTable("body_double_sprints", {
  id: serial("id").primaryKey(),
  roomId: integer("room_id").notNull().references(() => bodyDoubleRoomsTable.id, { onDelete: "cascade" }),
  minutes: integer("minutes").notNull(), // ∈ {15, 25, 50}
  startedBy: integer("started_by").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  // Null = live. Setting it is the exactly-once payout claim (world-boss grammar).
  completedAt: timestamp("completed_at"),
}, (t) => [
  // One live sprint per room: the partial unique makes the INSERT the guard.
  uniqueIndex("body_double_sprints_live_room_unique").on(t.roomId).where(sql`${t.completedAt} IS NULL`),
]);

export type BodyDoubleRoom = typeof bodyDoubleRoomsTable.$inferSelect;
export type BodyDoubleMember = typeof bodyDoubleMembersTable.$inferSelect;
export type BodyDoubleSprint = typeof bodyDoubleSprintsTable.$inferSelect;
```

- [ ] **Step 2: Export from the schema index**

In `lib/db/src/schema/index.ts`, append after the `kingdom-points` line:

```ts
export * from "./body-double";
```

- [ ] **Step 3: Generate the migration (offline)**

```bash
cd lib/db
DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" pnpm --filter @workspace/db generate --name body_double
```

Expected: `lib/db/drizzle/0004_body_double.sql` created. Review it: exactly 3 `CREATE TABLE`, the composite unique on members, `CREATE UNIQUE INDEX ... WHERE "completed_at" is null` on sprints, FKs with cascade. **Nothing else** (no ALTERs of existing tables — if any appear, stop and investigate).

- [ ] **Step 4: Validate history + typecheck libs**

```bash
DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" pnpm --filter @workspace/db check
pnpm run typecheck:libs
```

Expected: both clean. (Stale `lib/db` composite dist causes phantom type errors — `typecheck:libs` rebuilds it.)

- [ ] **Step 5: Check the account-delete schema walk**

Grep the q7 delete implementation (`grep -rn "body_double\|schema-walk\|deleteAccount" artifacts/api-server/src/routes/users.ts artifacts/api-server/src/lib/`) — if it enumerates tables explicitly, add the three new tables in FK-safe order (sprints → members → rooms, before users); if it derives the order from schema/cascades, no change. Its guard test in the api suite must pass in Task 7.

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/schema/body-double.ts lib/db/src/schema/index.ts lib/db/drizzle/
git commit -m "feat(db): body-double rooms/members/sprints schema + migration 0004"
```

(Applying to Neon happens in Task 7, right before the PR.)

---

### Task 2: Pure decision lib + tests

**Files:**
- Create: `artifacts/api-server/src/lib/body-double.ts`
- Test: `artifacts/api-server/src/lib/body-double.test.ts`

**Interfaces:**
- Consumes: `GRACE_SECONDS`, `computeIntervalXp` from `./focus-sessions`; `resolveTimeZone`, `localHour` from `./date-buckets`; `inQuietHours`, `DEEP_NIGHT_START`, `DEEP_NIGHT_END` from `./notification-envelope`.
- Produces (Task 3/4 rely on these exact names):
  `HERE_THRESHOLD_SEC=45`, `WAVE_MIN_GAP_SEC=15`, `SWEEP_STALE_MIN=90`, `SWEEP_MAX_AGE_HOURS=12`, `SPRINT_MINUTES=[15,25,50]`, `type SprintMinutes`, `type Presence = "here" | "headsDown"`,
  `presenceOf(lastSeenAt: Date, now: Date): Presence`,
  `isSprintMinutes(m: unknown): m is SprintMinutes`,
  `sprintElapsedOk(startedAt: Date, minutes: number, now: Date): boolean`,
  `sprintBonusXp(minutes: number): number`,
  `eligibleMembers<T extends {leftAt: Date|null}>(members: T[]): T[]`,
  `canWave(lastWaveAt: Date|null, now: Date): boolean`,
  `shouldSweepRoom(createdAt: Date, memberLastSeens: Date[], now: Date): boolean`,
  `shouldSendInvitePush(recipient: {timezone: string|null; quietHoursStart: number; quietHoursEnd: number}, now: Date): boolean`.

- [ ] **Step 1: Write the failing tests**

`artifacts/api-server/src/lib/body-double.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  HERE_THRESHOLD_SEC, WAVE_MIN_GAP_SEC, SWEEP_STALE_MIN, SWEEP_MAX_AGE_HOURS,
  presenceOf, isSprintMinutes, sprintElapsedOk, sprintBonusXp,
  eligibleMembers, canWave, shouldSweepRoom, shouldSendInvitePush,
} from "./body-double";

const T0 = new Date("2026-07-21T15:00:00Z");
const secAgo = (s: number) => new Date(T0.getTime() - s * 1000);
const minAgo = (m: number) => secAgo(m * 60);

describe("presenceOf", () => {
  it("fresh heartbeat is here", () => {
    expect(presenceOf(secAgo(10), T0)).toBe("here");
  });
  it("boundary is inclusive on here", () => {
    expect(presenceOf(secAgo(HERE_THRESHOLD_SEC), T0)).toBe("here");
  });
  it("stale heartbeat is heads-down (positive state), never absent", () => {
    expect(presenceOf(secAgo(HERE_THRESHOLD_SEC + 1), T0)).toBe("headsDown");
    expect(presenceOf(minAgo(120), T0)).toBe("headsDown");
  });
});

describe("isSprintMinutes", () => {
  it("accepts exactly the preset focus lengths", () => {
    expect(isSprintMinutes(15)).toBe(true);
    expect(isSprintMinutes(25)).toBe(true);
    expect(isSprintMinutes(50)).toBe(true);
  });
  it("rejects everything else", () => {
    for (const bad of [20, 0, -15, 25.5, "25", null, undefined, {}]) {
      expect(isSprintMinutes(bad)).toBe(false);
    }
  });
});

describe("sprintElapsedOk", () => {
  it("rejects an early finish", () => {
    expect(sprintElapsedOk(minAgo(10), 15, T0)).toBe(false);
  });
  it("accepts exact elapsed", () => {
    expect(sprintElapsedOk(minAgo(15), 15, T0)).toBe(true);
  });
  it("honors the focus-session grace window", () => {
    expect(sprintElapsedOk(secAgo(15 * 60 - 5), 15, T0)).toBe(true);  // GRACE_SECONDS = 5
    expect(sprintElapsedOk(secAgo(15 * 60 - 6), 15, T0)).toBe(false);
  });
});

describe("sprintBonusXp", () => {
  it("pays exactly a focus block (D5): 15→8, 25→10, 50→15", () => {
    expect(sprintBonusXp(15)).toBe(8);
    expect(sprintBonusXp(25)).toBe(10);
    expect(sprintBonusXp(50)).toBe(15);
  });
});

describe("eligibleMembers", () => {
  it("eligibility is not-left, NEVER heartbeat freshness", () => {
    const members = [
      { userId: 1, leftAt: null },                 // host, phone locked for an hour — still paid
      { userId: 2, leftAt: minAgo(5) },            // left — not paid
      { userId: 3, leftAt: null },
    ];
    expect(eligibleMembers(members).map((m) => m.userId)).toEqual([1, 3]);
  });
});

describe("canWave", () => {
  it("first wave is always allowed", () => {
    expect(canWave(null, T0)).toBe(true);
  });
  it("enforces the minimum gap", () => {
    expect(canWave(secAgo(WAVE_MIN_GAP_SEC - 1), T0)).toBe(false);
    expect(canWave(secAgo(WAVE_MIN_GAP_SEC), T0)).toBe(true);
  });
});

describe("shouldSweepRoom", () => {
  it("keeps a room with any fresh member", () => {
    expect(shouldSweepRoom(minAgo(300), [minAgo(SWEEP_STALE_MIN + 30), minAgo(1)], T0)).toBe(false);
  });
  it("sweeps when every member is stale", () => {
    expect(shouldSweepRoom(minAgo(300), [minAgo(SWEEP_STALE_MIN), minAgo(200)], T0)).toBe(true);
  });
  it("stale threshold clears the longest sprint (heads-down rooms keep claimable sprints)", () => {
    expect(SWEEP_STALE_MIN).toBeGreaterThan(50);
    expect(shouldSweepRoom(minAgo(60), [minAgo(55)], T0)).toBe(false);
  });
  it("sweeps ancient rooms regardless of freshness", () => {
    expect(shouldSweepRoom(new Date(T0.getTime() - SWEEP_MAX_AGE_HOURS * 3_600_000), [minAgo(1)], T0)).toBe(true);
  });
});

describe("shouldSendInvitePush", () => {
  const prefs = { quietHoursStart: 22, quietHoursEnd: 8 };
  it("sends during the recipient's local daytime", () => {
    // 15:00 UTC = 11:00 in New York — daytime, outside 22→8 quiet.
    expect(shouldSendInvitePush({ timezone: "America/New_York", ...prefs }, T0)).toBe(true);
  });
  it("skips the deep-night floor [2,7) in the recipient's tz", () => {
    // 15:00 UTC = 03:00 in Honolulu (UTC-10) — deep night even if quiet hours were off.
    expect(shouldSendInvitePush({ timezone: "Pacific/Honolulu", quietHoursStart: 12, quietHoursEnd: 12 }, T0)).toBe(false);
  });
  it("skips the recipient's own quiet hours (wrapping midnight)", () => {
    // 15:00 UTC = 00:00 in Auckland (UTC+12, NZST July) — inside 22→8.
    expect(shouldSendInvitePush({ timezone: "Pacific/Auckland", ...prefs }, T0)).toBe(false);
  });
  it("start === end means no quiet hours", () => {
    expect(shouldSendInvitePush({ timezone: "America/New_York", quietHoursStart: 9, quietHoursEnd: 9 }, T0)).toBe(true);
  });
  it("null timezone falls back to UTC", () => {
    // 15:00 UTC — daytime in UTC.
    expect(shouldSendInvitePush({ timezone: null, ...prefs }, T0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/api-server test -- body-double`
Expected: FAIL — cannot resolve `./body-double`.

- [ ] **Step 3: Write the implementation**

`artifacts/api-server/src/lib/body-double.ts`:

```ts
// Act IV Body-Doubling Rooms — pure decision logic (no I/O), envelope-style.
import { GRACE_SECONDS, computeIntervalXp } from "./focus-sessions";
import { resolveTimeZone, localHour } from "./date-buckets";
import { inQuietHours, DEEP_NIGHT_START, DEEP_NIGHT_END } from "./notification-envelope";

// Poll cadence (10 s) must stay well under HERE_THRESHOLD_SEC.
export const HERE_THRESHOLD_SEC = 45;
export const WAVE_MIN_GAP_SEC = 15;
// Must stay > the longest sprint (50 min) so a claimable sprint in a fully
// heads-down room is essentially never swept out from under it.
export const SWEEP_STALE_MIN = 90;
export const SWEEP_MAX_AGE_HOURS = 12;

export const SPRINT_MINUTES = [15, 25, 50] as const;
export type SprintMinutes = (typeof SPRINT_MINUTES)[number];

export type Presence = "here" | "headsDown";

/** A locked phone is a body double working, not a body double gone. */
export function presenceOf(lastSeenAt: Date, now: Date): Presence {
  return (now.getTime() - lastSeenAt.getTime()) / 1000 <= HERE_THRESHOLD_SEC ? "here" : "headsDown";
}

export function isSprintMinutes(m: unknown): m is SprintMinutes {
  return typeof m === "number" && (SPRINT_MINUTES as readonly number[]).includes(m);
}

/** Same anti-cheat grammar as focus-interval crediting: wall-clock lower bound. */
export function sprintElapsedOk(startedAt: Date, minutes: number, now: Date): boolean {
  return (now.getTime() - startedAt.getTime()) / 1000 >= minutes * 60 - GRACE_SECONDS;
}

/** Company pays exactly like a focus block (D5). */
export function sprintBonusXp(minutes: number): number {
  return computeIntervalXp(minutes);
}

/** Payout eligibility is joined-and-not-left — NEVER heartbeat freshness. */
export function eligibleMembers<T extends { leftAt: Date | null }>(members: T[]): T[] {
  return members.filter((m) => m.leftAt === null);
}

export function canWave(lastWaveAt: Date | null, now: Date): boolean {
  if (!lastWaveAt) return true;
  return (now.getTime() - lastWaveAt.getTime()) / 1000 >= WAVE_MIN_GAP_SEC;
}

/** Sweep predicate — pure mirror of the cron UPDATE's WHERE clause. */
export function shouldSweepRoom(createdAt: Date, memberLastSeens: Date[], now: Date): boolean {
  if (now.getTime() - createdAt.getTime() >= SWEEP_MAX_AGE_HOURS * 3_600_000) return true;
  const freshest = memberLastSeens.reduce((max, d) => Math.max(max, d.getTime()), 0);
  return now.getTime() - freshest >= SWEEP_STALE_MIN * 60_000;
}

/** One-Voice-spirit courtesy: no invite pushes into deep night or quiet hours. */
export function shouldSendInvitePush(
  recipient: { timezone: string | null; quietHoursStart: number; quietHoursEnd: number },
  now: Date,
): boolean {
  const hour = localHour(now, resolveTimeZone(recipient.timezone));
  if (hour >= DEEP_NIGHT_START && hour < DEEP_NIGHT_END) return false;
  return !inQuietHours(hour, recipient.quietHoursStart, recipient.quietHoursEnd);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/api-server test -- body-double`
Expected: PASS (all ~21).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/body-double.ts artifacts/api-server/src/lib/body-double.test.ts
git commit -m "feat(api): body-double pure decision lib — presence, sprints, sweep, invite courtesy"
```

---

### Task 3: Routes

**Files:**
- Create: `artifacts/api-server/src/routes/body-double.ts`
- Modify: `artifacts/api-server/src/routes/accountability.ts:16,34` (add `export` to `formatUserSummary` and `requireAcceptedPartnership` — no other change)
- Modify: `artifacts/api-server/src/routes/index.ts` (register router — mirror how `accountability` is registered)

**Interfaces:**
- Consumes: Task 1 tables/types; Task 2 functions; `requireAcceptedPartnership(userId, otherId)` / `formatUserSummary(u)` from `./accountability`; `buildHeroLook` from `./avatar` (already exported — accountability imports it); `sendPushNotification` from `../lib/push-notifications`; `logger` from `../lib/logger`.
- Produces: 8 endpoints under `/body-double/…`. Room-state JSON shape (Task 5's schemas and Task 6's client both rely on it exactly):
  `{ id, hostId, status, createdAt, endedAt, isMine, members: [{ ...userSummary, hero, isHost, presence, joinedAt, waveAt }], sprint: { id, minutes, startedBy, startedAt } | null, serverNow }`.

- [ ] **Step 1: Export the two accountability helpers**

In `artifacts/api-server/src/routes/accountability.ts` change line 16 `function formatUserSummary(` → `export function formatUserSummary(` and line 34 `async function requireAcceptedPartnership(` → `export async function requireAcceptedPartnership(`.

- [ ] **Step 2: Write the route file**

`artifacts/api-server/src/routes/body-double.ts`:

```ts
import { Router, type IRouter } from "express";
import { eq, and, or, inArray, isNull } from "drizzle-orm";
import {
  db, usersTable, partnershipsTable, pushSubscriptionsTable, activityTable,
  bodyDoubleRoomsTable, bodyDoubleMembersTable, bodyDoubleSprintsTable,
  type BodyDoubleRoom,
} from "@workspace/db";
import { requireAcceptedPartnership, formatUserSummary } from "./accountability";
import { buildHeroLook } from "./avatar";
import { sendPushNotification } from "../lib/push-notifications";
import { logger } from "../lib/logger";
import {
  presenceOf, isSprintMinutes, sprintElapsedOk, sprintBonusXp,
  eligibleMembers, canWave, shouldSendInvitePush,
} from "../lib/body-double";

const router: IRouter = Router();

function parseId(raw: string | string[]): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

async function acceptedAllyIds(userId: number): Promise<number[]> {
  const rows = await db.select().from(partnershipsTable).where(
    and(
      eq(partnershipsTable.status, "accepted"),
      or(eq(partnershipsTable.requesterId, userId), eq(partnershipsTable.recipientId, userId)),
    ),
  );
  return rows.map((p) => (p.requesterId === userId ? p.recipientId : p.requesterId));
}

// Full room state — counts and states only, never tasks or in-room "output"
// (same privacy stance as ally progress).
async function buildRoomState(room: BodyDoubleRoom, viewerId: number) {
  const now = new Date();
  const memberRows = await db.select({ member: bodyDoubleMembersTable, user: usersTable })
    .from(bodyDoubleMembersTable)
    .innerJoin(usersTable, eq(bodyDoubleMembersTable.userId, usersTable.id))
    .where(and(eq(bodyDoubleMembersTable.roomId, room.id), isNull(bodyDoubleMembersTable.leftAt)))
    .orderBy(bodyDoubleMembersTable.joinedAt);
  const [live] = await db.select().from(bodyDoubleSprintsTable)
    .where(and(eq(bodyDoubleSprintsTable.roomId, room.id), isNull(bodyDoubleSprintsTable.completedAt)));
  return {
    id: room.id,
    hostId: room.hostId,
    status: room.status,
    createdAt: room.createdAt.toISOString(),
    endedAt: room.endedAt ? room.endedAt.toISOString() : null,
    isMine: room.hostId === viewerId,
    members: memberRows.map(({ member, user }) => ({
      ...formatUserSummary(user),
      hero: buildHeroLook(user),
      isHost: user.id === room.hostId,
      presence: presenceOf(member.lastSeenAt, now),
      joinedAt: member.joinedAt.toISOString(),
      waveAt: member.lastWaveAt ? member.lastWaveAt.toISOString() : null,
    })),
    sprint: live ? {
      id: live.id,
      minutes: live.minutes,
      startedBy: live.startedBy,
      startedAt: live.startedAt.toISOString(),
    } : null,
    serverNow: now.toISOString(),
  };
}

/** One best-effort push per accepted ally on room open (D3, poke precedent). */
async function sendRoomInvites(hostId: number): Promise<void> {
  const now = new Date();
  const [host] = await db.select().from(usersTable).where(eq(usersTable.id, hostId));
  if (!host) return;
  const allyIds = await acceptedAllyIds(hostId);
  if (allyIds.length === 0) return;
  const allies = await db.select().from(usersTable).where(inArray(usersTable.id, allyIds));
  const title = `${host.username} opened a body-double room`;
  for (const ally of allies) {
    if (!shouldSendInvitePush(ally, now)) continue; // deep-night/quiet-hours courtesy
    const subs = await db.select().from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.userId, ally.id));
    for (const sub of subs) {
      const ok = await sendPushNotification(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        { title, body: "Drop in and work alongside", tag: "bodydouble-invite", data: { url: "/focus" } },
      );
      if (!ok) {
        await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, sub.endpoint));
      }
    }
  }
}

// My open room + open rooms of my accepted allies (list poll, ~30 s).
router.get("/body-double/rooms/open", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const allyIds = await acceptedAllyIds(userId);
  const rooms = await db.select({ room: bodyDoubleRoomsTable, host: usersTable })
    .from(bodyDoubleRoomsTable)
    .innerJoin(usersTable, eq(bodyDoubleRoomsTable.hostId, usersTable.id))
    .where(and(
      eq(bodyDoubleRoomsTable.status, "open"),
      inArray(bodyDoubleRoomsTable.hostId, [...allyIds, userId]),
    ))
    .orderBy(bodyDoubleRoomsTable.createdAt);
  const roomIds = rooms.map((r) => r.room.id);
  const members = roomIds.length > 0
    ? await db.select().from(bodyDoubleMembersTable)
        .where(and(inArray(bodyDoubleMembersTable.roomId, roomIds), isNull(bodyDoubleMembersTable.leftAt)))
    : [];
  res.json({
    rooms: rooms.map(({ room, host }) => ({
      id: room.id,
      host: formatUserSummary(host),
      isMine: room.hostId === userId,
      amMember: members.some((m) => m.roomId === room.id && m.userId === userId),
      memberCount: members.filter((m) => m.roomId === room.id).length,
      createdAt: room.createdAt.toISOString(),
    })),
  });
});

// Open a room. 409 with the existing room if I already host an open one.
router.post("/body-double/rooms", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  type Outcome =
    | { status: "no_user" }
    | { status: "already_open"; existing: BodyDoubleRoom }
    | { status: "ok"; room: BodyDoubleRoom };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    // Lock the user row so concurrent creates can't both pass the open-room
    // check (same critical-section grammar as focus-session start).
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update");
    if (!user) return { status: "no_user" };
    const [existing] = await tx.select().from(bodyDoubleRoomsTable)
      .where(and(eq(bodyDoubleRoomsTable.hostId, userId), eq(bodyDoubleRoomsTable.status, "open")));
    if (existing) return { status: "already_open", existing };
    const [room] = await tx.insert(bodyDoubleRoomsTable).values({ hostId: userId }).returning();
    await tx.insert(bodyDoubleMembersTable).values({ roomId: room.id, userId });
    return { status: "ok", room };
  });

  if (outcome.status === "no_user") { res.status(404).json({ error: "User not found" }); return; }
  if (outcome.status === "already_open") {
    res.status(409).json({
      error: "You already have an open room",
      room: await buildRoomState(outcome.existing, userId),
    });
    return;
  }

  // Best-effort invites before responding (poke precedent) — failures never
  // block room creation.
  try {
    await sendRoomInvites(userId);
  } catch (err) {
    logger.error({ err, roomId: outcome.room.id }, "body-double invite push failed");
  }

  res.status(201).json(await buildRoomState(outcome.room, userId));
});

// Room state — THE 10 s poll. Viewing as an active member touches presence:
// the poll IS the heartbeat.
router.get("/body-double/rooms/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const [room] = await db.select().from(bodyDoubleRoomsTable).where(eq(bodyDoubleRoomsTable.id, id));
  if (!room) { res.status(404).json({ error: "Room not found" }); return; }

  const [myRow] = await db.select().from(bodyDoubleMembersTable)
    .where(and(eq(bodyDoubleMembersTable.roomId, id), eq(bodyDoubleMembersTable.userId, userId)));
  if (!myRow && room.hostId !== userId) {
    const partnership = await requireAcceptedPartnership(userId, room.hostId);
    if (!partnership) { res.status(403).json({ error: "Only the host's allies can view this room" }); return; }
  }

  if (myRow && myRow.leftAt === null && room.status === "open") {
    await db.update(bodyDoubleMembersTable).set({ lastSeenAt: new Date() })
      .where(eq(bodyDoubleMembersTable.id, myRow.id));
  }

  res.json(await buildRoomState(room, userId));
});

// Drop in. Rejoin clears left_at on the same row.
router.post("/body-double/rooms/:id/join", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const [room] = await db.select().from(bodyDoubleRoomsTable).where(eq(bodyDoubleRoomsTable.id, id));
  if (!room) { res.status(404).json({ error: "Room not found" }); return; }
  if (room.status !== "open") { res.status(409).json({ error: "This room has wrapped up" }); return; }
  if (room.hostId !== userId) {
    const partnership = await requireAcceptedPartnership(userId, room.hostId);
    if (!partnership) { res.status(403).json({ error: "Only the host's allies can drop in" }); return; }
  }

  await db.insert(bodyDoubleMembersTable)
    .values({ roomId: id, userId })
    .onConflictDoUpdate({
      target: [bodyDoubleMembersTable.roomId, bodyDoubleMembersTable.userId],
      set: { leftAt: null, lastSeenAt: new Date() },
    });

  res.status(200).json(await buildRoomState(room, userId));
});

// Leave gracefully. Host leaving ends the room (D4). Idempotent.
router.post("/body-double/rooms/:id/leave", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const [room] = await db.select().from(bodyDoubleRoomsTable).where(eq(bodyDoubleRoomsTable.id, id));
  if (!room) { res.status(404).json({ error: "Room not found" }); return; }
  const [myRow] = await db.select().from(bodyDoubleMembersTable)
    .where(and(eq(bodyDoubleMembersTable.roomId, id), eq(bodyDoubleMembersTable.userId, userId)));
  if (!myRow) { res.status(404).json({ error: "You're not in this room" }); return; }

  const now = new Date();
  if (myRow.leftAt === null) {
    await db.update(bodyDoubleMembersTable).set({ leftAt: now })
      .where(eq(bodyDoubleMembersTable.id, myRow.id));
  }

  let ended = room.status !== "open";
  if (room.hostId === userId && room.status === "open") {
    await db.update(bodyDoubleRoomsTable).set({ status: "ended", endedAt: now })
      .where(and(eq(bodyDoubleRoomsTable.id, id), eq(bodyDoubleRoomsTable.status, "open")));
    ended = true;
  }

  res.status(200).json({ left: true, ended });
});

// 👋 — soft-capped server-side; a rate-limited wave is a quiet 200, never an error.
router.post("/body-double/rooms/:id/wave", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const [room] = await db.select().from(bodyDoubleRoomsTable).where(eq(bodyDoubleRoomsTable.id, id));
  if (!room) { res.status(404).json({ error: "Room not found" }); return; }
  const [myRow] = await db.select().from(bodyDoubleMembersTable)
    .where(and(eq(bodyDoubleMembersTable.roomId, id), eq(bodyDoubleMembersTable.userId, userId)));
  if (!myRow || myRow.leftAt !== null || room.status !== "open") {
    res.status(409).json({ error: "Join the room to wave" });
    return;
  }

  const now = new Date();
  if (!canWave(myRow.lastWaveAt, now)) { res.status(200).json({ waved: false }); return; }
  await db.update(bodyDoubleMembersTable).set({ lastWaveAt: now })
    .where(eq(bodyDoubleMembersTable.id, myRow.id));
  res.status(200).json({ waved: true });
});

// Start a shared sprint. The partial unique index makes the INSERT the
// one-live-sprint-per-room guard (insert-as-guard, world-boss grammar).
router.post("/body-double/rooms/:id/sprints", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const minutes = (req.body as { minutes?: unknown }).minutes;
  if (!isSprintMinutes(minutes)) { res.status(400).json({ error: "minutes must be 15, 25, or 50" }); return; }

  const [room] = await db.select().from(bodyDoubleRoomsTable).where(eq(bodyDoubleRoomsTable.id, id));
  if (!room) { res.status(404).json({ error: "Room not found" }); return; }
  if (room.status !== "open") { res.status(409).json({ error: "This room has wrapped up" }); return; }
  const [myRow] = await db.select().from(bodyDoubleMembersTable)
    .where(and(eq(bodyDoubleMembersTable.roomId, id), eq(bodyDoubleMembersTable.userId, userId)));
  if (!myRow || myRow.leftAt !== null) { res.status(403).json({ error: "Join the room first" }); return; }

  const [sprint] = await db.insert(bodyDoubleSprintsTable)
    .values({ roomId: id, minutes, startedBy: userId })
    .onConflictDoNothing()
    .returning();
  if (!sprint) { res.status(409).json({ error: "A sprint is already running in this room" }); return; }

  res.status(201).json({
    id: sprint.id,
    minutes: sprint.minutes,
    startedBy: sprint.startedBy,
    startedAt: sprint.startedAt.toISOString(),
  });
});

// Finish a sprint: validated wall-clock, exactly-once payout via guarded claim.
// Any member's client may call it when the countdown hits zero; races are 200
// soft no-ops (anti-shame: never an error for showing up).
router.post("/body-double/rooms/:id/sprints/:sprintId/finish", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const roomId = parseId(req.params.id);
  const sprintId = parseId(req.params.sprintId);
  if (roomId === null || sprintId === null) { res.status(400).json({ error: "Invalid id" }); return; }

  const now = new Date();

  type Outcome =
    | { status: "not_found" }
    | { status: "not_member" }
    | { status: "too_early" }
    | { status: "already_done" }
    | { status: "ok"; xpEach: number; paidUserIds: number[] };

  const outcome = await db.transaction(async (tx): Promise<Outcome> => {
    const [sprint] = await tx.select().from(bodyDoubleSprintsTable)
      .where(and(eq(bodyDoubleSprintsTable.id, sprintId), eq(bodyDoubleSprintsTable.roomId, roomId)));
    if (!sprint) return { status: "not_found" };

    const [myRow] = await tx.select().from(bodyDoubleMembersTable)
      .where(and(eq(bodyDoubleMembersTable.roomId, roomId), eq(bodyDoubleMembersTable.userId, userId)));
    if (!myRow || myRow.leftAt !== null) return { status: "not_member" };

    if (sprint.completedAt) return { status: "already_done" };
    if (!sprintElapsedOk(sprint.startedAt, sprint.minutes, now)) return { status: "too_early" };

    // Exactly-once claim: the guarded UPDATE elects a single payer.
    const [claimed] = await tx.update(bodyDoubleSprintsTable)
      .set({ completedAt: now })
      .where(and(eq(bodyDoubleSprintsTable.id, sprint.id), isNull(bodyDoubleSprintsTable.completedAt)))
      .returning();
    if (!claimed) return { status: "already_done" };

    const memberRows = await tx.select().from(bodyDoubleMembersTable)
      .where(and(eq(bodyDoubleMembersTable.roomId, roomId), isNull(bodyDoubleMembersTable.leftAt)));
    const eligible = eligibleMembers(memberRows);
    // Company is the reward: a solo-completed sprint completes quietly — no
    // bonus, no sad copy.
    if (eligible.length < 2) return { status: "ok", xpEach: 0, paidUserIds: [] };

    const xpEach = sprintBonusXp(sprint.minutes);
    // Lock payee rows in deterministic id order to prevent deadlocks
    // (world-boss payout grammar).
    const payees = await tx.select().from(usersTable)
      .where(inArray(usersTable.id, eligible.map((m) => m.userId)))
      .orderBy(usersTable.id)
      .for("update");
    for (const p of payees) {
      await tx.update(usersTable).set({
        totalPoints: p.totalPoints + xpEach,
        weeklyPoints: p.weeklyPoints + xpEach,
      }).where(eq(usersTable.id, p.id));
      const others = payees.length - 1;
      await tx.insert(activityTable).values({
        userId: p.id,
        type: "body_double",
        description: `Sprint together · ${sprint.minutes} min with ${others === 1 ? "an ally" : `${others} allies`}`,
        points: xpEach,
      });
    }
    return { status: "ok", xpEach, paidUserIds: payees.map((p) => p.id) };
  });

  switch (outcome.status) {
    case "not_found": res.status(404).json({ error: "Sprint not found" }); return;
    case "not_member": res.status(403).json({ error: "Join the room first" }); return;
    case "too_early": res.status(409).json({ error: "The sprint isn't finished yet" }); return;
    case "already_done": res.status(200).json({ completed: true, xpAwarded: 0, membersPaid: 0 }); return;
    case "ok":
      res.status(200).json({
        completed: true,
        xpAwarded: outcome.paidUserIds.includes(userId) ? outcome.xpEach : 0,
        membersPaid: outcome.paidUserIds.length,
      });
      return;
  }
});

export default router;
```

- [ ] **Step 3: Register the router**

Open `artifacts/api-server/src/routes/index.ts`, find how `accountability` is imported/mounted, and register `bodyDoubleRouter` from `./body-double` the identical way (same prefix handling).

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: clean. (If `buildHeroLook(user)` wants a narrower arg type than the full user row, match its actual signature in `routes/avatar.ts` — accountability's partner-detail call is the reference usage.)

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/body-double.ts artifacts/api-server/src/routes/accountability.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(api): body-double room/member/sprint routes — poll-as-heartbeat, insert-as-guard, exactly-once payout"
```

---

### Task 4: Cron sweep

**Files:**
- Modify: `artifacts/api-server/src/lib/notification-scheduler.ts` (new function + one call in `tick()` at :569)

**Interfaces:**
- Consumes: `SWEEP_STALE_MIN`, `SWEEP_MAX_AGE_HOURS` from `./body-double`; `bodyDoubleRoomsTable`, `bodyDoubleMembersTable` from `@workspace/db`; drizzle `lt`, `gt`, `notExists`, `sql`.
- Produces: `sweepBodyDoubleRooms(now: Date): Promise<number>` exported for reuse; tick `ran[]` gains `"body-double-sweep"`.

- [ ] **Step 1: Add the sweep function** (above `tick()`; extend the file's existing drizzle imports with `lt`, `gt`, `notExists` and the schema imports with the two tables):

```ts
// Act IV Body-Doubling: end abandoned rooms (every active member stale ≥ 90
// min — heads-down is welcome, a fully-cold room is not) and ancient rooms
// (≥ 12 h). One cheap UPDATE; no notifications, no envelope interaction.
export async function sweepBodyDoubleRooms(now: Date): Promise<number> {
  const staleCutoff = new Date(now.getTime() - SWEEP_STALE_MIN * 60_000);
  const ageCutoff = new Date(now.getTime() - SWEEP_MAX_AGE_HOURS * 3_600_000);
  const swept = await db.update(bodyDoubleRoomsTable)
    .set({ status: "ended", endedAt: now })
    .where(and(
      eq(bodyDoubleRoomsTable.status, "open"),
      or(
        lt(bodyDoubleRoomsTable.createdAt, ageCutoff),
        notExists(
          db.select({ one: sql`1` }).from(bodyDoubleMembersTable).where(and(
            eq(bodyDoubleMembersTable.roomId, bodyDoubleRoomsTable.id),
            isNull(bodyDoubleMembersTable.leftAt),
            gt(bodyDoubleMembersTable.lastSeenAt, staleCutoff),
          )),
        ),
      ),
    ))
    .returning({ id: bodyDoubleRoomsTable.id });
  return swept.length;
}
```

- [ ] **Step 2: Call it from `tick()`** — insert directly after `ran.push("recurring-tasks");`:

```ts
  await sweepBodyDoubleRooms(now);
  ran.push("body-double-sweep");
```

- [ ] **Step 3: Typecheck + full api suite**

Run: `pnpm typecheck` then `pnpm --filter @workspace/api-server test`
Expected: clean / all green (scheduler tests must not break; the sweep is pure SQL and untested at the unit level — its predicate is Task 2's `shouldSweepRoom` tests).

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/lib/notification-scheduler.ts
git commit -m "feat(api): cron sweep ends abandoned/ancient body-double rooms"
```

---

### Task 5: OpenAPI + codegen

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (8 paths + schemas)
- Generated (commit, never hand-edit): `lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/*`

**Interfaces:**
- Consumes: Task 3's exact JSON shapes.
- Produces hooks Task 6 uses (orval derives names from operationIds): `useGetOpenBodyDoubleRooms`/`getGetOpenBodyDoubleRoomsQueryKey`, `useCreateBodyDoubleRoom`, `useGetBodyDoubleRoom`/`getGetBodyDoubleRoomQueryKey`, `useJoinBodyDoubleRoom`, `useLeaveBodyDoubleRoom`, `useWaveBodyDoubleRoom`, `useStartBodyDoubleSprint`, `useFinishBodyDoubleSprint`, plus types `BodyDoubleRoomState`, `BodyDoubleRoomMember`, `BodyDoubleSprint`, `BodyDoubleOpenRoom`.

- [ ] **Step 1: Find the existing grammar to mirror**

In `lib/api-spec/openapi.yaml`: locate the partner-detail path to learn (a) the tag partner endpoints use, (b) the schema name for the hero-look object (grep `hero`) and (c) the user-summary schema partner lists use. Reuse those `$ref`s — do NOT invent a parallel hero/user schema.

- [ ] **Step 2: Add the 8 paths** (adjacent to the accountability paths, using the tag found in Step 1; `{id}`/`{sprintId}` as `schema: {type: integer}` path params, matching neighbors):

```yaml
  /body-double/rooms/open:
    get:
      operationId: getOpenBodyDoubleRooms
      summary: My open room plus open rooms of my accepted allies
      responses:
        "200":
          description: Open rooms visible to me
          content:
            application/json:
              schema:
                type: object
                required: [rooms]
                properties:
                  rooms:
                    type: array
                    items:
                      $ref: "#/components/schemas/BodyDoubleOpenRoom"

  /body-double/rooms:
    post:
      operationId: createBodyDoubleRoom
      summary: Open a body-double room (invites accepted allies via push)
      responses:
        "201":
          description: The freshly opened room
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/BodyDoubleRoomState"

  /body-double/rooms/{id}:
    get:
      operationId: getBodyDoubleRoom
      summary: Room state (the 10s poll — doubles as the presence heartbeat)
      responses:
        "200":
          description: Full room state
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/BodyDoubleRoomState"

  /body-double/rooms/{id}/join:
    post:
      operationId: joinBodyDoubleRoom
      summary: Drop in (accepted allies of the host; rejoin clears left_at)
      responses:
        "200":
          description: Room state after joining
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/BodyDoubleRoomState"

  /body-double/rooms/{id}/leave:
    post:
      operationId: leaveBodyDoubleRoom
      summary: Leave gracefully (host leaving ends the room)
      responses:
        "200":
          description: Leave outcome
          content:
            application/json:
              schema:
                type: object
                required: [left, ended]
                properties:
                  left: { type: boolean }
                  ended: { type: boolean }

  /body-double/rooms/{id}/wave:
    post:
      operationId: waveBodyDoubleRoom
      summary: Wave at the room (soft-capped; rate-limited waves are a quiet no-op)
      responses:
        "200":
          description: Whether the wave was recorded
          content:
            application/json:
              schema:
                type: object
                required: [waved]
                properties:
                  waved: { type: boolean }

  /body-double/rooms/{id}/sprints:
    post:
      operationId: startBodyDoubleSprint
      summary: Start a shared sprint (one live sprint per room)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [minutes]
              properties:
                minutes:
                  type: integer
                  enum: [15, 25, 50]
      responses:
        "201":
          description: The started sprint
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/BodyDoubleSprint"

  /body-double/rooms/{id}/sprints/{sprintId}/finish:
    post:
      operationId: finishBodyDoubleSprint
      summary: Finish a sprint (validated wall-clock; exactly-once flat bonus to members present)
      responses:
        "200":
          description: Completion outcome (soft no-op on races)
          content:
            application/json:
              schema:
                type: object
                required: [completed, xpAwarded, membersPaid]
                properties:
                  completed: { type: boolean }
                  xpAwarded: { type: integer }
                  membersPaid: { type: integer }
```

- [ ] **Step 3: Add the schemas** (in components/schemas; replace `HeroLook`/`UserSummary` refs with the actual names found in Step 1):

```yaml
    BodyDoubleSprint:
      type: object
      required: [id, minutes, startedBy, startedAt]
      properties:
        id: { type: integer }
        minutes: { type: integer, enum: [15, 25, 50] }
        startedBy: { type: integer }
        startedAt: { type: string }

    BodyDoubleRoomMember:
      type: object
      required: [id, username, currentLevel, levelName, totalPoints, streakDays, avatarColor, hero, isHost, presence, joinedAt]
      properties:
        id: { type: integer }
        username: { type: string }
        displayName: { type: string, nullable: true }
        avatarColor: { type: string }
        currentLevel: { type: integer }
        levelName: { type: string }
        totalPoints: { type: integer }
        streakDays: { type: integer }
        hero: { $ref: "#/components/schemas/HeroLook" }
        isHost: { type: boolean }
        presence: { type: string, enum: [here, headsDown] }
        joinedAt: { type: string }
        waveAt: { type: string, nullable: true }

    BodyDoubleRoomState:
      type: object
      required: [id, hostId, status, createdAt, isMine, members, serverNow]
      properties:
        id: { type: integer }
        hostId: { type: integer }
        status: { type: string, enum: [open, ended] }
        createdAt: { type: string }
        endedAt: { type: string, nullable: true }
        isMine: { type: boolean }
        members:
          type: array
          items:
            $ref: "#/components/schemas/BodyDoubleRoomMember"
        sprint:
          nullable: true
          allOf:
            - $ref: "#/components/schemas/BodyDoubleSprint"
        serverNow: { type: string }

    BodyDoubleOpenRoom:
      type: object
      required: [id, host, isMine, amMember, memberCount, createdAt]
      properties:
        id: { type: integer }
        host: { $ref: "#/components/schemas/UserSummary" }
        isMine: { type: boolean }
        amMember: { type: boolean }
        memberCount: { type: integer }
        createdAt: { type: string }
```

- [ ] **Step 4: Regenerate clients**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: new hooks/types appear under `lib/api-client-react/src/generated/` (grep for `useGetBodyDoubleRoom`); no other endpoints' generated code changes semantically.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react lib/api-zod
git commit -m "feat(api-spec): body-double endpoints + generated clients"
```

---

### Task 6: Web — countdown util, card, room view, feed icon

**Files:**
- Create: `artifacts/focusquest/src/lib/body-double-countdown.ts`
- Test: `artifacts/focusquest/src/lib/body-double-countdown.test.ts`
- Create: `artifacts/focusquest/src/components/body-double-card.tsx`
- Create: `artifacts/focusquest/src/components/body-double-room.tsx`
- Modify: `artifacts/focusquest/src/pages/focus.tsx` (mount the card at the end of the page container)
- Modify: `artifacts/focusquest/src/pages/progress.tsx:392` (add `body_double` icon line + `Users` to the lucide import)

**Interfaces:**
- Consumes: Task 5 hooks/types; `isUnlocked` (same import layout.tsx:179–182 uses); `useGetMyStats`, `useGetPartners`, `getGetMyStatsQueryKey`; `PixelHero` (`look` + `size` props); `fmt`-style mm:ss formatting (local copy, 3 lines).
- Produces: `sprintCountdown(startedAtIso: string, minutes: number, nowMs: number): { remainingSeconds: number; done: boolean }`; `<BodyDoubleCard />` self-contained (all gating internal).

- [ ] **Step 1: Write the failing countdown tests**

`artifacts/focusquest/src/lib/body-double-countdown.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sprintCountdown } from "./body-double-countdown";

const START = "2026-07-21T15:00:00.000Z";
const startMs = new Date(START).getTime();

describe("sprintCountdown", () => {
  it("counts down from the shared server anchor", () => {
    expect(sprintCountdown(START, 25, startMs + 5 * 60_000)).toEqual({ remainingSeconds: 20 * 60, done: false });
  });
  it("is done exactly at the boundary", () => {
    expect(sprintCountdown(START, 15, startMs + 15 * 60_000)).toEqual({ remainingSeconds: 0, done: true });
  });
  it("clamps after the end (late joiner, resumed tab)", () => {
    expect(sprintCountdown(START, 15, startMs + 16 * 60_000)).toEqual({ remainingSeconds: 0, done: true });
  });
  it("rounds partial seconds up so the display never skips 00:01→done early", () => {
    expect(sprintCountdown(START, 15, startMs + 15 * 60_000 - 500).remainingSeconds).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @workspace/focusquest test -- body-double-countdown`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`artifacts/focusquest/src/lib/body-double-countdown.ts`:

```ts
// Shared sprint countdown: both clients derive remaining time from the same
// server-anchored startedAt — the same trust model as the solo pomodoro
// (reconstructTimerState), so screens agree without any push channel.
export interface SprintCountdown {
  remainingSeconds: number;
  done: boolean;
}

export function sprintCountdown(startedAtIso: string, minutes: number, nowMs: number): SprintCountdown {
  const endMs = new Date(startedAtIso).getTime() + minutes * 60_000;
  const remaining = Math.ceil((endMs - nowMs) / 1000);
  return { remainingSeconds: Math.max(0, remaining), done: remaining <= 0 };
}
```

- [ ] **Step 4: Run to verify pass, commit the util**

Run: `pnpm --filter @workspace/focusquest test -- body-double-countdown` → PASS.

```bash
git add artifacts/focusquest/src/lib/body-double-countdown.ts artifacts/focusquest/src/lib/body-double-countdown.test.ts
git commit -m "feat(web): shared sprint countdown util"
```

- [ ] **Step 5: Room view component**

`artifacts/focusquest/src/components/body-double-room.tsx` — presence row + waves + sprint + leave. Complete component (imports follow the generated names; adjust only if codegen differs):

```tsx
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBodyDoubleRoom, getGetBodyDoubleRoomQueryKey,
  useLeaveBodyDoubleRoom, useWaveBodyDoubleRoom,
  useStartBodyDoubleSprint, useFinishBodyDoubleSprint,
  getGetOpenBodyDoubleRoomsQueryKey, getGetMyStatsQueryKey,
} from "@workspace/api-client-react";
import { sprintCountdown } from "@/lib/body-double-countdown";
import { PixelHero } from "@/components/pixel-hero";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Hand, LogOut, Timer } from "lucide-react";

const fmt = (total: number) => {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const WAVE_SHOW_MS = 12_000;

export function BodyDoubleRoom({ roomId, onExit }: { roomId: number; onExit: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  // THE poll: 10s, and the server touches our last_seen_at on each read —
  // polling IS the presence heartbeat. Background tabs stop polling (TanStack
  // default), which is exactly what renders us "heads-down" to allies.
  const roomQuery = useGetBodyDoubleRoom(roomId, {
    query: { queryKey: getGetBodyDoubleRoomQueryKey(roomId), refetchInterval: 10_000 },
  });
  const room = roomQuery.data;

  const leaveMut = useLeaveBodyDoubleRoom();
  const waveMut = useWaveBodyDoubleRoom();
  const startMut = useStartBodyDoubleSprint();
  const finishMut = useFinishBodyDoubleSprint();

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const invalidateRoom = () => {
    qc.invalidateQueries({ queryKey: getGetBodyDoubleRoomQueryKey(roomId) });
    qc.invalidateQueries({ queryKey: getGetOpenBodyDoubleRoomsQueryKey() });
  };

  // Auto-finish once when the shared countdown hits zero; the server's guarded
  // claim makes cross-member races harmless (soft no-op).
  const finishedRef = useRef<number | null>(null);
  const sprint = room?.sprint ?? null;
  const countdown = sprint ? sprintCountdown(sprint.startedAt, sprint.minutes, nowMs) : null;
  useEffect(() => {
    if (!sprint || !countdown?.done) return;
    if (finishedRef.current === sprint.id || finishMut.isPending) return;
    finishedRef.current = sprint.id;
    finishMut.mutate(
      { id: roomId, sprintId: sprint.id },
      {
        onSuccess: (res) => {
          if (res.xpAwarded > 0) {
            toast({ title: `+${res.xpAwarded} XP`, description: "Sprint together", className: "border-primary" });
            qc.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
          }
          invalidateRoom();
        },
        onError: invalidateRoom,
      },
    );
  }, [sprint?.id, countdown?.done]);

  if (!room) return null;

  if (room.status === "ended") {
    const host = room.members.find((m) => m.isHost);
    return (
      <div className="space-y-3 text-center py-4">
        <p className="text-sm text-muted-foreground">
          {room.isMine ? "Room wrapped up — thanks for the company." : `${host?.displayName ?? host?.username ?? "Your ally"} wrapped up — nice working together.`}
        </p>
        <Button variant="outline" size="sm" onClick={onExit}>Back</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {room.members.map((m) => {
          const waved = m.waveAt !== null && nowMs - new Date(m.waveAt).getTime() < WAVE_SHOW_MS;
          return (
            <div key={m.id} className="flex flex-col items-center gap-1 w-16">
              <div className="relative">
                <PixelHero look={m.hero} size={48} />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-background ${m.presence === "here" ? "bg-green-400" : "bg-amber-400"}`}
                />
                {waved && <span className="absolute -top-2 -right-2 text-sm">👋</span>}
              </div>
              <span className="text-[10px] leading-tight text-center truncate w-full">{m.displayName ?? m.username}</span>
              <span className="text-[9px] text-muted-foreground">{m.presence === "here" ? "with you" : "heads-down"}</span>
            </div>
          );
        })}
      </div>

      {sprint && countdown && !countdown.done && (
        <div className="text-center space-y-1">
          <div className="text-3xl font-mono font-bold text-primary">{fmt(countdown.remainingSeconds)}</div>
          <p className="text-xs text-muted-foreground">Sprinting together · {sprint.minutes} min</p>
        </div>
      )}

      {!sprint && (
        <div className="flex items-center justify-center gap-2">
          <span className="text-xs text-muted-foreground mr-1 flex items-center gap-1"><Timer className="w-3.5 h-3.5" /> Sprint together:</span>
          {[15, 25, 50].map((m) => (
            <Button
              key={m}
              variant="outline"
              size="sm"
              disabled={startMut.isPending}
              onClick={() => startMut.mutate({ id: roomId, data: { minutes: m as 15 | 25 | 50 } }, { onSettled: invalidateRoom })}
            >
              {m}m
            </Button>
          ))}
        </div>
      )}

      <div className="flex justify-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={waveMut.isPending}
          onClick={() => waveMut.mutate({ id: roomId }, { onSettled: invalidateRoom })}
        >
          <Hand className="w-4 h-4 mr-1" /> Wave
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={leaveMut.isPending}
          onClick={() =>
            leaveMut.mutate({ id: roomId }, {
              onSettled: () => { invalidateRoom(); onExit(); },
            })
          }
        >
          <LogOut className="w-4 h-4 mr-1" /> {room.isMine ? "Wrap up" : "Leave"}
        </Button>
      </div>
      {room.isMine && <p className="text-[10px] text-center text-muted-foreground">Wrapping up closes the room for everyone — gently.</p>}
    </div>
  );
}
```

- [ ] **Step 6: Card component (gate + list + create + room container)**

`artifacts/focusquest/src/components/body-double-card.tsx`:

```tsx
import { useEffect, useState } from "react";
import {
  useGetMyStats, useGetPartners, useGetOpenBodyDoubleRooms,
  useCreateBodyDoubleRoom, useJoinBodyDoubleRoom,
  getGetOpenBodyDoubleRoomsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { isUnlocked } from "@/lib/feature-gates";
import { BodyDoubleRoom } from "@/components/body-double-room";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, DoorOpen } from "lucide-react";

export function BodyDoubleCard() {
  const qc = useQueryClient();
  const { data: stats } = useGetMyStats();
  const alliesUnlocked = isUnlocked(stats?.unlockedFeatures, "allies");

  const { data: partners } = useGetPartners({
    query: { enabled: alliesUnlocked, queryKey: ["bodyDoublePartners"] },
  });
  const acceptedAllies = (partners ?? []).filter((p) => p.status === "accepted").length;

  const roomsQuery = useGetOpenBodyDoubleRooms({
    query: {
      enabled: alliesUnlocked && acceptedAllies > 0,
      refetchInterval: 30_000,
      queryKey: getGetOpenBodyDoubleRoomsQueryKey(),
    },
  });
  const rooms = roomsQuery.data?.rooms ?? [];

  const createMut = useCreateBodyDoubleRoom();
  const joinMut = useJoinBodyDoubleRoom();
  const [activeRoomId, setActiveRoomId] = useState<number | null>(null);

  // Auto-resume the room I host or already joined (reload-proof, like the timer).
  const myRoom = rooms.find((r) => r.isMine || r.amMember);
  useEffect(() => {
    if (activeRoomId === null && myRoom) setActiveRoomId(myRoom.id);
  }, [activeRoomId, myRoom?.id]);

  // The gate + the no-allies case render NOTHING — no "make friends first" nag.
  if (!alliesUnlocked || acceptedAllies === 0) return null;

  const refreshList = () => qc.invalidateQueries({ queryKey: getGetOpenBodyDoubleRoomsQueryKey() });

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm">Body Double</h2>
        </div>

        {activeRoomId !== null ? (
          <BodyDoubleRoom roomId={activeRoomId} onExit={() => { setActiveRoomId(null); refreshList(); }} />
        ) : (
          <div className="space-y-2">
            {rooms.filter((r) => !r.isMine).map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div className="text-sm">
                  <span className="font-medium">{r.host.displayName ?? r.host.username}</span>
                  <span className="text-muted-foreground">
                    {"'s door is open"}{r.memberCount > 1 ? ` · ${r.memberCount} working` : ""}
                  </span>
                </div>
                <Button
                  size="sm"
                  disabled={joinMut.isPending}
                  onClick={() =>
                    joinMut.mutate({ id: r.id }, {
                      onSuccess: () => setActiveRoomId(r.id),
                      onSettled: refreshList,
                    })
                  }
                >
                  {r.amMember ? "Return" : "Drop in"}
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={createMut.isPending}
              onClick={() =>
                createMut.mutate(undefined, {
                  onSuccess: (room) => setActiveRoomId(room.id),
                  onSettled: refreshList,
                })
              }
            >
              <DoorOpen className="w-4 h-4 mr-1" /> Open a room
            </Button>
            <p className="text-[10px] text-muted-foreground text-center">
              Your allies get a gentle heads-up and can drop in to work alongside you.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

Notes: `isUnlocked` import path must match layout.tsx's exact import; `useCreateBodyDoubleRoom` 409 (already-open) lands in `onSettled` → the list refresh + auto-resume effect recover the existing room; adjust `createMut.mutate(undefined, …)` to the generated signature (orval may want `{}`).

- [ ] **Step 7: Mount on the Focus page + feed icon**

In `artifacts/focusquest/src/pages/focus.tsx`: `import { BodyDoubleCard } from "@/components/body-double-card";` and render `<BodyDoubleCard />` as the LAST child of the page's outermost container (visible in both idle and running states — read the file's return statement and place it after the final existing Card/section, inside the scroll container).

In `artifacts/focusquest/src/pages/progress.tsx`: add `Users` to the existing lucide-react import, and after line 392 (`focus_complete` line) insert:

```tsx
                    {activity.type === 'body_double'          && <Users       className="w-4 h-4 text-primary" />}
```

- [ ] **Step 8: Typecheck + web suite + build**

Run: `pnpm typecheck && pnpm --filter @workspace/focusquest test && pnpm --filter @workspace/focusquest build` (use the package's actual build script name if different)
Expected: all clean/green.

- [ ] **Step 9: Commit**

```bash
git add artifacts/focusquest/src
git commit -m "feat(web): Body Double card on Focus — presence row, waves, shared sprints"
```

---

### Task 7: Full verification, live migration, PR

- [ ] **Step 1: Full gates**

```bash
pnpm typecheck
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/focusquest test
pnpm --filter @workspace/quick-add test
pnpm build
```

Expected: all green (incl. the q7 account-delete order guard picking up the three new tables).

- [ ] **Step 2: Apply migration 0004 to live Neon** (Chad's standing instruction: I run these myself; no unmerged schema from other branches is in flight — Act VII is fully merged)

```bash
cd lib/db
export DATABASE_URL="$(grep -E '^DATABASE_URL=' ../../.env | cut -d= -f2- | tr -d '\r')"
pnpm --filter @workspace/db migrate
```

(Adjust the `.env` path to wherever it actually lives — repo root or `artifacts/api-server/.env`.) Expected: `0004_body_double` applied; verify with `pnpm --filter @workspace/db check`.

- [ ] **Step 3: Push + PR**

PR: `feat/body-double-impl` → `main`, title "feat: Body-Doubling Rooms — Act IV complete (6/6)". Body: spec/plan links, D1–D5 recap, test counts, the Chad-walkthrough checklist (two-account room → push → join → synchronized sprint → both paid once), note that deploys auto-run migrations (already applied manually).

---

## Self-review notes

- Spec §6 GET list/`:id` 403 rules → Task 3 route guards; §7 presence/payout/claim/sweep → Tasks 2–4; §8 economy → Task 3 finish handler + Task 2 `sprintBonusXp`; §9 push → Task 3 `sendRoomInvites` + Task 2 `shouldSendInvitePush`; §10 UI (incl. Gentle Door gate + zero-ally hide + 10 s/30 s cadences) → Task 6; §5 schema → Task 1. Type names consistent across Tasks 1→3→5→6 (checked: `BodyDoubleRoomState.members[].presence` enum, `sprint` nullable, hook names from operationIds).
- Deliberately NOT unit-tested (house pattern — no route/component harness): route handlers, sweep SQL, components. Their pure cores are.
- Known adjust-at-impl points (each pinned to a verification step): hero/user-summary `$ref` names (Task 5 Step 1), `isUnlocked` import path, orval mutation arg shapes, focus.tsx insertion anchor, `.env` location.
