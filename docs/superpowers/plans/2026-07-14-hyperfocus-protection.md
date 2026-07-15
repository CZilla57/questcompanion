# Hyperfocus Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send gentle, spaced, context-aware self-care push nudges (hydrate/stretch/food/bedtime) during a long protected stretch — a long live focus session or held hyperfocus mode — with per-user timezone awareness and a session pause control.

**Architecture:** Mirror hero-care. A few `usersTable` columns hold dedup/rotation/pause state; the protected stretch is *derived* each cron tick from live `focus_sessions` + the latest hyperfocus `brain_checkin`. A pure `lib/hyperfocus.ts` (`protectedStretch` + `selectProtectionNudge`) holds all the decision logic; a `checkHyperfocusProtection()` pass in `notification-scheduler.ts` runs it and sends push via the existing `notify`. Two thin `/users/me/...` endpoints persist the timezone and the pause; the pause state rides the existing brain-state response.

**Tech Stack:** TypeScript, Express (`@workspace/api-server`), Drizzle + Postgres (`@workspace/db`), web-push via `notify`, OpenAPI + orval (`@workspace/api-spec` → `@workspace/api-client-react`), React + TanStack Query + Vite (`@workspace/focusquest`), Vitest.

## Global Constraints

- **Anti-shame:** copy is gentle care/offers only — never "STOP", never guilt about hours or a late bedtime; no counts; bedtime is an invitation bounded by spacing + a deep-night hard-stop; no `activityTable`/ally-feed writes; respects the global push toggle (`notify` no-ops when unsubscribed).
- **Reuse, don't duplicate:** `deriveBrainState` (`lib/brain-mode`), `localHour`/`resolveTimeZone` (`lib/date-buckets`), `hungerStage` (`lib/hero-care`), `notify` + the `checkHeroCare` structure (`lib/notification-scheduler`). Follow `checkHeroCare` line-for-line for the pass shape.
- **Local-time correctness:** all "late"/quiet decisions use the user's persisted `timezone` via `localHour(now, tz)`, never raw server time.
- **Derived, never stored:** the protected stretch is computed each tick; only dedup/rotation/pause state persists.
- **Tunable consts live in one table** in `lib/hyperfocus.ts` (`FIRST_NUDGE_MIN=90`, `INTERVAL_MIN=60`, `STALE_SESSION_MIN=30`, `BEDTIME_HOUR=23`, `DEEP_NIGHT_START=2`, `MORNING=7`, `MEAL_WINDOWS=[[12,13],[18,19]]`).
- **Test strategy (repo convention, Act I/III):** NO supertest route-test harness and NO RTL/jsdom. Decision-logic goes in pure `lib/*.ts` with unit tests; routes/cron/components are thin, verified by `typecheck` + a browser/cron e2e. Do **not** add test infra.
- **`lib/db` composite-dist gotcha:** after a schema edit, run `pnpm run typecheck:libs` first if an api-server typecheck shows phantom missing-field errors (the codegen script already does this).

**Test commands** (from repo root):
- api-server: `pnpm --filter @workspace/api-server test <filter>` · typecheck: `pnpm --filter @workspace/api-server typecheck`
- focusquest: `pnpm --filter @workspace/focusquest test <filter>` · typecheck: `pnpm --filter @workspace/focusquest typecheck`
- codegen: `pnpm --filter @workspace/api-spec codegen`
- schema push (controller-run): `pnpm --filter @workspace/db push` (needs `DATABASE_URL` exported)

---

## File Structure

**Create:**
- `artifacts/api-server/src/lib/hyperfocus.ts` — pure `protectedStretch` + `selectProtectionNudge` + consts/types.
- `artifacts/api-server/src/lib/hyperfocus.test.ts`
- `artifacts/focusquest/src/components/protection-pause.tsx` — the pause control (used in focus page + hyperfocus banner).

**Modify:**
- `lib/db/src/schema/users.ts` — 4 columns.
- `artifacts/api-server/src/lib/notification-scheduler.ts` — `checkHyperfocusProtection` + register in `tick()`.
- `artifacts/api-server/src/routes/users.ts` — `PUT /users/me/timezone`, `POST /users/me/hyperfocus/pause`.
- `artifacts/api-server/src/routes/brain.ts` — `hyperfocusPausedUntil` on the state responses.
- `lib/api-spec/openapi.yaml` — BrainState field; two operations + named request schemas.
- `artifacts/focusquest/src/App.tsx` — persist timezone on authed load.
- `artifacts/focusquest/src/pages/focus.tsx` — mount the pause control in the active-session branch.
- `artifacts/focusquest/src/components/layout.tsx` — mount the pause control in the hyperfocus banner.

---

## Task 1: Schema — user columns

**Files:** Modify `lib/db/src/schema/users.ts`

**Interfaces:**
- Produces columns on `usersTable`: `timezone` (`string | null`), `hyperfocusNudgedAt` (`Date | null`), `hyperfocusLastKind` (`string | null`), `hyperfocusPausedUntil` (`Date | null`).

- [ ] **Step 1: Add the columns**

In `lib/db/src/schema/users.ts`, after `lastFlavorPushAt` (line 31), before `createdAt`:

```ts
  // Per-user timezone (IANA), captured from the client. Lets cron compute the
  // user's local hour for bedtime / quiet-hours.
  timezone: text("timezone"),
  // Hyperfocus Protection dedup/rotation/pause state (mirrors hero-care columns).
  hyperfocusNudgedAt: timestamp("hyperfocus_nudged_at"),
  hyperfocusLastKind: text("hyperfocus_last_kind"),
  hyperfocusPausedUntil: timestamp("hyperfocus_paused_until"),
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/api-server typecheck`
Expected: PASS.

- [ ] **Step 3: (Controller) push to Neon**

Controller runs `pnpm --filter @workspace/db push` (additive columns; no data loss). Implementer: do NOT run this — note it's controller-run.

- [ ] **Step 4: Commit**

```bash
git add lib/db/src/schema/users.ts
git commit -m "feat(db): hyperfocus-protection user columns + timezone"
```

---

## Task 2: Pure — stretch detection + nudge selector

**Files:**
- Create `artifacts/api-server/src/lib/hyperfocus.ts`
- Test `artifacts/api-server/src/lib/hyperfocus.test.ts`

**Interfaces:**
- Consumes: `HungerStage` from `./hero-care`.
- Produces: consts (above); `type NudgeKind = "hydrate"|"stretch"|"food"|"bedtime"`; `interface ProtectionNudge { kind: NudgeKind; title: string; body: string; tag: string }`; `interface ActiveSessionLite { startedAt: Date; lastIntervalAt: Date | null }`; `interface Stretch { active: boolean; startedAt: Date | null }`; `protectedStretch(input) → Stretch`; `selectProtectionNudge(input) → ProtectionNudge | null`.

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/hyperfocus.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  protectedStretch, selectProtectionNudge,
  FIRST_NUDGE_MIN, INTERVAL_MIN, STALE_SESSION_MIN, BEDTIME_HOUR,
  type Stretch,
} from "./hyperfocus";

const NOW = new Date("2026-07-14T18:00:00Z");
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe("protectedStretch", () => {
  it("is active for a fresh active session; startedAt = session start", () => {
    const s = protectedStretch({
      activeSessions: [{ startedAt: minAgo(120), lastIntervalAt: minAgo(5) }],
      mode: "neutral", hyperfocusSince: null, now: NOW,
    });
    expect(s.active).toBe(true);
    expect(s.startedAt!.getTime()).toBe(minAgo(120).getTime());
  });

  it("ignores a stale active session (no recent interval)", () => {
    const s = protectedStretch({
      activeSessions: [{ startedAt: minAgo(200), lastIntervalAt: minAgo(STALE_SESSION_MIN + 15) }],
      mode: "neutral", hyperfocusSince: null, now: NOW,
    });
    expect(s.active).toBe(false);
  });

  it("is active for held hyperfocus mode; startedAt = since", () => {
    const s = protectedStretch({ activeSessions: [], mode: "hyperfocus", hyperfocusSince: minAgo(90), now: NOW });
    expect(s.active).toBe(true);
    expect(s.startedAt!.getTime()).toBe(minAgo(90).getTime());
  });

  it("takes the earliest signal when both present", () => {
    const s = protectedStretch({
      activeSessions: [{ startedAt: minAgo(100), lastIntervalAt: minAgo(2) }],
      mode: "hyperfocus", hyperfocusSince: minAgo(200), now: NOW,
    });
    expect(s.startedAt!.getTime()).toBe(minAgo(200).getTime());
  });

  it("is inactive with no signals", () => {
    expect(protectedStretch({ activeSessions: [], mode: "neutral", hyperfocusSince: null, now: NOW }).active).toBe(false);
  });
});

describe("selectProtectionNudge", () => {
  const active = (startMin: number): Stretch => ({ active: true, startedAt: minAgo(startMin) });
  const base = {
    stretch: active(FIRST_NUDGE_MIN + 30), now: NOW, localHour: 14,
    lastNudgedAt: null as Date | null, lastKind: null as null | "hydrate" | "stretch" | "food" | "bedtime",
    hungerStage: "well_fed" as const, pausedUntil: null as Date | null,
  };

  it("null below the first-nudge threshold", () => {
    expect(selectProtectionNudge({ ...base, stretch: active(FIRST_NUDGE_MIN - 10) })).toBeNull();
  });
  it("null while paused", () => {
    expect(selectProtectionNudge({ ...base, pausedUntil: minAgo(-30) })).toBeNull(); // 30 min in future
  });
  it("null within the spacing interval of a same-stretch nudge", () => {
    expect(selectProtectionNudge({ ...base, lastNudgedAt: minAgo(INTERVAL_MIN - 20) })).toBeNull();
  });
  it("null in the deep-night window", () => {
    expect(selectProtectionNudge({ ...base, localHour: 3 })).toBeNull();
  });
  it("bedtime when it's late", () => {
    expect(selectProtectionNudge({ ...base, localHour: BEDTIME_HOUR })!.kind).toBe("bedtime");
    expect(selectProtectionNudge({ ...base, localHour: 1 })!.kind).toBe("bedtime");
  });
  it("food when the hero is hungry", () => {
    expect(selectProtectionNudge({ ...base, hungerStage: "hungry" })!.kind).toBe("food");
  });
  it("food in a meal window", () => {
    expect(selectProtectionNudge({ ...base, localHour: 12 })!.kind).toBe("food");
  });
  it("hydrate by default, stretch when last was hydrate (same stretch)", () => {
    expect(selectProtectionNudge(base)!.kind).toBe("hydrate");
    expect(selectProtectionNudge({ ...base, lastKind: "hydrate", lastNudgedAt: minAgo(INTERVAL_MIN + 5) })!.kind).toBe("stretch");
  });
  it("treats lastKind from before this stretch as fresh (hydrate)", () => {
    // lastNudgedAt older than stretch start -> lastKind ignored
    expect(selectProtectionNudge({ ...base, stretch: active(FIRST_NUDGE_MIN + 30), lastKind: "hydrate", lastNudgedAt: minAgo(FIRST_NUDGE_MIN + 60) })!.kind).toBe("hydrate");
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @workspace/api-server test hyperfocus`
Expected: FAIL — `Cannot find module './hyperfocus'`.

- [ ] **Step 3: Implement**

Create `artifacts/api-server/src/lib/hyperfocus.ts`:

```ts
import type { HungerStage } from "./hero-care";

export const FIRST_NUDGE_MIN = 90;
export const INTERVAL_MIN = 60;
export const STALE_SESSION_MIN = 30;
export const BEDTIME_HOUR = 23;
export const DEEP_NIGHT_START = 2;
export const MORNING = 7;
export const MEAL_WINDOWS: readonly [number, number][] = [[12, 13], [18, 19]];

export type NudgeKind = "hydrate" | "stretch" | "food" | "bedtime";

export interface ProtectionNudge {
  kind: NudgeKind;
  title: string;
  body: string;
  tag: string;
}

export interface ActiveSessionLite {
  startedAt: Date;
  lastIntervalAt: Date | null;
}

export interface Stretch {
  active: boolean;
  startedAt: Date | null;
}

/** A protected stretch = a fresh active focus session and/or held hyperfocus mode. */
export function protectedStretch(input: {
  activeSessions: ActiveSessionLite[];
  mode: string;
  hyperfocusSince: Date | null;
  now: Date;
}): Stretch {
  const starts: number[] = [];
  const staleBefore = input.now.getTime() - STALE_SESSION_MIN * 60_000;
  for (const s of input.activeSessions) {
    const activityAt = (s.lastIntervalAt ?? s.startedAt).getTime();
    if (activityAt >= staleBefore) starts.push(s.startedAt.getTime());
  }
  if (input.mode === "hyperfocus" && input.hyperfocusSince) {
    starts.push(input.hyperfocusSince.getTime());
  }
  if (starts.length === 0) return { active: false, startedAt: null };
  return { active: true, startedAt: new Date(Math.min(...starts)) };
}

const COPY: Record<NudgeKind, { title: string; body: string }> = {
  hydrate: { title: "Protecting your flow", body: "Deep in it for a while now — a sip of water?" },
  stretch: { title: "Protecting your flow", body: "You've been locked in. Stand up, roll the shoulders?" },
  food:    { title: "Protecting your flow", body: "Your hero's getting hungry — maybe grab a bite too?" },
  bedtime: { title: "It's getting late", body: "You're still going strong — want to start winding down soon? Tomorrow-you will thank you." },
};

function nudge(kind: NudgeKind): ProtectionNudge {
  return { kind, ...COPY[kind], tag: `hyperfocus-${kind}` };
}

function inMealWindow(localHour: number): boolean {
  return MEAL_WINDOWS.some(([a, b]) => localHour >= a && localHour < b);
}

/**
 * Which protection nudge to send this tick, or null. Pure and silent; anti-shame
 * (bedtime is an invitation, deep night is quiet, nothing fires while paused).
 */
export function selectProtectionNudge(input: {
  stretch: Stretch;
  now: Date;
  localHour: number;
  lastNudgedAt: Date | null;
  lastKind: NudgeKind | null;
  hungerStage: HungerStage;
  pausedUntil: Date | null;
}): ProtectionNudge | null {
  const { stretch, now, localHour } = input;
  if (!stretch.active || !stretch.startedAt) return null;
  if (input.pausedUntil && input.pausedUntil.getTime() > now.getTime()) return null;

  const durationMin = (now.getTime() - stretch.startedAt.getTime()) / 60_000;
  if (durationMin < FIRST_NUDGE_MIN) return null;

  const lastNudgeThisStretch =
    input.lastNudgedAt && input.lastNudgedAt.getTime() >= stretch.startedAt.getTime();
  if (lastNudgeThisStretch && (now.getTime() - input.lastNudgedAt!.getTime()) / 60_000 < INTERVAL_MIN) {
    return null;
  }
  const lastKind = lastNudgeThisStretch ? input.lastKind : null;

  // Deep night: never buzz through the small hours.
  if (localHour >= DEEP_NIGHT_START && localHour < MORNING) return null;
  // Bedtime window: late evening, or the hour(s) before deep-night.
  if (localHour >= BEDTIME_HOUR || localHour < DEEP_NIGHT_START) return nudge("bedtime");
  // Food: hero hungry, or a meal window.
  const hungry = input.hungerStage === "hungry" || input.hungerStage === "starving" || input.hungerStage === "fainted";
  if (hungry || inMealWindow(localHour)) return nudge("food");
  // Otherwise alternate hydrate/stretch.
  return nudge(lastKind === "hydrate" ? "stretch" : "hydrate");
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `pnpm --filter @workspace/api-server test hyperfocus`
Expected: PASS. Then full `pnpm --filter @workspace/api-server test` — green.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/hyperfocus.ts artifacts/api-server/src/lib/hyperfocus.test.ts
git commit -m "feat(api): pure hyperfocus stretch detection + anti-shame nudge selector"
```

---

## Task 3: Cron pass

**Files:** Modify `artifacts/api-server/src/lib/notification-scheduler.ts`

**Interfaces:**
- Consumes: `protectedStretch`, `selectProtectionNudge`, `NudgeKind` (`./hyperfocus`); `deriveBrainState` (`./brain-mode`); `resolveTimeZone`, `localHour` (`./date-buckets`); `hungerStage` (`./hero-care`, already imported); `focusSessionsTable`, `brainCheckinsTable` (`@workspace/db`); existing `notify`, `db`, `usersTable`, `logger`.
- Produces: `checkHyperfocusProtection()`; `"hyperfocus-protection"` appended to `tick()`'s `ran`.

- [ ] **Step 1: Add imports**

At the top of `notification-scheduler.ts`, extend the existing imports:

```ts
import { db, tasksTable, usersTable, activityTable, pushSubscriptionsTable, focusSessionsTable, brainCheckinsTable } from "@workspace/db";
import { hungerStage, hungerWarning, shouldSendFlavorPush } from "./hero-care";
import { deriveBrainState } from "./brain-mode";
import { resolveTimeZone, localHour } from "./date-buckets";
import { protectedStretch, selectProtectionNudge, type NudgeKind } from "./hyperfocus";
```
(Add `desc` to the `drizzle-orm` import: `import { eq, and, gt, desc } from "drizzle-orm";`)

- [ ] **Step 2: Implement the pass**

Add before `spawnRecurringTasks` (or anywhere among the pass functions):

```ts
async function checkHyperfocusProtection() {
  const now = new Date();
  const users = await db.select().from(usersTable);
  for (const user of users) {
    try {
      const tz = resolveTimeZone(user.timezone ?? "");
      const [latest] = await db.select().from(brainCheckinsTable)
        .where(eq(brainCheckinsTable.userId, user.id))
        .orderBy(desc(brainCheckinsTable.createdAt), desc(brainCheckinsTable.id))
        .limit(1);
      const state = deriveBrainState(latest, now, tz);

      const sessions = await db.select().from(focusSessionsTable)
        .where(and(eq(focusSessionsTable.userId, user.id), eq(focusSessionsTable.status, "active")));

      const stretch = protectedStretch({
        activeSessions: sessions.map((s) => ({ startedAt: s.startedAt, lastIntervalAt: s.lastIntervalAt })),
        mode: state.mode,
        hyperfocusSince: state.mode === "hyperfocus" ? state.since : null,
        now,
      });

      const chosen = selectProtectionNudge({
        stretch, now, localHour: localHour(now, tz),
        lastNudgedAt: user.hyperfocusNudgedAt,
        lastKind: user.hyperfocusLastKind as NudgeKind | null,
        hungerStage: hungerStage(user.lastFedAt, now),
        pausedUntil: user.hyperfocusPausedUntil,
      });

      if (chosen) {
        await notify(user.id, chosen.title, chosen.body, chosen.tag);
        await db.update(usersTable)
          .set({ hyperfocusNudgedAt: now, hyperfocusLastKind: chosen.kind })
          .where(eq(usersTable.id, user.id));
      }
    } catch (err) {
      logger.error({ err, userId: user.id }, "Hyperfocus-protection pass failed for user");
    }
  }
}
```

- [ ] **Step 3: Register in `tick()`**

In `tick()`, after the hero-care lines:

```ts
  await checkHeroCare();
  ran.push("hero-care");

  await checkHyperfocusProtection();
  ran.push("hyperfocus-protection");
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @workspace/api-server typecheck` → PASS; `pnpm --filter @workspace/api-server test` → green (no regressions; pure logic already covered by Task 2). Behavior exercised in Task 8's cron-tick e2e.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/notification-scheduler.ts
git commit -m "feat(api): checkHyperfocusProtection cron pass (mirrors checkHeroCare)"
```

---

## Task 4: Endpoints — timezone + pause + brain-state field

**Files:**
- Modify `artifacts/api-server/src/routes/users.ts`
- Modify `artifacts/api-server/src/routes/brain.ts`

**Interfaces:**
- Produces: `PUT /users/me/timezone { tz }` → `{ ok: true }` (400/401); `POST /users/me/hyperfocus/pause { minutes }` → `{ pausedUntil: string | null }` (400/401); `hyperfocusPausedUntil: string | null` added to the brain-state responses.

- [ ] **Step 1: Add the two `users.ts` routes**

`resolveTimeZone` is already imported in `users.ts`. Add after `PATCH /users/me` (line ~61):

```ts
router.put("/users/me/timezone", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const tz = String((req.body as { tz?: unknown }).tz ?? "");
  if (!tz) { res.status(400).json({ error: "tz is required" }); return; }
  // Reject a bogus zone rather than silently storing garbage.
  try { new Intl.DateTimeFormat(undefined, { timeZone: tz }); }
  catch { res.status(400).json({ error: "invalid IANA timezone" }); return; }

  await db.update(usersTable).set({ timezone: tz }).where(eq(usersTable.id, userId));
  res.json({ ok: true });
});

router.post("/users/me/hyperfocus/pause", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;
  const minutes = Number((req.body as { minutes?: unknown }).minutes);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
    res.status(400).json({ error: "minutes must be between 0 and 1440" });
    return;
  }
  const pausedUntil = minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;
  await db.update(usersTable).set({ hyperfocusPausedUntil: pausedUntil }).where(eq(usersTable.id, userId));
  res.json({ pausedUntil: pausedUntil ? pausedUntil.toISOString() : null });
});
```

- [ ] **Step 2: Add `hyperfocusPausedUntil` to brain-state**

In `artifacts/api-server/src/routes/brain.ts`: import `usersTable`, extend `serializeState` to accept the paused value, and pass it from both routes.

Change the import (line 3):
```ts
import { db, brainCheckinsTable, usersTable } from "@workspace/db";
```
Change `serializeState` (lines 8–15):
```ts
function serializeState(s: BrainState, hyperfocusPausedUntil: Date | null) {
  return {
    mode: s.mode,
    since: s.since ? s.since.toISOString() : null,
    expiresAt: s.expiresAt ? s.expiresAt.toISOString() : null,
    checkedInToday: s.checkedInToday,
    hyperfocusPausedUntil: hyperfocusPausedUntil ? hyperfocusPausedUntil.toISOString() : null,
  };
}

async function pausedUntilFor(userId: number): Promise<Date | null> {
  const [u] = await db.select({ p: usersTable.hyperfocusPausedUntil }).from(usersTable).where(eq(usersTable.id, userId));
  return u?.p ?? null;
}
```
In `GET /brain/state` (line 32-33):
```ts
  const latest = await latestCheckin(userId);
  const paused = await pausedUntilFor(userId);
  res.json(serializeState(deriveBrainState(latest, new Date(), tz), paused));
```
In `POST /brain/checkins` (line 58):
```ts
  res.status(201).json(serializeState(deriveBrainState(inserted!, new Date(), tz), await pausedUntilFor(userId)));
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @workspace/api-server typecheck` (run `pnpm run typecheck:libs` first if phantom `@workspace/db` errors) → PASS; `pnpm --filter @workspace/api-server test` → green.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/users.ts artifacts/api-server/src/routes/brain.ts
git commit -m "feat(api): persist timezone + hyperfocus pause; expose pausedUntil on brain-state"
```

---

## Task 5: OpenAPI + codegen

**Files:** Modify `lib/api-spec/openapi.yaml`

**Interfaces:** Produces generated `usePutMyTimezone`, `usePauseHyperfocus`, and `BrainState.hyperfocusPausedUntil`.

- [ ] **Step 1: Add `hyperfocusPausedUntil` to `BrainState`**

In the `BrainState` schema (~line 2912): add to `required` and `properties`:
```yaml
      required: [mode, since, expiresAt, checkedInToday, hyperfocusPausedUntil]
      properties:
        # ...existing...
        hyperfocusPausedUntil:
          type: ["string", "null"]
          format: date-time
          description: When protection is paused until, or null
```

- [ ] **Step 2: Add named request schemas**

In `components/schemas` (near `BrainCheckinRequest`), add (named to avoid orval's `${operationId}Body` collision — see the Adaptive Difficulty `ApplyDifficultyInput` precedent):
```yaml
    TimezoneInput:
      type: object
      required: [tz]
      properties:
        tz:
          type: string
          description: IANA timezone
    HyperfocusPauseInput:
      type: object
      required: [minutes]
      properties:
        minutes:
          type: integer
          description: Minutes to pause protection; 0 resumes
```

- [ ] **Step 3: Add the two operations**

After the `/brain/checkins` block (or near the other `/users/me` paths):
```yaml
  /users/me/timezone:
    put:
      operationId: putMyTimezone
      tags: [users]
      summary: Persist the user's IANA timezone
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/TimezoneInput"
      responses:
        "200":
          description: Saved
          content:
            application/json:
              schema:
                type: object
                required: [ok]
                properties: { ok: { type: boolean } }
        "400":
          description: Missing or invalid timezone
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"

  /users/me/hyperfocus/pause:
    post:
      operationId: pauseHyperfocus
      tags: [users]
      summary: Pause (or resume) hyperfocus protection nudges
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/HyperfocusPauseInput"
      responses:
        "200":
          description: New paused-until (null when resumed)
          content:
            application/json:
              schema:
                type: object
                required: [pausedUntil]
                properties:
                  pausedUntil:
                    type: ["string", "null"]
                    format: date-time
        "400":
          description: Invalid minutes
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
```

- [ ] **Step 4: Codegen + verify**

Run: `pnpm --filter @workspace/api-spec codegen` (runs orval + `typecheck:libs`) → PASS. Confirm `usePutMyTimezone`, `usePauseHyperfocus`, and `hyperfocusPausedUntil` on the generated `BrainState` exist. If a symbol is missing, fix the yaml and re-run.

- [ ] **Step 5: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react
git commit -m "feat(api-spec): timezone + hyperfocus-pause operations; brain-state pausedUntil; regen client"
```

---

## Task 6: Client — persist timezone on authed load

**Files:** Modify `artifacts/focusquest/src/App.tsx`

**Interfaces:** Consumes generated `usePutMyTimezone`; `browserTimeZone` (already imported).

- [ ] **Step 1: Fire the timezone save once when authed**

In `App.tsx`, import the hook and `useEffect` (add to existing imports), then in `OnboardingGate` (line 130) fire it once:

```tsx
import { useEffect } from "react";
import { useGetMyStats, usePutMyTimezone } from "@workspace/api-client-react";
// ...
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { data: stats, isLoading } = useGetMyStats({ tz: browserTimeZone() });
  const putTz = usePutMyTimezone();
  useEffect(() => {
    // Fire-and-forget: capture the browser's timezone once per authed load so
    // cron can compute the user's local time (bedtime / quiet hours).
    putTz.mutate({ data: { tz: browserTimeZone() } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ...rest unchanged
```

> Verify the generated `usePutMyTimezone` mutate arg shape (`{ data: { tz } }`) against the emitted signature and match it exactly.

- [ ] **Step 2: Verify**

Run: `pnpm --filter @workspace/focusquest typecheck` → PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/focusquest/src/App.tsx
git commit -m "feat(web): persist browser timezone on authed load"
```

---

## Task 7: Client — protection pause control

**Files:**
- Create `artifacts/focusquest/src/components/protection-pause.tsx`
- Modify `artifacts/focusquest/src/pages/focus.tsx` (mount in the active-session branch, ~line 182)
- Modify `artifacts/focusquest/src/components/layout.tsx` (mount in the hyperfocus banner, ~line 272)

**Interfaces:** Consumes generated `usePauseHyperfocus`, `useGetBrainState`, `getGetBrainStateQueryKey`; `browserTimeZone`; `Button`.

- [ ] **Step 1: Build the component**

Create `artifacts/focusquest/src/components/protection-pause.tsx`. Read `use-difficulty.ts` for the invalidation pattern and match the app's `Button`/token style:

```tsx
import { useQueryClient } from "@tanstack/react-query";
import { usePauseHyperfocus, useGetBrainState, getGetBrainStateQueryKey } from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { browserTimeZone } from "@/lib/timezone";

const PAUSE_MINUTES = 120;

/** Pause/resume hyperfocus protection nudges for the current stretch. */
export function ProtectionPause() {
  const queryClient = useQueryClient();
  const { data: state } = useGetBrainState({ tz: browserTimeZone() });
  const pause = usePauseHyperfocus();

  const pausedUntil = state?.hyperfocusPausedUntil ? new Date(state.hyperfocusPausedUntil) : null;
  const isPaused = !!pausedUntil && pausedUntil.getTime() > Date.now();

  const setMinutes = (minutes: number) =>
    pause.mutate(
      { data: { minutes } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetBrainStateQueryKey() }) },
    );

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pause.isPending}
      onClick={() => setMinutes(isPaused ? 0 : PAUSE_MINUTES)}
      className="h-7 px-2 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      {isPaused ? "Protection paused · Resume" : "Pause protection"}
    </Button>
  );
}
```

> Match the generated `usePauseHyperfocus` mutate arg shape (`{ data: { minutes } }`) to orval's actual output. `useGetBrainState` returning `hyperfocusPausedUntil` comes from Task 5's regen.

- [ ] **Step 2: Mount in the focus timer's active-session branch**

In `focus.tsx`, import `ProtectionPause` and render it inside the `if (active && state && active.status === "active")` block (~line 182), in a sensible spot near the running-timer controls: `<ProtectionPause />`.

- [ ] **Step 3: Mount in the hyperfocus banner**

In `layout.tsx`, the hyperfocus banner (~lines 272–276) currently reads:
```tsx
          {brainState?.mode === BrainMode.hyperfocus && (
            <div className="mb-4 rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2 text-xs text-muted-foreground">
              Flow protected — check-in prompts muted. Break when you're ready.
            </div>
          )}
```
Add the pause control inside it (import `ProtectionPause`):
```tsx
          {brainState?.mode === BrainMode.hyperfocus && (
            <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2 text-xs text-muted-foreground">
              <span>Flow protected — check-in prompts muted. Break when you're ready.</span>
              <ProtectionPause />
            </div>
          )}
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @workspace/focusquest typecheck` → PASS. (Behavior is exercised in Task 8's e2e.)

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/components/protection-pause.tsx artifacts/focusquest/src/pages/focus.tsx artifacts/focusquest/src/components/layout.tsx
git commit -m "feat(web): pause-protection control in focus timer + hyperfocus banner"
```

---

## Task 8: Verification (controller-run)

**Files:** none (verification only)

- [ ] **Step 1: Full test sweep**

Run `pnpm --filter @workspace/api-server test` and `pnpm --filter @workspace/focusquest test` → all green.

- [ ] **Step 2: Build + boot**

Build the api-server (`pnpm --filter @workspace/api-server build`); `preview_start` `api` and `frontend`. Confirm clean boot + no client console errors.

- [ ] **Step 3: Exercise the cron pass (no auth needed)**

With `CRON_SECRET` from `.env`, POST the tick and confirm the pass runs without error and is listed:
```bash
curl -s -X POST -H "authorization: Bearer $CRON_SECRET" http://localhost:8080/api/cron/tick
# expect {"ok":true,"ran":[...,"hero-care","hyperfocus-protection"]}
```

- [ ] **Step 4: Endpoint guards**

Confirm unauth `PUT /api/users/me/timezone` and `POST /api/users/me/hyperfocus/pause` → 401; `GET /api/brain/state` still 200/401 as expected and its shape carries `hyperfocusPausedUntil`.

- [ ] **Step 5: Defer the authed drive**

Authed click-through (pause toggle in the focus/hyperfocus UI; a real long-session nudge) is deferred to Chad via the PR checklist (credential login is off-limits for the agent).

---

## Self-Review

**Spec coverage:** §1 data model → T1. §2 `protectedStretch` → T2. §3 `selectProtectionNudge` → T2. §4 cron pass → T3. §5 timezone persistence → T4 (endpoint) + T6 (client). §6 pause (endpoint + brain-state + UI) → T4 + T7. §7 anti-shame → enforced in T2 (copy, deep-night, paused, floor) + T3 (no activity writes) + honored in copy. §8 edge cases → T2 (stale/earliest/deep-night) + T4 (tz null via `resolveTimeZone` fallback). §9 testing → T2 units; T3/T4/T6/T7 typecheck + T8 e2e. §10 sequencing → task order + Global Constraints.

**Placeholder scan:** none. Three "match the generated mutate shape" notes (T6, T7) point at live orval output, not missing logic.

**Type consistency:** `NudgeKind`/`ProtectionNudge`/`Stretch`/`ActiveSessionLite` defined in T2, consumed in T3. `deriveBrainState` `.since` used for `hyperfocusSince` (T3). `serializeState(s, pausedUntil)` signature consistent across both brain routes (T4). `hyperfocusPausedUntil` field name identical in T4 (server), T5 (schema), T7 (client read). Endpoint operationIds `putMyTimezone`/`pauseHyperfocus` (T5) match the hook names consumed in T6/T7.
