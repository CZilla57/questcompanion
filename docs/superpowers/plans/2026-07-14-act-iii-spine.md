# Act III Spine Implementation Plan — Brain Check-In & Modes, Momentum Engine, Rescue

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Act III's spine — one-tap brain check-ins that reshape the UI (with a Frozen → Emergency Mode escalation), a mode/time-aware Momentum Engine that absorbs Pick Three, and an "I'm Stuck" rescue sheet — per the approved spec `docs/superpowers/specs/2026-07-14-act-iii-spine-design.md`.

**Architecture:** Two new additive tables (`brain_checkins`, `rescue_events`); mode is always *derived* by a pure function (4h TTL + local-day bound). Momentum is a pure scorer behind `GET /tasks/momentum`, which replaces `GET /tasks/recommend`. The client gets a header chip, a daily prompt card, a momentum board on the tasks page, a full-screen Emergency Mode, and a rescue sheet — all through orval-generated hooks. The only AI call is the existing breakdown endpoint.

**Tech Stack:** pnpm workspace · Drizzle + Neon Postgres (`@workspace/db`) · Express 5 (`artifacts/api-server`) · openapi.yaml → orval → `@workspace/api-client-react` (TanStack Query) · React 19 + Vite + shadcn/ui (`artifacts/focusquest`) · vitest.

## Global Constraints

- **Branch:** all work on `feat/act3-spine` (already exists; spec is committed on it). Verify with `git branch --show-current` before every commit — other sessions may share this working tree.
- **Never hand-edit** anything under `lib/*/src/generated/` — regenerate with `pnpm --filter @workspace/api-spec codegen` after any `lib/api-spec/openapi.yaml` change.
- **DB pushes:** `pnpm --filter @workspace/db push` requires `DATABASE_URL` exported first (drizzle.config.ts does not read `.env`). From repo root, Git Bash: `export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"`. The first push run is authoritative; a verification re-run may be blocked by a Neon guardrail.
- **Tests:** `pnpm --filter @workspace/api-server test` and `pnpm --filter @workspace/focusquest test`. Single file: append `-- <name>`. Root gate: `pnpm typecheck`.
- **Anti-shame law (spec §"Design law"):** no counters over check-ins/rescues anywhere; never write these tables to `activityTable`; timer-at-zero is never a failure state (no red, no "time's up"); waiting quests are "waiting patiently", never alarmed "overdue!"; frozen mode *de-prioritizes* high priority.
- **Modes never gate features.** UI reshapes; nothing locks.
- **Timezone:** client always sends `browserTimeZone()` (`artifacts/focusquest/src/lib/timezone.ts`); server always passes it through `resolveTimeZone()` (`artifacts/api-server/src/lib/date-buckets.ts`).
- **Express route order:** `/tasks/momentum` must be registered *before* `tasksRouter` (which defines `/tasks/:id`), exactly as noted in Task 6.
- **Commits:** conventional style (`feat(db): …`, `feat(api): …`, `feat(web): …`), each ending with the line `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Windows line-ending warnings (`LF will be replaced by CRLF`) on commit are harmless — ignore.

---

### Task 1: DB schema — `brain_checkins` + `rescue_events`

**Files:**
- Create: `lib/db/src/schema/brain-checkins.ts`
- Create: `lib/db/src/schema/rescue-events.ts`
- Modify: `lib/db/src/schema/index.ts` (17 lines — append two exports)

**Interfaces:**
- Consumes: `usersTable` (`./users`), `tasksTable` (`./tasks`) — existing.
- Produces: `brainCheckinsTable`, `BrainCheckin`, `rescueEventsTable`, `RescueEvent` — imported later via `@workspace/db` by Tasks 4, 6, 7.

There are no unit tests for schema files anywhere in the repo (they're validated by typecheck + push); follow that pattern.

- [ ] **Step 1: Write `lib/db/src/schema/brain-checkins.ts`**

```ts
import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// One row per one-tap check-in. Mode is always DERIVED from the newest row
// (4h TTL + local-day bound) — never stored as user state. Never written to
// the activity feed (anti-shame: modes must not leak into ally surfaces).
export const brainCheckinsTable = pgTable("brain_checkins", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id),
  mode:      text("mode").notNull(),   // 'focused' | 'distracted' | 'frozen' | 'hyperfocus' | 'neutral'
  source:    text("source").notNull().default("tap"), // 'tap' | 'daily_prompt' | 'emergency_exit'
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // Serves the "newest check-in for user" lookup on every state read.
  index("brain_checkins_user_time_idx").on(t.userId, t.createdAt),
]);

export type BrainCheckin = typeof brainCheckinsTable.$inferSelect;
```

- [ ] **Step 2: Write `lib/db/src/schema/rescue-events.ts`**

```ts
import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { tasksTable } from "./tasks";

// One row per taken rescue intervention — Act V training data. Fire-and-forget
// from the client; never surfaced back to the user as counts (anti-shame).
export const rescueEventsTable = pgTable("rescue_events", {
  id:           serial("id").primaryKey(),
  userId:       integer("user_id").notNull().references(() => usersTable.id),
  taskId:       integer("task_id").references(() => tasksTable.id, { onDelete: "set null" }),
  blocker:      text("blocker").notNull(),      // 'too_big' | 'cant_start' | 'overwhelmed' | 'wrong_quest'
  intervention: text("intervention").notNull(), // 'breakdown' | 'micro_start' | 'emergency_mode' | 'reroll'
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

export type RescueEvent = typeof rescueEventsTable.$inferSelect;
```

- [ ] **Step 3: Append to `lib/db/src/schema/index.ts`**

After the existing `export * from "./initiation-awards";` line add:

```ts
export * from "./brain-checkins";
export * from "./rescue-events";
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck:libs` (repo root)
Expected: exits 0.

- [ ] **Step 5: Push schema to Neon**

Run (Git Bash, repo root):

```bash
export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"
pnpm --filter @workspace/db push
```

Expected: `[✓] Changes applied` — two new tables, no destructive prompt (purely additive). If a prompt appears, STOP and re-read the diff — do not confirm a destructive change.

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/schema/brain-checkins.ts lib/db/src/schema/rescue-events.ts lib/db/src/schema/index.ts
git commit -m "feat(db): brain_checkins + rescue_events tables (Act III spine)"
```

---

### Task 2: `brain-mode` lib — derived mode state (TDD)

**Files:**
- Create: `artifacts/api-server/src/lib/brain-mode.ts`
- Test: `artifacts/api-server/src/lib/brain-mode.test.ts`

**Interfaces:**
- Consumes: `localDateKey`, `localDayStartUtc` from `./date-buckets` (existing).
- Produces (used by Tasks 4, 5, 6):
  - `BRAIN_MODES: readonly ["focused","distracted","frozen","hyperfocus","neutral"]`, `type BrainMode`
  - `CHECKIN_SOURCES: readonly ["tap","daily_prompt","emergency_exit"]`, `type CheckinSource`
  - `MODE_TTL_HOURS = 4`
  - `isBrainMode(v: unknown): v is BrainMode`, `isCheckinSource(v: unknown): v is CheckinSource`
  - `modeExpiresAt(createdAt: Date, tz: string): Date` — min(createdAt + 4h, next local midnight after createdAt)
  - `interface BrainState { mode: BrainMode; since: Date | null; expiresAt: Date | null; checkedInToday: boolean }`
  - `deriveBrainState(latest: { mode: string; createdAt: Date } | undefined, now: Date, tz: string): BrainState`

- [ ] **Step 1: Write the failing tests** — `artifacts/api-server/src/lib/brain-mode.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { deriveBrainState, modeExpiresAt, isBrainMode, isCheckinSource, MODE_TTL_HOURS } from "./brain-mode";

// Noon UTC = comfortably mid-day in both test zones (Chicago = -5/-6, Tokyo = +9).
const NOW = new Date("2026-07-14T12:00:00Z");

describe("deriveBrainState", () => {
  it("is neutral with null timestamps when there is no check-in", () => {
    expect(deriveBrainState(undefined, NOW, "America/Chicago")).toEqual({
      mode: "neutral", since: null, expiresAt: null, checkedInToday: false,
    });
  });

  it("returns a live mode inside the TTL on the same local day", () => {
    const createdAt = new Date("2026-07-14T11:00:00Z"); // 1h ago
    const s = deriveBrainState({ mode: "distracted", createdAt }, NOW, "America/Chicago");
    expect(s.mode).toBe("distracted");
    expect(s.since).toEqual(createdAt);
    expect(s.expiresAt).toEqual(new Date("2026-07-14T15:00:00Z")); // createdAt + 4h (before local midnight)
    expect(s.checkedInToday).toBe(true);
  });

  it("expires at exactly the 4h TTL boundary", () => {
    const createdAt = new Date(NOW.getTime() - MODE_TTL_HOURS * 3_600_000);
    const s = deriveBrainState({ mode: "focused", createdAt }, NOW, "America/Chicago");
    expect(s.mode).toBe("neutral");
    expect(s.checkedInToday).toBe(true); // expired but still today's check-in
  });

  it("dies at the local day boundary even inside the TTL (east of UTC)", () => {
    // 2026-07-14T14:00:00Z = 23:00 July 14 in Tokyo; 16:00Z = 01:00 July 15 Tokyo.
    const createdAt = new Date("2026-07-14T14:00:00Z");
    const later = new Date("2026-07-14T16:00:00Z"); // only 2h later, but next Tokyo day
    const s = deriveBrainState({ mode: "focused", createdAt }, later, "Asia/Tokyo");
    expect(s.mode).toBe("neutral");
    expect(s.checkedInToday).toBe(false); // the check-in belongs to Tokyo-yesterday
  });

  it("stays live across the UTC midnight when the local day hasn't ended (west of UTC)", () => {
    // 2026-07-14T23:30:00Z = 18:30 July 14 in Chicago; 01:00Z next date = 20:00 July 14 Chicago.
    const createdAt = new Date("2026-07-14T23:30:00Z");
    const later = new Date("2026-07-15T01:00:00Z");
    const s = deriveBrainState({ mode: "frozen", createdAt }, later, "America/Chicago");
    expect(s.mode).toBe("frozen");
    expect(s.checkedInToday).toBe(true);
  });

  it("a neutral check-in clears and does NOT resurrect an older mode", () => {
    // deriveBrainState only ever sees the newest row — a neutral newest row is a clear.
    const createdAt = new Date("2026-07-14T11:30:00Z");
    const s = deriveBrainState({ mode: "neutral", createdAt }, NOW, "America/Chicago");
    expect(s).toEqual({ mode: "neutral", since: null, expiresAt: null, checkedInToday: true });
  });

  it("treats an unknown stored mode as neutral (defensive)", () => {
    const s = deriveBrainState({ mode: "zoomies", createdAt: new Date("2026-07-14T11:00:00Z") }, NOW, "America/Chicago");
    expect(s.mode).toBe("neutral");
  });

  it("falls back to UTC on an invalid tz without throwing", () => {
    const createdAt = new Date("2026-07-14T11:00:00Z");
    const s = deriveBrainState({ mode: "focused", createdAt }, NOW, "not/a-zone");
    expect(s.mode).toBe("focused");
  });
});

describe("modeExpiresAt", () => {
  it("is createdAt+4h when local midnight is further away", () => {
    const createdAt = new Date("2026-07-14T15:00:00Z"); // 10:00 Chicago
    expect(modeExpiresAt(createdAt, "America/Chicago")).toEqual(new Date("2026-07-14T19:00:00Z"));
  });

  it("is the next local midnight when that comes first", () => {
    const createdAt = new Date("2026-07-15T03:00:00Z"); // 22:00 July 14 Chicago (CDT = UTC-5)
    // Chicago midnight July 15 = 2026-07-15T05:00:00Z — closer than createdAt+4h (07:00Z).
    expect(modeExpiresAt(createdAt, "America/Chicago")).toEqual(new Date("2026-07-15T05:00:00Z"));
  });
});

describe("guards", () => {
  it("accepts every mode and rejects junk", () => {
    for (const m of ["focused", "distracted", "frozen", "hyperfocus", "neutral"]) {
      expect(isBrainMode(m)).toBe(true);
    }
    expect(isBrainMode("angry")).toBe(false);
    expect(isBrainMode(3)).toBe(false);
  });
  it("accepts every source and rejects junk", () => {
    for (const s of ["tap", "daily_prompt", "emergency_exit"]) {
      expect(isCheckinSource(s)).toBe(true);
    }
    expect(isCheckinSource("cron")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/api-server test -- brain-mode`
Expected: FAIL — cannot resolve `./brain-mode`.

- [ ] **Step 3: Write `artifacts/api-server/src/lib/brain-mode.ts`**

```ts
import { localDateKey, localDayStartUtc, resolveTimeZone } from "./date-buckets";

export const BRAIN_MODES = ["focused", "distracted", "frozen", "hyperfocus", "neutral"] as const;
export type BrainMode = (typeof BRAIN_MODES)[number];

export const CHECKIN_SOURCES = ["tap", "daily_prompt", "emergency_exit"] as const;
export type CheckinSource = (typeof CHECKIN_SOURCES)[number];

export const MODE_TTL_HOURS = 4;

export function isBrainMode(v: unknown): v is BrainMode {
  return typeof v === "string" && (BRAIN_MODES as readonly string[]).includes(v);
}

export function isCheckinSource(v: unknown): v is CheckinSource {
  return typeof v === "string" && (CHECKIN_SOURCES as readonly string[]).includes(v);
}

/** min(createdAt + 4h, the next local midnight after createdAt). */
export function modeExpiresAt(createdAt: Date, tz: string): Date {
  const zone = resolveTimeZone(tz);
  const ttlEnd = new Date(createdAt.getTime() + MODE_TTL_HOURS * 3_600_000);
  // Next local midnight: UTC-anchored day arithmetic on the local date key is
  // DST-safe (same approach as buildDayDates).
  const anchor = new Date(localDateKey(createdAt, zone) + "T00:00:00Z");
  anchor.setUTCDate(anchor.getUTCDate() + 1);
  const nextMidnight = localDayStartUtc(anchor.toISOString().split("T")[0]!, zone);
  return ttlEnd < nextMidnight ? ttlEnd : nextMidnight;
}

export interface BrainState {
  mode: BrainMode;
  since: Date | null;
  expiresAt: Date | null;
  checkedInToday: boolean;
}

/**
 * Mode is derived, never stored. Only the NEWEST check-in row is consulted, so
 * a `neutral` row genuinely clears — older rows can never resurrect a mode.
 */
export function deriveBrainState(
  latest: { mode: string; createdAt: Date } | undefined,
  now: Date,
  tz: string,
): BrainState {
  const zone = resolveTimeZone(tz);
  const checkedInToday =
    !!latest && localDateKey(latest.createdAt, zone) === localDateKey(now, zone);

  if (!latest || !isBrainMode(latest.mode) || latest.mode === "neutral") {
    return { mode: "neutral", since: null, expiresAt: null, checkedInToday };
  }
  const expiresAt = modeExpiresAt(latest.createdAt, zone);
  if (now.getTime() >= expiresAt.getTime()) {
    return { mode: "neutral", since: null, expiresAt: null, checkedInToday };
  }
  return { mode: latest.mode, since: latest.createdAt, expiresAt, checkedInToday };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/api-server test -- brain-mode`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/brain-mode.ts artifacts/api-server/src/lib/brain-mode.test.ts
git commit -m "feat(api): derived brain-mode state — 4h TTL + local-day bound, tz-aware"
```

---

### Task 3: OpenAPI contract + codegen

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (paths near line 303 and 654; schemas near line 2702)
- Regenerated (never hand-edit): `lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/*`

**Interfaces:**
- Produces generated hooks used by Tasks 8–13: `useGetBrainState`, `useCreateBrainCheckin`, `useGetTasksMomentum`, `useCreateRescueEvent`, plus `getGetBrainStateQueryKey()`, `getGetTasksMomentumQueryKey()` and generated types `BrainMode`, `BrainState`, `MomentumResponse`, `MomentumSuggestion`.
- Removes: `getTaskRecommendation` operation + `TaskRecommendation` schema (the old card used a raw `fetch`, so nothing else compiles against them).

- [ ] **Step 1: Delete the `/tasks/recommend` path block** (lines ~303–321) — the whole block from `  /tasks/recommend:` up to (not including) `  /tasks:`.

- [ ] **Step 2: Add new paths.** Immediately after the `/tasks/{id}/focus:` block (ends ~line 684, before `  /tasks/{id}/breakdown:`), insert:

```yaml
  /tasks/momentum:
    get:
      operationId: getTasksMomentum
      tags: [tasks]
      summary: Mode- and time-aware next-win suggestions (supersedes /tasks/recommend)
      parameters:
        - name: minutes
          in: query
          schema:
            type: ["integer", "null"]
          description: Available minutes right now (optional)
        - name: tz
          in: query
          schema:
            type: string
          description: IANA timezone for local-hour and local-day scoring
        - name: exclude
          in: query
          schema:
            type: string
          description: Comma-separated task IDs to exclude (skip loop)
      responses:
        "200":
          description: Ranked suggestions, primary first
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/MomentumResponse"

  /brain/state:
    get:
      operationId: getBrainState
      tags: [brain]
      summary: Current derived brain mode (4h TTL, local-day bound)
      parameters:
        - name: tz
          in: query
          schema:
            type: string
          description: IANA timezone for expiry and checkedInToday derivation
      responses:
        "200":
          description: Derived state — single source of truth for chip, board, momentum
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/BrainState"

  /brain/checkins:
    post:
      operationId: createBrainCheckin
      tags: [brain]
      summary: One-tap brain check-in
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/BrainCheckinRequest"
      responses:
        "201":
          description: Derived state after this check-in
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/BrainState"
        "422":
          description: Unknown mode or source
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"

  /rescue/events:
    post:
      operationId: createRescueEvent
      tags: [brain]
      summary: Log a taken rescue intervention (fire-and-forget)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/RescueEventRequest"
      responses:
        "201":
          description: Logged
          content:
            application/json:
              schema:
                type: object
                required: [id]
                properties:
                  id:
                    type: integer
        "404":
          description: taskId given but not owned by the caller
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
        "422":
          description: Unknown blocker or intervention
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorEnvelope"
```

- [ ] **Step 3: Replace the `TaskRecommendation` schema** (lines ~2702–2715, the whole block up to `    InsightsCategoryBreakdown:`) with:

```yaml
    BrainMode:
      type: string
      enum: [focused, distracted, frozen, hyperfocus, neutral]

    BrainCheckinSource:
      type: string
      enum: [tap, daily_prompt, emergency_exit]

    BrainState:
      type: object
      required: [mode, since, expiresAt, checkedInToday]
      properties:
        mode:
          $ref: "#/components/schemas/BrainMode"
        since:
          type: ["string", "null"]
          format: date-time
        expiresAt:
          type: ["string", "null"]
          format: date-time
        checkedInToday:
          type: boolean

    BrainCheckinRequest:
      type: object
      required: [mode, tz]
      properties:
        mode:
          $ref: "#/components/schemas/BrainMode"
        source:
          $ref: "#/components/schemas/BrainCheckinSource"
        tz:
          type: string

    MomentumSuggestion:
      type: object
      required: [task, reason, kind]
      properties:
        task:
          $ref: "#/components/schemas/Task"
        reason:
          type: string
        kind:
          type: string
          enum: [primary, alternate]

    MomentumResponse:
      type: object
      required: [mode, suggestions]
      properties:
        mode:
          $ref: "#/components/schemas/BrainMode"
        suggestions:
          type: array
          items:
            $ref: "#/components/schemas/MomentumSuggestion"

    RescueEventRequest:
      type: object
      required: [blocker, intervention]
      properties:
        taskId:
          type: ["integer", "null"]
        blocker:
          type: string
          enum: [too_big, cant_start, overwhelmed, wrong_quest]
        intervention:
          type: string
          enum: [breakdown, micro_start, emergency_mode, reroll]
```

- [ ] **Step 4: Regenerate + typecheck**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: orval writes `lib/api-client-react/src/generated/` + `lib/api-zod/src/generated/` and the trailing `typecheck:libs` exits 0. Grep to confirm the new hooks exist:

Run: `grep -l "useGetTasksMomentum" lib/api-client-react/src/generated/ -r`
Expected: at least one file.

- [ ] **Step 5: Full typecheck (client must not reference the removed operation)**

Run: `pnpm typecheck`
Expected: exits 0 (the old RecommendCard uses a raw `fetch`, so removal breaks nothing yet).

- [ ] **Step 6: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "feat(api-spec): brain checkins/state, tasks/momentum, rescue events; drop tasks/recommend"
```

---

### Task 4: `routes/brain.ts` — check-in + state endpoints

**Files:**
- Create: `artifacts/api-server/src/routes/brain.ts`
- Modify: `artifacts/api-server/src/routes/index.ts` (import + `router.use(brainRouter);` after `questlinesRouter`)

**Interfaces:**
- Consumes: `deriveBrainState`, `isBrainMode`, `isCheckinSource` (Task 2); `brainCheckinsTable` (Task 1); auth pattern `req.isAuthenticated()` / `req.gameUserId` (house style, see `routes/dopamine-rewards.ts`).
- Produces: `POST /brain/checkins` → 201 `BrainState` JSON `{ mode, since, expiresAt, checkedInToday }` (dates as ISO strings or null); `GET /brain/state?tz=` → 200 same shape. Consumed by generated hooks in Tasks 8–13.

Validation is enum-membership via the Task-2 guards (already unit-tested); the route stays thin like every route in this repo (there is no route-test harness — see Task 14's spec amendment).

- [ ] **Step 1: Write `artifacts/api-server/src/routes/brain.ts`**

```ts
import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, brainCheckinsTable } from "@workspace/db";
import { deriveBrainState, isBrainMode, isCheckinSource, type BrainState } from "../lib/brain-mode";

const router: IRouter = Router();

function serializeState(s: BrainState) {
  return {
    mode: s.mode,
    since: s.since ? s.since.toISOString() : null,
    expiresAt: s.expiresAt ? s.expiresAt.toISOString() : null,
    checkedInToday: s.checkedInToday,
  };
}

async function latestCheckin(userId: number) {
  const [row] = await db
    .select()
    .from(brainCheckinsTable)
    .where(eq(brainCheckinsTable.userId, userId))
    .orderBy(desc(brainCheckinsTable.createdAt), desc(brainCheckinsTable.id))
    .limit(1);
  return row;
}

router.get("/brain/state", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;
  const tz = String(req.query.tz ?? "");

  const latest = await latestCheckin(userId);
  res.json(serializeState(deriveBrainState(latest, new Date(), tz)));
});

router.post("/brain/checkins", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;

  const mode: unknown = req.body?.mode;
  const source: unknown = req.body?.source ?? "tap";
  const tz = String(req.body?.tz ?? "");

  if (!isBrainMode(mode)) {
    res.status(422).json({ error: "Unknown mode" });
    return;
  }
  if (!isCheckinSource(source)) {
    res.status(422).json({ error: "Unknown source" });
    return;
  }

  const [inserted] = await db
    .insert(brainCheckinsTable)
    .values({ userId, mode, source })
    .returning();

  res.status(201).json(serializeState(deriveBrainState(inserted!, new Date(), tz)));
});

export default router;
```

- [ ] **Step 2: Mount it.** In `artifacts/api-server/src/routes/index.ts` add `import brainRouter from "./brain";` with the other imports and `router.use(brainRouter);` after `router.use(questlinesRouter);`.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @workspace/api-server typecheck` then `pnpm --filter @workspace/api-server test`
Expected: both exit 0 (existing suites untouched).

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/brain.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(api): POST /brain/checkins + GET /brain/state"
```

---

### Task 5: Momentum scorer lib (TDD)

**Files:**
- Create: `artifacts/api-server/src/lib/momentum.ts`
- Test: `artifacts/api-server/src/lib/momentum.test.ts`

**Interfaces:**
- Consumes: `assignPoints`, `MORNING_FOCUS_CATEGORIES`, `EVENING_WINDDOWN_CATEGORIES` from `./auto-points`; `type BrainMode` from `./brain-mode`.
- Produces (used by Task 6):

```ts
export interface MomentumTask {
  id: number; title: string; priority: string; category: string;
  estimatedMinutes: number | null; createdAt: Date; dueDate: string | null;
  isAnchored: boolean; isDailyFocus: boolean; focusDate: string | null;
  stepsDone: number; stepsOpen: number;
}
export interface MomentumContext {
  mode: BrainMode; minutes?: number; now: Date; localHour: number;
  todayStr: string; completedTodayCategories: ReadonlySet<string>;
}
export interface MomentumScored { taskId: number; score: number; reason: string; }
export function rankMomentum(tasks: MomentumTask[], ctx: MomentumContext): MomentumScored[]; // sorted best-first, ALL candidates
export const WEIGHTS: Record<string, number>; // single tuning table
```

- [ ] **Step 1: Write the failing tests** — `artifacts/api-server/src/lib/momentum.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { rankMomentum, type MomentumTask, type MomentumContext } from "./momentum";

const NOW = new Date("2026-07-14T19:00:00Z"); // 14:00 Chicago — afternoon (no TOD boost)
const TODAY = "2026-07-14";

let nextId = 1;
function task(overrides: Partial<MomentumTask> = {}): MomentumTask {
  return {
    id: nextId++,
    title: "generic quest",
    priority: "medium",
    category: "admin",
    estimatedMinutes: null,
    createdAt: new Date("2026-07-14T08:00:00Z"), // today — no queue-age boost
    dueDate: null,
    isAnchored: false,
    isDailyFocus: false,
    focusDate: null,
    stepsDone: 0,
    stepsOpen: 0,
    ...overrides,
  };
}

function ctx(overrides: Partial<MomentumContext> = {}): MomentumContext {
  return {
    mode: "neutral",
    now: NOW,
    localHour: 14,
    todayStr: TODAY,
    // Every category "already completed" so the variety boost is silent unless a test opts in.
    completedTodayCategories: new Set(["admin", "health", "deep_work", "self_care", "errands", "household", "learning", "finance", "social", "creative", "travel", "default"]),
    ...overrides,
  };
}

describe("rankMomentum", () => {
  it("returns empty for no candidates", () => {
    expect(rankMomentum([], ctx())).toEqual([]);
  });

  it("pinned-today quests dominate (absorption guarantee)", () => {
    const pinned = task({ isDailyFocus: true, focusDate: TODAY });
    const urgent = task({ priority: "high", dueDate: "2026-07-01" });
    const ranked = rankMomentum([urgent, pinned], ctx());
    expect(ranked[0]!.taskId).toBe(pinned.id);
    expect(ranked[0]!.reason).toBe("You picked this one for today — still a good call.");
  });

  it("minutes fit boosts fitting quests and soft-excludes overshoots", () => {
    const fits = task({ estimatedMinutes: 10 });
    const overshoot = task({ estimatedMinutes: 45 });
    const noEstimate = task();
    const ranked = rankMomentum([overshoot, noEstimate, fits], ctx({ minutes: 12 }));
    expect(ranked[0]!.taskId).toBe(fits.id);
    expect(ranked[0]!.reason).toBe("Fits the 12 minutes you've got.");
    expect(ranked[2]!.taskId).toBe(overshoot.id); // −40 sinks it below no-estimate (−5)
  });

  it("distracted mode prefers tiny wins", () => {
    const tiny = task({ estimatedMinutes: 5 });
    const meaty = task({ estimatedMinutes: 60, priority: "high" });
    const ranked = rankMomentum([meaty, tiny], ctx({ mode: "distracted" }));
    expect(ranked[0]!.taskId).toBe(tiny.id);
    expect(ranked[0]!.reason).toBe("Tiny win: about 5 minutes, easy to grab.");
  });

  it("frozen mode de-prioritizes high priority and rewards existing steps", () => {
    const smallStepped = task({ estimatedMinutes: 10, stepsOpen: 3 });
    const bigImportant = task({ priority: "high", estimatedMinutes: 90 });
    const ranked = rankMomentum([bigImportant, smallStepped], ctx({ mode: "frozen" }));
    expect(ranked[0]!.taskId).toBe(smallStepped.id);
    expect(ranked[0]!.reason).toBe("Smallest thing on the list — one step, no pressure.");
    // The high-priority quest scored NEGATIVE relative to a plain quest: pressure off.
    const plain = task();
    const ranked2 = rankMomentum([bigImportant, plain], ctx({ mode: "frozen" }));
    expect(ranked2[0]!.taskId).toBe(plain.id);
  });

  it("focused mode boosts high priority", () => {
    const important = task({ priority: "high" });
    const filler = task({ estimatedMinutes: 5 });
    const ranked = rankMomentum([filler, important], ctx({ mode: "focused" }));
    expect(ranked[0]!.taskId).toBe(important.id);
    expect(ranked[0]!.reason).toBe("Brain's on — this one moves the needle.");
  });

  it("hyperfocus mode prefers continuing an in-progress quest", () => {
    const inProgress = task({ stepsDone: 2, stepsOpen: 1 });
    const coldBig = task({ estimatedMinutes: 45 });
    const ranked = rankMomentum([coldBig, inProgress], ctx({ mode: "hyperfocus" }));
    expect(ranked[0]!.taskId).toBe(inProgress.id);
    expect(ranked[0]!.reason).toBe("You're mid-flow on this one — ride it.");
  });

  it("morning boosts focus categories; evening boosts wind-down categories", () => {
    const deepWork = task({ category: "deep_work" });
    const admin = task({ category: "admin" });
    const morning = rankMomentum([admin, deepWork], ctx({ localHour: 8 }));
    expect(morning[0]!.taskId).toBe(deepWork.id);

    const household = task({ category: "household" });
    const evening = rankMomentum([admin, household], ctx({ localHour: 19 }));
    expect(evening[0]!.taskId).toBe(household.id);
  });

  it("waiting quests get a gentle age boost with anti-shame copy", () => {
    const old = task({ createdAt: new Date("2026-07-10T08:00:00Z") }); // 4 days
    const fresh = task();
    const ranked = rankMomentum([fresh, old], ctx());
    expect(ranked[0]!.taskId).toBe(old.id);
    expect(ranked[0]!.reason).toBe("This one's been waiting patiently.");
  });

  it("past-due (non-anchored) gets a gentle boost; anchored never does", () => {
    const pastDue = task({ dueDate: "2026-07-10" });
    const anchoredPast = task({ dueDate: "2026-07-10", isAnchored: true });
    const fresh = task();
    const ranked = rankMomentum([fresh, anchoredPast, pastDue], ctx());
    expect(ranked[0]!.taskId).toBe(pastDue.id);
    expect(ranked[0]!.reason).toBe("It's ready when you are — the date slipped by.");
  });

  it("variety boost fires for an untouched category", () => {
    const fresh = task({ category: "health" });
    const done = task({ category: "admin" });
    const ranked = rankMomentum([done, fresh], ctx({ completedTodayCategories: new Set(["admin"]) }));
    expect(ranked[0]!.taskId).toBe(fresh.id);
  });

  it("falls back to assignPoints category when stored category is 'default'", () => {
    // "write report" → deep_work via assignPoints; morning boost should apply.
    const legacy = task({ title: "write report", category: "default" });
    const admin = task({ category: "admin" });
    const ranked = rankMomentum([admin, legacy], ctx({ localHour: 8 }));
    expect(ranked[0]!.taskId).toBe(legacy.id);
  });

  it("ties break on older createdAt, then lower id", () => {
    const a = task({ createdAt: new Date("2026-07-14T09:00:00Z") });
    const b = task({ createdAt: new Date("2026-07-14T07:00:00Z") });
    const ranked = rankMomentum([a, b], ctx());
    expect(ranked[0]!.taskId).toBe(b.id);
  });

  it("gives the generic reason when nothing stands out", () => {
    const plain = task();
    expect(rankMomentum([plain], ctx())[0]!.reason).toBe("A solid next step to keep things moving.");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/api-server test -- momentum`
Expected: FAIL — cannot resolve `./momentum`.

- [ ] **Step 3: Write `artifacts/api-server/src/lib/momentum.ts`**

```ts
import { assignPoints, MORNING_FOCUS_CATEGORIES, EVENING_WINDDOWN_CATEGORIES } from "./auto-points";
import type { BrainMode } from "./brain-mode";

export interface MomentumTask {
  id: number;
  title: string;
  priority: string;
  category: string;
  estimatedMinutes: number | null;
  createdAt: Date;
  dueDate: string | null;
  isAnchored: boolean;
  isDailyFocus: boolean;
  focusDate: string | null;
  stepsDone: number;
  stepsOpen: number;
}

export interface MomentumContext {
  mode: BrainMode;
  /** Available minutes right now, when the user told us. */
  minutes?: number;
  now: Date;
  /** 0–23 in the user's timezone. */
  localHour: number;
  /** Local YYYY-MM-DD. */
  todayStr: string;
  completedTodayCategories: ReadonlySet<string>;
}

export interface MomentumScored {
  taskId: number;
  score: number;
  reason: string;
}

// Single tuning table. Change values only together with the tests that pin them.
export const WEIGHTS = {
  pinnedToday: 30,
  minutesFit: 25,
  minutesOvershoot: -40,
  minutesNoEstimate: -5,
  focusedHighPriority: 15,
  focusedMeaty: 5,
  distractedShort: 20,
  distractedTiny: 5,
  distractedRoutine: 5,
  frozenSmall: 25,
  frozenHasSteps: 10,
  frozenHighPriority: -10,
  hyperfocusInProgress: 25,
  hyperfocusColdBig: -10,
  morningCategory: 10,
  eveningCategory: 10,
  eveningShort: 5,
  queueAgePerDay: 2,
  queueAgeCapDays: 7,
  pastDue: 10,
  variety: 8,
} as const;

const ROUTINE_CATEGORIES = new Set(["self_care", "errands"]);

type Signal =
  | "pinned" | "minutes_fit" | "focused_priority" | "distracted_short"
  | "frozen_small" | "frozen_steps" | "hyperfocus_continue"
  | "morning" | "evening" | "age" | "past_due" | "variety";

// When two signals contribute equally, the earlier one here names the reason.
const DOMINANCE: Signal[] = [
  "pinned", "minutes_fit", "frozen_small", "frozen_steps", "hyperfocus_continue",
  "distracted_short", "focused_priority", "past_due", "age", "morning", "evening", "variety",
];

function reasonFor(signal: Signal, t: MomentumTask, ctx: MomentumContext, categoryLabel: string): string {
  switch (signal) {
    case "pinned":             return "You picked this one for today — still a good call.";
    case "minutes_fit":        return `Fits the ${ctx.minutes} minutes you've got.`;
    case "frozen_small":       return "Smallest thing on the list — one step, no pressure.";
    case "frozen_steps":       return "Already broken into steps — just the first one counts.";
    case "hyperfocus_continue": return "You're mid-flow on this one — ride it.";
    case "distracted_short":   return `Tiny win: about ${t.estimatedMinutes} minutes, easy to grab.`;
    case "focused_priority":   return "Brain's on — this one moves the needle.";
    case "past_due":           return "It's ready when you are — the date slipped by.";
    case "age":                return "This one's been waiting patiently.";
    case "morning":            return `A strong ${categoryLabel.toLowerCase()} quest to start the day.`;
    case "evening":            return "Light and doable for the evening.";
    case "variety":            return `A change of scenery — no ${categoryLabel.toLowerCase()} yet today.`;
  }
}

/** Stored category unless it's the legacy 'default', then keyword inference. */
function resolveCategory(t: MomentumTask): { category: string; label: string } {
  if (t.category && t.category !== "default") {
    const ap = assignPoints(t.title, t.priority);
    // assignPoints also yields the label for its own category; for stored
    // categories reuse its label map indirectly via a second call only when
    // they differ. Simpler: label is looked up by the route via CATEGORY_LABELS;
    // here we only need a human word for reason templates.
    return { category: t.category, label: ap.category === t.category ? ap.categoryLabel : t.category.replace(/_/g, " ") };
  }
  const ap = assignPoints(t.title, t.priority);
  return { category: ap.category, label: ap.categoryLabel };
}

export function rankMomentum(tasks: MomentumTask[], ctx: MomentumContext): MomentumScored[] {
  const isMorning = ctx.localHour >= 6 && ctx.localHour < 11;
  const isEvening = ctx.localHour >= 17 && ctx.localHour < 21;

  const scored = tasks.map((t) => {
    const { category, label } = resolveCategory(t);
    const est = t.estimatedMinutes;
    let score = 0;
    const signals = new Map<Signal, number>();
    const add = (signal: Signal | null, points: number) => {
      score += points;
      if (signal && points > 0) signals.set(signal, (signals.get(signal) ?? 0) + points);
    };

    // Absorption: today's pins dominate.
    if (t.isDailyFocus && t.focusDate === ctx.todayStr) add("pinned", WEIGHTS.pinnedToday);

    // Available-time fit.
    if (ctx.minutes !== undefined) {
      if (est === null) add(null, WEIGHTS.minutesNoEstimate);
      else if (est <= ctx.minutes) add("minutes_fit", WEIGHTS.minutesFit);
      else add(null, WEIGHTS.minutesOvershoot);
    }

    // Mode weighting.
    switch (ctx.mode) {
      case "focused":
        if (t.priority === "high") add("focused_priority", WEIGHTS.focusedHighPriority);
        if (est !== null && est >= 25) add(null, WEIGHTS.focusedMeaty);
        break;
      case "distracted":
        if (est !== null && est <= 15) add("distracted_short", WEIGHTS.distractedShort);
        if (est !== null && est <= 5) add("distracted_short", WEIGHTS.distractedTiny);
        if (ROUTINE_CATEGORIES.has(category)) add(null, WEIGHTS.distractedRoutine);
        break;
      case "frozen":
        if (est !== null && est <= 10) add("frozen_small", WEIGHTS.frozenSmall);
        if (t.stepsOpen > 0) add("frozen_steps", WEIGHTS.frozenHasSteps);
        if (t.priority === "high") add(null, WEIGHTS.frozenHighPriority); // pressure off
        break;
      case "hyperfocus":
        if (t.stepsDone >= 1 && t.stepsOpen >= 1) add("hyperfocus_continue", WEIGHTS.hyperfocusInProgress);
        else if (t.stepsDone === 0 && est !== null && est >= 30) add(null, WEIGHTS.hyperfocusColdBig);
        break;
      case "neutral":
        break;
    }

    // Local time of day.
    if (isMorning && MORNING_FOCUS_CATEGORIES.has(category)) add("morning", WEIGHTS.morningCategory);
    if (isEvening) {
      if (EVENING_WINDDOWN_CATEGORIES.has(category)) add("evening", WEIGHTS.eveningCategory);
      if (est !== null && est <= 30) add("evening", WEIGHTS.eveningShort);
    }

    // Gentle queue-age boost.
    const daysOld = Math.floor((ctx.now.getTime() - t.createdAt.getTime()) / 86_400_000);
    if (daysOld >= 2) add("age", Math.min(daysOld, WEIGHTS.queueAgeCapDays) * WEIGHTS.queueAgePerDay);

    // Past due — never for anchored quests, and never alarmed.
    if (t.dueDate && !t.isAnchored && t.dueDate < ctx.todayStr) add("past_due", WEIGHTS.pastDue);

    // Category variety.
    if (!ctx.completedTodayCategories.has(category)) add("variety", WEIGHTS.variety);

    // Dominant positive signal names the reason.
    let reason = "A solid next step to keep things moving.";
    let best = 0;
    for (const signal of DOMINANCE) {
      const pts = signals.get(signal) ?? 0;
      if (pts > best) { best = pts; reason = reasonFor(signal, t, ctx, label); }
    }

    return { taskId: t.id, score, reason, createdAt: t.createdAt };
  });

  scored.sort((a, b) =>
    b.score - a.score ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.taskId - b.taskId,
  );
  return scored.map(({ taskId, score, reason }) => ({ taskId, score, reason }));
}
```

- [ ] **Step 4: Run tests until green**

Run: `pnpm --filter @workspace/api-server test -- momentum`
Expected: PASS. If a ranking test fails, check the arithmetic against `WEIGHTS` before touching weights — the tests encode the spec's table.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/momentum.ts artifacts/api-server/src/lib/momentum.test.ts
git commit -m "feat(api): momentum scorer — mode/minutes/local-hour ranking with anti-shame reasons"
```

---

### Task 6: `GET /tasks/momentum` route + remove `/tasks/recommend`

**Files:**
- Create: `artifacts/api-server/src/routes/momentum.ts`
- Modify: `artifacts/api-server/src/routes/tasks.ts` — delete the whole `router.get("/tasks/recommend", …)` handler (lines 94–219)
- Modify: `artifacts/api-server/src/routes/index.ts` — mount `momentumRouter` **before** `tasksRouter`

**Interfaces:**
- Consumes: `rankMomentum`, `MomentumTask` (Task 5); `deriveBrainState` (Task 2); `brainCheckinsTable` (Task 1); `formatTask` exported from `./tasks` (existing); `resolveTimeZone`, `localDateKey`, `localHour` from `../lib/date-buckets`.
- Produces: `GET /tasks/momentum?minutes=&tz=&exclude=` → 200 `{ mode, suggestions: [{ task, reason, kind }] }` with ≤3 suggestions, primary first — the shape Task 3 declared.

- [ ] **Step 1: Write `artifacts/api-server/src/routes/momentum.ts`**

```ts
import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, brainCheckinsTable, tasksTable, taskStepsTable } from "@workspace/db";
import { deriveBrainState } from "../lib/brain-mode";
import { rankMomentum, type MomentumTask } from "../lib/momentum";
import { resolveTimeZone, localDateKey, localHour } from "../lib/date-buckets";
import { assignPoints } from "../lib/auto-points";
import { formatTask } from "./tasks";

const router: IRouter = Router();

// NOTE: mounted before tasksRouter in routes/index.ts so the static
// /tasks/momentum segment wins over /tasks/:id.
router.get("/tasks/momentum", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;

  const tz = resolveTimeZone(String(req.query.tz ?? ""));
  const rawMinutes = parseInt(String(req.query.minutes ?? ""), 10);
  const minutes = Number.isFinite(rawMinutes) && rawMinutes > 0 && rawMinutes <= 480 ? rawMinutes : undefined;
  const excludeIds = String(req.query.exclude ?? "")
    .split(",").map(Number).filter((n) => !isNaN(n) && n > 0);

  const now = new Date();
  const todayStr = localDateKey(now, tz);

  const [latest] = await db
    .select()
    .from(brainCheckinsTable)
    .where(eq(brainCheckinsTable.userId, userId))
    .orderBy(desc(brainCheckinsTable.createdAt), desc(brainCheckinsTable.id))
    .limit(1);
  const state = deriveBrainState(latest, now, tz);

  const open = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.userId, userId), eq(tasksTable.completed, false)));

  // Categories completed today (local day) for the variety signal.
  const done = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.userId, userId), eq(tasksTable.completed, true)));
  const completedTodayCategories = new Set<string>();
  for (const t of done) {
    if (t.completedAt && localDateKey(t.completedAt, tz) === todayStr) {
      completedTodayCategories.add(
        t.category !== "default" ? t.category : assignPoints(t.title, t.priority).category,
      );
    }
  }

  const steps = await db
    .select()
    .from(taskStepsTable)
    .where(eq(taskStepsTable.userId, userId));
  const stepsByTask = new Map<number, typeof steps>();
  for (const s of steps) {
    const list = stepsByTask.get(s.taskId) ?? [];
    list.push(s);
    stepsByTask.set(s.taskId, list);
  }

  const candidates: MomentumTask[] = open
    .filter((t) => !excludeIds.includes(t.id))
    .map((t) => {
      const ts = stepsByTask.get(t.id) ?? [];
      return {
        id: t.id, title: t.title, priority: t.priority, category: t.category,
        estimatedMinutes: t.estimatedMinutes, createdAt: t.createdAt,
        dueDate: t.dueDate, isAnchored: t.isAnchored,
        isDailyFocus: t.isDailyFocus, focusDate: t.focusDate,
        stepsDone: ts.filter((s) => s.done).length,
        stepsOpen: ts.filter((s) => !s.done).length,
      };
    });

  const ranked = rankMomentum(candidates, {
    mode: state.mode, minutes, now,
    localHour: localHour(now, tz), todayStr, completedTodayCategories,
  });

  const byId = new Map(open.map((t) => [t.id, t]));
  const suggestions = ranked.slice(0, 3).map((s, i) => ({
    task: formatTask(byId.get(s.taskId)!, stepsByTask.get(s.taskId) ?? []),
    reason: s.reason,
    kind: i === 0 ? "primary" : "alternate",
  }));

  res.json({ mode: state.mode, suggestions });
});

export default router;
```

- [ ] **Step 2: Delete the recommend handler.** In `artifacts/api-server/src/routes/tasks.ts` remove the entire `router.get("/tasks/recommend", async (req, res)…)` block (currently lines 94–219, from the route line through its closing `});`). Leave `formatTask` and everything else untouched. If `MORNING_FOCUS_CATEGORIES` / `EVENING_WINDDOWN_CATEGORIES` imports on line 6 become unused, trim them from that import (typecheck will say).

- [ ] **Step 3: Mount momentum first.** In `artifacts/api-server/src/routes/index.ts`:

```ts
import momentumRouter from "./momentum";
// …
// /tasks/momentum must beat tasksRouter's /tasks/:id — order matters.
router.use(momentumRouter);
router.use(tasksRouter);
```

(Replace the existing `router.use(tasksRouter);` line with these two.)

- [ ] **Step 4: Verify**

Run: `pnpm --filter @workspace/api-server typecheck` then `pnpm --filter @workspace/api-server test`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/momentum.ts artifacts/api-server/src/routes/tasks.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(api): GET /tasks/momentum; retire GET /tasks/recommend"
```

---

### Task 7: Rescue events — lib (TDD) + route

**Files:**
- Create: `artifacts/api-server/src/lib/rescue-events.ts`
- Test: `artifacts/api-server/src/lib/rescue-events.test.ts`
- Create: `artifacts/api-server/src/routes/rescue.ts`
- Modify: `artifacts/api-server/src/routes/index.ts` (import + `router.use(rescueRouter);` after `brainRouter`)

**Interfaces:**
- Produces:
  - `RESCUE_BLOCKERS = ["too_big","cant_start","overwhelmed","wrong_quest"] as const`, `RESCUE_INTERVENTIONS = ["breakdown","micro_start","emergency_mode","reroll"] as const`
  - `parseRescueEvent(body: unknown): { ok: true; value: { taskId: number | null; blocker: RescueBlocker; intervention: RescueIntervention } } | { ok: false; error: string }`
  - `POST /rescue/events` → 201 `{ id }`, 404 unknown task, 422 bad enums.

- [ ] **Step 1: Write the failing tests** — `artifacts/api-server/src/lib/rescue-events.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseRescueEvent } from "./rescue-events";

describe("parseRescueEvent", () => {
  it("accepts a full valid body", () => {
    expect(parseRescueEvent({ taskId: 7, blocker: "too_big", intervention: "breakdown" }))
      .toEqual({ ok: true, value: { taskId: 7, blocker: "too_big", intervention: "breakdown" } });
  });

  it("accepts a null/absent taskId", () => {
    expect(parseRescueEvent({ blocker: "overwhelmed", intervention: "emergency_mode" }))
      .toEqual({ ok: true, value: { taskId: null, blocker: "overwhelmed", intervention: "emergency_mode" } });
    expect(parseRescueEvent({ taskId: null, blocker: "wrong_quest", intervention: "reroll" }).ok).toBe(true);
  });

  it("rejects unknown blocker and intervention", () => {
    expect(parseRescueEvent({ blocker: "tired", intervention: "breakdown" }))
      .toEqual({ ok: false, error: "Unknown blocker" });
    expect(parseRescueEvent({ blocker: "too_big", intervention: "nap" }))
      .toEqual({ ok: false, error: "Unknown intervention" });
  });

  it("rejects a non-integer taskId", () => {
    expect(parseRescueEvent({ taskId: "seven", blocker: "too_big", intervention: "breakdown" }))
      .toEqual({ ok: false, error: "taskId must be an integer" });
    expect(parseRescueEvent({ taskId: 1.5, blocker: "too_big", intervention: "breakdown" }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/api-server test -- rescue-events`
Expected: FAIL — cannot resolve `./rescue-events`.

- [ ] **Step 3: Write `artifacts/api-server/src/lib/rescue-events.ts`**

```ts
export const RESCUE_BLOCKERS = ["too_big", "cant_start", "overwhelmed", "wrong_quest"] as const;
export type RescueBlocker = (typeof RESCUE_BLOCKERS)[number];

export const RESCUE_INTERVENTIONS = ["breakdown", "micro_start", "emergency_mode", "reroll"] as const;
export type RescueIntervention = (typeof RESCUE_INTERVENTIONS)[number];

export interface RescueEventInput {
  taskId: number | null;
  blocker: RescueBlocker;
  intervention: RescueIntervention;
}

export function parseRescueEvent(
  body: unknown,
): { ok: true; value: RescueEventInput } | { ok: false; error: string } {
  const b = body as { taskId?: unknown; blocker?: unknown; intervention?: unknown } | null | undefined;

  let taskId: number | null = null;
  if (b?.taskId !== undefined && b.taskId !== null) {
    if (typeof b.taskId !== "number" || !Number.isInteger(b.taskId)) {
      return { ok: false, error: "taskId must be an integer" };
    }
    taskId = b.taskId;
  }
  if (!(RESCUE_BLOCKERS as readonly unknown[]).includes(b?.blocker)) {
    return { ok: false, error: "Unknown blocker" };
  }
  if (!(RESCUE_INTERVENTIONS as readonly unknown[]).includes(b?.intervention)) {
    return { ok: false, error: "Unknown intervention" };
  }
  return { ok: true, value: { taskId, blocker: b!.blocker as RescueBlocker, intervention: b!.intervention as RescueIntervention } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/api-server test -- rescue-events`
Expected: PASS.

- [ ] **Step 5: Write `artifacts/api-server/src/routes/rescue.ts`**

```ts
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, rescueEventsTable, tasksTable } from "@workspace/db";
import { parseRescueEvent } from "../lib/rescue-events";

const router: IRouter = Router();

router.post("/rescue/events", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId!;

  const parsed = parseRescueEvent(req.body);
  if (!parsed.ok) {
    res.status(422).json({ error: parsed.error });
    return;
  }
  const { taskId, blocker, intervention } = parsed.value;

  if (taskId !== null) {
    const [task] = await db.select({ id: tasksTable.id }).from(tasksTable)
      .where(and(eq(tasksTable.id, taskId), eq(tasksTable.userId, userId)));
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  }

  const [inserted] = await db
    .insert(rescueEventsTable)
    .values({ userId, taskId, blocker, intervention })
    .returning({ id: rescueEventsTable.id });

  res.status(201).json({ id: inserted!.id });
});

export default router;
```

- [ ] **Step 6: Mount it.** In `routes/index.ts` add `import rescueRouter from "./rescue";` and `router.use(rescueRouter);` right after `router.use(brainRouter);`.

- [ ] **Step 7: Verify + commit**

Run: `pnpm --filter @workspace/api-server typecheck && pnpm --filter @workspace/api-server test`
Expected: exit 0.

```bash
git add artifacts/api-server/src/lib/rescue-events.ts artifacts/api-server/src/lib/rescue-events.test.ts artifacts/api-server/src/routes/rescue.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(api): POST /rescue/events with enum + ownership validation"
```

---

### Task 8: Client mode metadata + countdown reducer (TDD)

**Files:**
- Create: `artifacts/focusquest/src/lib/brain-mode-meta.ts`
- Test: `artifacts/focusquest/src/lib/brain-mode-meta.test.ts`
- Create: `artifacts/focusquest/src/lib/countdown.ts`
- Test: `artifacts/focusquest/src/lib/countdown.test.ts`
- Create: `artifacts/focusquest/src/hooks/use-countdown.ts` (hook wrapping reducer + 1s interval — the ONE place the interval lives; components must not re-implement it)

**Interfaces:**
- Consumes: generated `BrainMode` enum from `@workspace/api-client-react` (Task 3).
- Produces (used by Tasks 9–13):

```ts
// brain-mode-meta.ts
export interface ModeMeta { label: string; prompt: string; flavor: string | null; }
export const MODE_META: Record<BrainMode, ModeMeta>;
export function promptDismissedToday(todayStr: string, storage?: Storage): boolean;
export function dismissPromptToday(todayStr: string, storage?: Storage): void;
// countdown.ts
export interface CountdownState { totalSeconds: number; remaining: number; status: "idle" | "running" | "zero"; }
export type CountdownAction = { type: "start"; seconds: number } | { type: "tick" } | { type: "restart" } | { type: "reset" };
export const MICRO_START_SECONDS = 120;
export function countdownReducer(state: CountdownState, action: CountdownAction): CountdownState;
export const countdownIdle: CountdownState;
export function formatClock(totalSeconds: number): string; // "2:00", "1:05", "0:00"
// hooks/use-countdown.ts
export function useCountdown(): [CountdownState, React.Dispatch<CountdownAction>]; // reducer + auto 1s interval while running
```

- [ ] **Step 1: Write the failing tests**

`artifacts/focusquest/src/lib/brain-mode-meta.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { BrainMode } from "@workspace/api-client-react";
import { MODE_META, promptDismissedToday, dismissPromptToday } from "./brain-mode-meta";

describe("MODE_META", () => {
  it("covers every generated BrainMode value (guards enum drift)", () => {
    for (const mode of Object.values(BrainMode)) {
      expect(MODE_META[mode], `missing meta for ${mode}`).toBeDefined();
      expect(MODE_META[mode].label.length).toBeGreaterThan(0);
      expect(MODE_META[mode].prompt.length).toBeGreaterThan(0);
    }
  });

  it("neutral has no board flavor line", () => {
    expect(MODE_META[BrainMode.neutral].flavor).toBeNull();
  });
});

describe("daily prompt dismissal", () => {
  function fakeStorage(): Storage {
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
      clear: () => m.clear(),
      key: () => null,
      get length() { return m.size; },
    } as Storage;
  }

  it("is per local day", () => {
    const s = fakeStorage();
    expect(promptDismissedToday("2026-07-14", s)).toBe(false);
    dismissPromptToday("2026-07-14", s);
    expect(promptDismissedToday("2026-07-14", s)).toBe(true);
    expect(promptDismissedToday("2026-07-15", s)).toBe(false); // new day, fresh ask
  });
});
```

`artifacts/focusquest/src/lib/countdown.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { countdownReducer, countdownIdle, formatClock, MICRO_START_SECONDS } from "./countdown";

describe("countdownReducer", () => {
  it("starts at the requested seconds", () => {
    const s = countdownReducer(countdownIdle, { type: "start", seconds: MICRO_START_SECONDS });
    expect(s).toEqual({ totalSeconds: 120, remaining: 120, status: "running" });
  });

  it("ticks down to zero and stops — zero is a state, not a failure", () => {
    let s = countdownReducer(countdownIdle, { type: "start", seconds: 2 });
    s = countdownReducer(s, { type: "tick" });
    expect(s.remaining).toBe(1);
    s = countdownReducer(s, { type: "tick" });
    expect(s).toEqual({ totalSeconds: 2, remaining: 0, status: "zero" });
    // Extra ticks at zero change nothing.
    expect(countdownReducer(s, { type: "tick" })).toEqual(s);
  });

  it("ignores ticks while idle", () => {
    expect(countdownReducer(countdownIdle, { type: "tick" })).toEqual(countdownIdle);
  });

  it("restart refills the same duration", () => {
    let s = countdownReducer(countdownIdle, { type: "start", seconds: 120 });
    s = countdownReducer(s, { type: "tick" });
    s = countdownReducer(s, { type: "restart" });
    expect(s).toEqual({ totalSeconds: 120, remaining: 120, status: "running" });
  });

  it("reset returns to idle", () => {
    let s = countdownReducer(countdownIdle, { type: "start", seconds: 120 });
    expect(countdownReducer(s, { type: "reset" })).toEqual(countdownIdle);
  });
});

describe("formatClock", () => {
  it("renders m:ss", () => {
    expect(formatClock(120)).toBe("2:00");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(9)).toBe("0:09");
    expect(formatClock(0)).toBe("0:00");
  });
});
```

- [ ] **Step 2: Run to verify both fail**

Run: `pnpm --filter @workspace/focusquest test -- brain-mode-meta` and `pnpm --filter @workspace/focusquest test -- countdown`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `artifacts/focusquest/src/lib/brain-mode-meta.ts`**

```ts
import { BrainMode } from "@workspace/api-client-react";

export interface ModeMeta {
  /** Chip / button label. */
  label: string;
  /** One-liner shown in the chip popover and daily prompt. */
  prompt: string;
  /** Line under the momentum board heading; null renders nothing. */
  flavor: string | null;
}

export const MODE_META: Record<BrainMode, ModeMeta> = {
  [BrainMode.focused]: {
    label: "Focused",
    prompt: "Brain's cooperating — point it at something.",
    flavor: "Focused? Good — here's one that moves the needle.",
  },
  [BrainMode.distracted]: {
    label: "Distracted",
    prompt: "Attention is slippery — tiny wins only.",
    flavor: "Distracted? Tiny wins below.",
  },
  [BrainMode.frozen]: {
    label: "Frozen",
    prompt: "Can't start anything — let's shrink it.",
    flavor: "Frozen is a state, not a verdict. One small step below.",
  },
  [BrainMode.hyperfocus]: {
    label: "Hyperfocus",
    prompt: "Locked in — protect the flow.",
    flavor: "Flow protected — ride the thread you're on.",
  },
  [BrainMode.neutral]: {
    label: "Check in",
    prompt: "How's the brain right now?",
    flavor: null,
  },
};

const PROMPT_KEY = "brainPromptDismissed";

export function promptDismissedToday(todayStr: string, storage: Storage = window.localStorage): boolean {
  return storage.getItem(PROMPT_KEY) === todayStr;
}

export function dismissPromptToday(todayStr: string, storage: Storage = window.localStorage): void {
  storage.setItem(PROMPT_KEY, todayStr);
}
```

- [ ] **Step 4: Write `artifacts/focusquest/src/lib/countdown.ts`**

```ts
// Shared 2-minute micro-start countdown (Emergency Mode + rescue + momentum
// card). Reaching zero is deliberately NOT a failure state — the timer is an
// on-ramp, not a deadline (anti-shame law).

export interface CountdownState {
  totalSeconds: number;
  remaining: number;
  status: "idle" | "running" | "zero";
}

export type CountdownAction =
  | { type: "start"; seconds: number }
  | { type: "tick" }
  | { type: "restart" }
  | { type: "reset" };

export const MICRO_START_SECONDS = 120;

export const countdownIdle: CountdownState = { totalSeconds: 0, remaining: 0, status: "idle" };

export function countdownReducer(state: CountdownState, action: CountdownAction): CountdownState {
  switch (action.type) {
    case "start":
      return { totalSeconds: action.seconds, remaining: action.seconds, status: "running" };
    case "tick": {
      if (state.status !== "running") return state;
      const remaining = state.remaining - 1;
      return remaining <= 0
        ? { ...state, remaining: 0, status: "zero" }
        : { ...state, remaining, status: "running" };
    }
    case "restart":
      return state.status === "idle" ? state : { ...state, remaining: state.totalSeconds, status: "running" };
    case "reset":
      return countdownIdle;
  }
}

/** m:ss for countdown displays. */
export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
```

- [ ] **Step 4b: Write `artifacts/focusquest/src/hooks/use-countdown.ts`** (no unit test — hooks/components aren't unit-tested in this repo; the reducer it wraps is)

```ts
import { useEffect, useReducer, type Dispatch } from "react";
import { countdownReducer, countdownIdle, type CountdownState, type CountdownAction } from "@/lib/countdown";

/** Countdown state + dispatch with the 1-second tick interval managed here —
 * the single home of the interval so components never re-implement it. */
export function useCountdown(): [CountdownState, Dispatch<CountdownAction>] {
  const [state, dispatch] = useReducer(countdownReducer, countdownIdle);
  useEffect(() => {
    if (state.status !== "running") return;
    const t = setInterval(() => dispatch({ type: "tick" }), 1000);
    return () => clearInterval(t);
  }, [state.status]);
  return [state, dispatch];
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @workspace/focusquest test -- brain-mode-meta` and `pnpm --filter @workspace/focusquest test -- countdown`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/focusquest/src/lib/brain-mode-meta.ts artifacts/focusquest/src/lib/brain-mode-meta.test.ts artifacts/focusquest/src/lib/countdown.ts artifacts/focusquest/src/lib/countdown.test.ts artifacts/focusquest/src/hooks/use-countdown.ts
git commit -m "feat(web): brain-mode metadata + shared micro-start countdown reducer"
```

---

### Task 9: micro-step hook + Emergency Mode

**Files:**
- Create: `artifacts/focusquest/src/hooks/use-micro-step.ts`
- Create: `artifacts/focusquest/src/components/emergency-mode.tsx`
- Modify: `artifacts/focusquest/src/App.tsx` or `components/layout.tsx` — wrap the app content in `<EmergencyModeProvider>` (do it in `layout.tsx`'s returned root, wrapping everything, since the overlay must cover nav)

**Interfaces:**
- Consumes: `useGetTasksMomentum`, `usePatchTaskStep`, `useCompleteTask`, `Task` from `@workspace/api-client-react`; `initiationToast` (`@/lib/initiation-toast`); `countdownReducer`, `MICRO_START_SECONDS` (Task 8); `browserTimeZone`; `dispatchQuestCompleted` (`@/components/dopamine-overlay`); query-key getters `getGetTasksQueryKey`, `getGetMyStatsQueryKey`, `getGetTasksMomentumQueryKey`.
- Produces (used by Tasks 10–12):
  - `useMicroStep(task: Task | null): { targetLabel: string; isStep: boolean; complete: () => void; isPending: boolean }` — checks the first open step (firing initiation XP toast via the response's `initiationXp`), or completes a stepless quest (with `dispatchQuestCompleted`).
  - `EmergencyModeProvider` (context) and `useEmergencyMode(): { active: boolean; enter: () => void; exit: () => void }`.
  - `<EmergencyMode onStillStuck?: (task: Task) => void />` is internal to the provider; Task 11 threads the rescue sheet in via provider prop `renderRescue`.

- [ ] **Step 1: Write `artifacts/focusquest/src/hooks/use-micro-step.ts`**

```ts
import { useQueryClient } from "@tanstack/react-query";
import {
  Task, useCompleteTask, usePatchTaskStep,
  getGetTasksQueryKey, getGetMyStatsQueryKey, getGetTasksMomentumQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { initiationToast } from "@/lib/initiation-toast";
import { dispatchQuestCompleted } from "@/components/dopamine-overlay";
import { apiErrorMessage } from "@/lib/api-error";

/**
 * The one thing a micro-start acts on: the task's first open step, or the
 * whole (stepless) task. Completing it fires the existing initiation XP /
 * celebration paths — this hook adds nothing to the reward math.
 */
export function useMicroStep(task: Task | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const patchStep = usePatchTaskStep();
  const completeTask = useCompleteTask();

  const firstOpenStep = task?.steps?.find((s) => !s.done) ?? null;
  const targetLabel = firstOpenStep ? firstOpenStep.text : task?.title ?? "";

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTasksMomentumQueryKey() });
  };

  const complete = () => {
    if (!task) return;
    if (firstOpenStep) {
      patchStep.mutate(
        { id: task.id, stepId: firstOpenStep.id, data: { done: true } },
        {
          onSuccess: (res: any) => {
            invalidate();
            const t = initiationToast(res.initiationXp);
            if (t) toast({ ...t, className: "border-primary" });
          },
          onError: (err: any) => toast({ title: apiErrorMessage(err, "Couldn't check that off"), variant: "destructive" }),
        },
      );
    } else {
      completeTask.mutate(
        { id: task.id, data: {} },
        {
          onSuccess: (res: any) => {
            invalidate();
            dispatchQuestCompleted();
            const t = initiationToast(res.initiationXp);
            if (t) toast({ ...t, className: "border-primary" });
          },
          onError: (err: any) => toast({ title: apiErrorMessage(err, "Couldn't complete that"), variant: "destructive" }),
        },
      );
    }
  };

  return { targetLabel, isStep: !!firstOpenStep, complete, isPending: patchStep.isPending || completeTask.isPending };
}
```

Check `useCompleteTask`'s exact mutate shape and `dispatchQuestCompleted`'s signature against `components/task-item.tsx` (the house usage) and match them — if `dispatchQuestCompleted` takes arguments there, pass the same ones.

- [ ] **Step 2: Write `artifacts/focusquest/src/components/emergency-mode.tsx`**

```tsx
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Task, useGetTasksMomentum, useCreateBrainCheckin, BrainMode, getGetBrainStateQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "./ui/button";
import { X, Check, LifeBuoy } from "lucide-react";
import { browserTimeZone } from "@/lib/timezone";
import { formatClock, MICRO_START_SECONDS } from "@/lib/countdown";
import { useCountdown } from "@/hooks/use-countdown";
import { useMicroStep } from "@/hooks/use-micro-step";

interface EmergencyModeApi {
  active: boolean;
  enter: () => void;
  exit: () => void;
}

const EmergencyModeContext = createContext<EmergencyModeApi>({ active: false, enter: () => {}, exit: () => {} });
export const useEmergencyMode = () => useContext(EmergencyModeContext);

function EmergencyOverlay({ onExit, renderRescue }: {
  onExit: () => void;
  renderRescue?: (task: Task, close: () => void) => React.ReactNode;
}) {
  const tz = browserTimeZone();
  // One small thing, sized for a frozen brain.
  const { data, isLoading } = useGetTasksMomentum({ minutes: 10, tz });
  const suggestion = data?.suggestions?.[0] ?? null;
  const task = suggestion?.task ?? null;

  const [clock, dispatch] = useCountdown();
  const [celebrating, setCelebrating] = useState(false);
  const [rescueOpen, setRescueOpen] = useState(false);
  const { targetLabel, complete, isPending } = useMicroStep(task);

  const queryClient = useQueryClient();
  const checkin = useCreateBrainCheckin();

  useEffect(() => {
    if (task && clock.status === "idle") dispatch({ type: "start", seconds: MICRO_START_SECONDS });
  }, [task, clock.status]);

  const handleDidIt = () => {
    complete();
    setCelebrating(true);
  };

  const handleFeelingBetter = () => {
    checkin.mutate(
      // Generated BrainCheckinSource is a literal union — "emergency_exit" is a member.
      { data: { mode: BrainMode.focused, source: "emergency_exit", tz } },
      { onSettled: () => queryClient.invalidateQueries({ queryKey: getGetBrainStateQueryKey() }) },
    );
    onExit();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center p-6 text-center">
      {/* Always-visible exit — never a trap. */}
      <Button variant="ghost" size="icon" onClick={onExit} aria-label="Exit emergency mode"
        className="absolute top-[calc(1rem+env(safe-area-inset-top))] right-4 text-muted-foreground">
        <X className="w-5 h-5" />
      </Button>

      {isLoading ? (
        <p className="text-muted-foreground">Finding one small thing…</p>
      ) : !task ? (
        <div className="space-y-4 max-w-sm">
          <p className="text-lg font-semibold">Nothing in the log.</p>
          <p className="text-sm text-muted-foreground">Add one tiny thing first — then come back here if you want.</p>
          <Button onClick={onExit}>Back</Button>
        </div>
      ) : celebrating ? (
        <div className="space-y-5 max-w-sm">
          <p className="text-2xl font-bold text-primary">You started. That's the whole game.</p>
          <div className="flex flex-col gap-2">
            <Button onClick={() => { setCelebrating(false); dispatch({ type: "restart" }); }}>
              Another tiny one
            </Button>
            <Button variant="secondary" onClick={handleFeelingBetter}>Feeling better — Focused</Button>
            <Button variant="ghost" onClick={onExit}>Exit</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6 max-w-sm w-full">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Just this. Nothing else.</p>
          <h2 className="text-xl font-bold leading-snug">{targetLabel}</h2>
          <div className="text-5xl font-mono text-primary" aria-live="polite">
            {clock.status === "zero" ? (
              <span className="text-2xl font-sans text-foreground">Still going? Take your time.</span>
            ) : (
              formatClock(clock.remaining)
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Button size="lg" onClick={handleDidIt} disabled={isPending} className="gap-2">
              <Check className="w-5 h-5" /> Did it
            </Button>
            {clock.status === "zero" && (
              <Button variant="secondary" onClick={() => dispatch({ type: "restart" })}>
                Two more minutes
              </Button>
            )}
            {renderRescue && (
              <Button variant="ghost" onClick={() => setRescueOpen(true)} className="gap-2 text-muted-foreground">
                <LifeBuoy className="w-4 h-4" /> Still stuck
              </Button>
            )}
          </div>
        </div>
      )}
      {rescueOpen && task && renderRescue?.(task, () => setRescueOpen(false))}
    </div>
  );
}

export function EmergencyModeProvider({ children, renderRescue }: {
  children: React.ReactNode;
  renderRescue?: (task: Task, close: () => void) => React.ReactNode;
}) {
  const [active, setActive] = useState(false);
  const api = useMemo<EmergencyModeApi>(
    () => ({ active, enter: () => setActive(true), exit: () => setActive(false) }),
    [active],
  );
  return (
    <EmergencyModeContext.Provider value={api}>
      {children}
      {active && <EmergencyOverlay onExit={() => setActive(false)} renderRescue={renderRescue} />}
    </EmergencyModeContext.Provider>
  );
}
```

Notes for the implementer: the generated `useCreateBrainCheckin` body type comes from Task 3's `BrainCheckinRequest`; if the generated source enum type is named differently (check `lib/api-client-react/src/generated/`), use the generated name instead of the `as any`. If `useGetTasksMomentum`'s generated params object differs (orval nests query params as the first argument), match the generated signature — read the generated hook once before wiring.

- [ ] **Step 3: Mount the provider.** In `components/layout.tsx`, wrap the returned root: import `EmergencyModeProvider` and change `return (<div className="min-h-screen …">` to be wrapped by `<EmergencyModeProvider>` at the top level of the returned JSX (closing tag after the root `</div>`). `renderRescue` stays unset until Task 11.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @workspace/focusquest typecheck && pnpm --filter @workspace/focusquest test`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/hooks/use-micro-step.ts artifacts/focusquest/src/components/emergency-mode.tsx artifacts/focusquest/src/components/layout.tsx
git commit -m "feat(web): emergency mode — one tiny thing, 2-minute on-ramp, no traps"
```

---

### Task 10: BrainModeChip + layout mounting + hyperfocus banner + daily prompt

**Files:**
- Create: `artifacts/focusquest/src/components/brain-mode-chip.tsx`
- Create: `artifacts/focusquest/src/components/brain-checkin-prompt.tsx`
- Modify: `artifacts/focusquest/src/components/layout.tsx` — chip in the mobile header actions (next to `<NotificationBell />`, ~line 173) and desktop sidebar header actions (~line 207); hyperfocus banner under the mobile header / top of main content
- Modify: `artifacts/focusquest/src/pages/dashboard.tsx` — `<BrainCheckinPrompt />` as the first child of the returned `<div className="space-y-6 …">` (line ~181)

**Interfaces:**
- Consumes: `useGetBrainState`, `useCreateBrainCheckin`, `BrainMode`, `getGetBrainStateQueryKey`, `getGetTasksMomentumQueryKey` (Task 3); `MODE_META`, `promptDismissedToday`, `dismissPromptToday` (Task 8); `useEmergencyMode` (Task 9); `browserTimeZone`.
- Produces: `<BrainModeChip />` and `<BrainCheckinPrompt />` — self-contained; no props.

- [ ] **Step 1: Write `artifacts/focusquest/src/components/brain-mode-chip.tsx`**

```tsx
import { useState } from "react";
import { Brain, Snowflake } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BrainMode, useCreateBrainCheckin, useGetBrainState,
  getGetBrainStateQueryKey, getGetTasksMomentumQueryKey,
} from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { MODE_META } from "@/lib/brain-mode-meta";
import { browserTimeZone } from "@/lib/timezone";
import { useEmergencyMode } from "./emergency-mode";
import { useToast } from "@/hooks/use-toast";

const MODE_ORDER: BrainMode[] = [
  BrainMode.focused, BrainMode.distracted, BrainMode.frozen, BrainMode.hyperfocus,
];

export function BrainModeChip() {
  const tz = browserTimeZone();
  const { data: state } = useGetBrainState({ tz });
  const checkin = useCreateBrainCheckin();
  const queryClient = useQueryClient();
  const { enter } = useEmergencyMode();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [frozenOffer, setFrozenOffer] = useState(false);

  const mode = state?.mode ?? BrainMode.neutral;
  const meta = MODE_META[mode];

  const select = (next: BrainMode) => {
    checkin.mutate(
      { data: { mode: next, source: "tap", tz } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBrainStateQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTasksMomentumQueryKey() });
          if (next === BrainMode.frozen) {
            setFrozenOffer(true); // offer, never force
          } else {
            setOpen(false);
          }
        },
        onError: () => toast({ title: "Couldn't save that — try again", variant: "destructive" }),
      },
    );
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setFrozenOffer(false); }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Brain mode: ${meta.label}`}
          className={`gap-1.5 px-2 h-9 ${mode === BrainMode.neutral ? "text-muted-foreground" : "text-primary"}`}
        >
          <Brain className="w-4 h-4" />
          <span className="text-xs font-medium hidden sm:inline">{meta.label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2 space-y-1">
        {frozenOffer ? (
          <div className="p-2 space-y-3">
            <p className="text-sm font-medium">Want the two-minute version?</p>
            <p className="text-xs text-muted-foreground">One small thing, everything else hidden. You can leave anytime.</p>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={() => { setOpen(false); setFrozenOffer(false); enter(); }}>
                Enter Emergency Mode
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setFrozenOffer(false); setOpen(false); }}>
                Not now
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="px-2 pt-1 text-xs text-muted-foreground">{MODE_META[BrainMode.neutral].prompt}</p>
            {MODE_ORDER.map((m) => (
              <button
                key={m}
                onClick={() => select(m)}
                disabled={checkin.isPending}
                className={`w-full text-left px-2 py-2 rounded-lg hover:bg-muted transition-colors ${m === mode ? "bg-primary/10 border border-primary/30" : ""}`}
              >
                <span className="text-sm font-medium block">{MODE_META[m].label}</span>
                <span className="text-xs text-muted-foreground">{MODE_META[m].prompt}</span>
              </button>
            ))}
            {mode === BrainMode.frozen && (
              <button
                onClick={() => { setOpen(false); enter(); }}
                className="w-full text-left px-2 py-2 rounded-lg hover:bg-muted transition-colors flex items-center gap-2 text-primary"
              >
                <Snowflake className="w-4 h-4" />
                <span className="text-sm font-medium">Enter Emergency Mode</span>
              </button>
            )}
            {mode !== BrainMode.neutral && (
              <button
                onClick={() => select(BrainMode.neutral)}
                disabled={checkin.isPending}
                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-muted text-xs text-muted-foreground"
              >
                Clear — back to neutral
              </button>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Write `artifacts/focusquest/src/components/brain-checkin-prompt.tsx`**

```tsx
import { useState } from "react";
import { format } from "date-fns";
import { X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BrainMode, useCreateBrainCheckin, useGetBrainState,
  getGetBrainStateQueryKey, getGetTasksMomentumQueryKey,
} from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { MODE_META, promptDismissedToday, dismissPromptToday } from "@/lib/brain-mode-meta";
import { browserTimeZone } from "@/lib/timezone";

const PROMPT_MODES: BrainMode[] = [
  BrainMode.focused, BrainMode.distracted, BrainMode.frozen, BrainMode.hyperfocus,
];

/** Soft once-a-day check-in ask. Dismissing is silent; hyperfocus mutes it. */
export function BrainCheckinPrompt() {
  const tz = browserTimeZone();
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const { data: state } = useGetBrainState({ tz });
  const checkin = useCreateBrainCheckin();
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(() => promptDismissedToday(todayStr));

  // checkedInToday covers "expired earlier today" — never re-summon (spec).
  if (!state || state.checkedInToday || dismissed || state.mode === BrainMode.hyperfocus) return null;

  const pick = (mode: BrainMode) => {
    checkin.mutate(
      { data: { mode, source: "daily_prompt", tz } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBrainStateQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTasksMomentumQueryKey() });
        },
      },
    );
  };

  const dismiss = () => {
    dismissPromptToday(todayStr);
    setDismissed(true);
  };

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-4 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">How's the brain today?</h2>
          <p className="text-xs text-muted-foreground">One tap — the board reshapes to match.</p>
        </div>
        <Button variant="ghost" size="icon" onClick={dismiss} aria-label="Dismiss check-in"
          className="h-6 w-6 text-muted-foreground -mt-1 -mr-1">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {PROMPT_MODES.map((m) => (
          <Button key={m} variant="outline" size="sm" disabled={checkin.isPending}
            onClick={() => pick(m)} className="justify-start text-xs h-9">
            {MODE_META[m].label}
          </Button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Mount in layout.** In `components/layout.tsx`:
  - `import { BrainModeChip } from "./brain-mode-chip";` and `import { useGetBrainState, BrainMode } from "@workspace/api-client-react";` plus `import { browserTimeZone } from "@/lib/timezone";`
  - Mobile header actions (inside `<div className="flex items-center gap-1">`, before `<InstallButton />`): add `<BrainModeChip />`.
  - Desktop sidebar header actions (`<div className="flex items-center gap-1">` next to the logo): add `<BrainModeChip />` before `<InstallButton />`.
  - Hyperfocus banner: inside `Layout`, read `const { data: brainState } = useGetBrainState({ tz: browserTimeZone() });` and render as the first element inside the main content container (the element that wraps `{children}`):

```tsx
{brainState?.mode === BrainMode.hyperfocus && (
  <div className="mb-4 rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2 text-xs text-muted-foreground">
    Flow protected — check-in prompts muted. Break when you're ready.
  </div>
)}
```

- [ ] **Step 4: Mount the prompt on the dashboard.** In `pages/dashboard.tsx` add `import { BrainCheckinPrompt } from "@/components/brain-checkin-prompt";` and render `<BrainCheckinPrompt />` as the first child inside the returned `<div className="space-y-6 animate-in …">` (before the stat-cards grid at line ~184).

- [ ] **Step 5: Verify**

Run: `pnpm --filter @workspace/focusquest typecheck && pnpm --filter @workspace/focusquest test`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add artifacts/focusquest/src/components/brain-mode-chip.tsx artifacts/focusquest/src/components/brain-checkin-prompt.tsx artifacts/focusquest/src/components/layout.tsx artifacts/focusquest/src/pages/dashboard.tsx
git commit -m "feat(web): brain mode chip, daily soft prompt, hyperfocus banner"
```

---

### Task 11: RescueSheet + entry points

**Files:**
- Create: `artifacts/focusquest/src/components/rescue-sheet.tsx`
- Modify: `artifacts/focusquest/src/components/task-item.tsx` — "I'm stuck" action on incomplete tasks
- Modify: `artifacts/focusquest/src/components/layout.tsx` — pass `renderRescue` to `EmergencyModeProvider`

**Interfaces:**
- Consumes: `useBreakdownTask`, `useCreateRescueEvent`, `useGetTasksMomentum`, `Task` (generated); `useEmergencyMode` (Task 9); `useMicroStep` (Task 9); `countdownReducer`, `MICRO_START_SECONDS` (Task 8); `apiErrorMessage`.
- Produces: `<RescueSheet task={Task} open onOpenChange />` — four blockers, each logging one rescue event *after* its intervention succeeds. Used here (task rows, emergency) and by Task 12 (momentum card).

- [ ] **Step 1: Write `artifacts/focusquest/src/components/rescue-sheet.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Check, LifeBuoy } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Task, useBreakdownTask, useCreateRescueEvent, useGetTasksMomentum,
  getGetTasksQueryKey, getGetTasksMomentumQueryKey,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";
import { browserTimeZone } from "@/lib/timezone";
import { formatClock, MICRO_START_SECONDS } from "@/lib/countdown";
import { useCountdown } from "@/hooks/use-countdown";
import { useMicroStep } from "@/hooks/use-micro-step";
import { useEmergencyMode } from "./emergency-mode";

type Blocker = "too_big" | "cant_start" | "overwhelmed" | "wrong_quest";

const OPTIONS: { blocker: Blocker; label: string; hint: string }[] = [
  { blocker: "too_big",     label: "It's too big",                          hint: "Break it into first steps" },
  { blocker: "cant_start",  label: "I can't make myself start",             hint: "Two minutes on the smallest piece" },
  { blocker: "overwhelmed", label: "Too much everything",                   hint: "Hide it all — one thing only" },
  { blocker: "wrong_quest", label: "This isn't the right quest right now",  hint: "Show me something else" },
];

export function RescueSheet({ task, open, onOpenChange }: {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const tz = browserTimeZone();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { enter } = useEmergencyMode();
  const breakdown = useBreakdownTask();
  const logEvent = useCreateRescueEvent();
  const [view, setView] = useState<"picker" | "micro" | "reroll">("picker");
  const [clock, dispatch] = useCountdown();
  // Breakdown returns the task WITH its fresh steps — micro-start must target
  // the new step 1, not the stale prop snapshot.
  const [freshTask, setFreshTask] = useState<Task | null>(null);
  const { targetLabel, complete, isPending } = useMicroStep(freshTask ?? task);

  // Lazy alternative fetch, only for the wrong_quest path.
  const { data: alt, refetch: fetchAlt, isFetching: altLoading } = useGetTasksMomentum(
    { tz, exclude: String(task.id) },
    { query: { enabled: false } },
  );

  useEffect(() => {
    if (!open) { setView("picker"); setFreshTask(null); dispatch({ type: "reset" }); }
  }, [open]);

  // Fire-and-forget: intervention success is what matters; logging must never block.
  const log = (blocker: Blocker, intervention: string) => {
    logEvent.mutate({ data: { taskId: task.id, blocker, intervention } }, { onError: () => {} });
  };

  const pick = (blocker: Blocker) => {
    switch (blocker) {
      case "too_big":
        breakdown.mutate({ id: task.id }, {
          onSuccess: (res: any) => {
            log("too_big", "breakdown");
            queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetTasksMomentumQueryKey() });
            // Spec: spotlight step 1 with a 2-minute offer — flow straight into
            // the micro view against the response's fresh steps.
            setFreshTask(res as Task);
            setView("micro");
            dispatch({ type: "start", seconds: MICRO_START_SECONDS });
            toast({ title: "Broken into steps — step 1 is all that matters.", className: "border-primary" });
          },
          onError: (err: any) => toast({ title: apiErrorMessage(err, "Couldn't generate steps right now"), variant: "destructive" }),
        });
        break;
      case "cant_start":
        log("cant_start", "micro_start");
        setView("micro");
        dispatch({ type: "start", seconds: MICRO_START_SECONDS });
        break;
      case "overwhelmed":
        log("overwhelmed", "emergency_mode");
        onOpenChange(false);
        enter();
        break;
      case "wrong_quest":
        log("wrong_quest", "reroll");
        setView("reroll");
        void fetchAlt();
        break;
    }
  };

  const altTask = alt?.suggestions?.[0]?.task ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-primary/30">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <LifeBuoy className="w-5 h-5 text-primary" /> What's in the way?
          </DialogTitle>
        </DialogHeader>

        {view === "picker" && (
          <div className="space-y-2 mt-2">
            <p className="text-xs text-muted-foreground truncate">Stuck on: {task.title}</p>
            {OPTIONS.map((o) => (
              <button key={o.blocker} onClick={() => pick(o.blocker)}
                disabled={breakdown.isPending}
                className="w-full text-left px-3 py-2.5 rounded-lg border border-border hover:border-primary/40 hover:bg-muted transition-colors">
                <span className="text-sm font-medium block">{o.label}</span>
                <span className="text-xs text-muted-foreground">{o.hint}</span>
              </button>
            ))}
          </div>
        )}

        {view === "micro" && (
          <div className="space-y-4 mt-2 text-center">
            <p className="text-sm text-muted-foreground">Just this, just for two minutes:</p>
            <p className="text-base font-semibold">{targetLabel}</p>
            <div className="text-4xl font-mono text-primary" aria-live="polite">
              {clock.status === "zero" ? (
                <span className="text-lg font-sans text-foreground">Still going? Take your time.</span>
              ) : formatClock(clock.remaining)}
            </div>
            <div className="flex flex-col gap-2">
              <Button onClick={() => { complete(); onOpenChange(false); }} disabled={isPending} className="gap-2">
                <Check className="w-4 h-4" /> Did it
              </Button>
              {clock.status === "zero" && (
                <Button variant="secondary" onClick={() => dispatch({ type: "restart" })}>Two more minutes</Button>
              )}
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </div>
        )}

        {view === "reroll" && (
          <div className="space-y-3 mt-2">
            {altLoading ? (
              <p className="text-sm text-muted-foreground">Looking for a better fit…</p>
            ) : altTask ? (
              <>
                <p className="text-xs text-muted-foreground">Try this instead:</p>
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <p className="text-sm font-semibold">{altTask.title}</p>
                  {alt?.suggestions?.[0]?.reason && (
                    <p className="text-xs text-muted-foreground italic mt-1">"{alt.suggestions[0].reason}"</p>
                  )}
                </div>
                <Button className="w-full" onClick={() => onOpenChange(false)}>Sounds good</Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">That's the whole list right now — and doing nothing for a bit is allowed too.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

(If the generated `useGetTasksMomentum` doesn't accept `{ query: { enabled: false } }` as its second argument, check the generated signature — orval emits an options parameter; match it.)

- [ ] **Step 2: Task-row entry point.** In `components/task-item.tsx`: import `LifeBuoy` from lucide, `RescueSheet`; add `const [rescueOpen, setRescueOpen] = useState(false);`; in the action buttons cluster (next to the existing reschedule/pin buttons for incomplete tasks) add:

```tsx
{!task.completed && (
  <Button variant="ghost" size="icon" onClick={() => setRescueOpen(true)}
    aria-label="I'm stuck" className="text-muted-foreground hover:text-primary">
    <LifeBuoy className="w-4 h-4" />
  </Button>
)}
```

and render `<RescueSheet task={task} open={rescueOpen} onOpenChange={setRescueOpen} />` next to the existing dialogs/popovers at the end of the component. Match the exact size/variant classes of the neighboring icon buttons in that cluster.

- [ ] **Step 3: Emergency wiring.** In `components/layout.tsx` pass the render prop:

```tsx
import { RescueSheet } from "./rescue-sheet";
// …
<EmergencyModeProvider renderRescue={(task, close) => (
  <RescueSheet task={task} open onOpenChange={(o) => { if (!o) close(); }} />
)}>
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @workspace/focusquest typecheck && pnpm --filter @workspace/focusquest test`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/components/rescue-sheet.tsx artifacts/focusquest/src/components/task-item.tsx artifacts/focusquest/src/components/layout.tsx
git commit -m "feat(web): I'm-stuck rescue sheet — four blockers, four interventions"
```

---

### Task 12: Momentum board (TDD) — absorb Pick Three, retire RecommendCard

**Files:**
- Create: `artifacts/focusquest/src/lib/momentum-board.ts`
- Test: `artifacts/focusquest/src/lib/momentum-board.test.ts`
- Create: `artifacts/focusquest/src/components/momentum-card.tsx`
- Modify: `artifacts/focusquest/src/pages/tasks.tsx` — replace the Today's Focus IIFE (lines ~492–538) with the momentum board; delete `RecommendCard`, the `Recommendation` interface, its state/fetch handlers (lines ~223–260) and its trigger button (~line 400–435 region)
- Delete: `artifacts/focusquest/src/lib/focus-board.ts`, `artifacts/focusquest/src/lib/focus-board.test.ts` (superseded; cases ported)

**Interfaces:**
- Consumes: `MomentumSuggestion`, `Task`, `useGetTasksMomentum`, `usePatchTaskFocus` (generated); `MODE_META` (Task 8); `RescueSheet` (Task 11); `useMicroStep`, countdown (Tasks 8–9).
- Produces:

```ts
export type MomentumBoardState =
  | { kind: "empty" }
  | { kind: "suggesting"; suggestion: MomentumSuggestion | null; pinned: Task[]; completedCount: number; totalPinned: number }
  | { kind: "all-done"; suggestion: MomentumSuggestion | null };
export function momentumBoardState(tasks: Task[], suggestions: MomentumSuggestion[], todayStr: string): MomentumBoardState;
```

- [ ] **Step 1: Write the failing tests** — `artifacts/focusquest/src/lib/momentum-board.test.ts`

```ts
import { describe, it, expect } from "vitest";
import type { MomentumSuggestion, Task } from "@workspace/api-client-react";
import { momentumBoardState } from "./momentum-board";

const TODAY = "2026-07-14";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: Math.floor(Math.random() * 100000),
    title: "quest",
    completed: false,
    isDailyFocus: false,
    focusDate: null,
    ...overrides,
  } as Task;
}

function sugg(t: Task): MomentumSuggestion {
  return { task: t, reason: "why not", kind: "primary" } as MomentumSuggestion;
}

describe("momentumBoardState", () => {
  it("is empty with no pins and no suggestions", () => {
    expect(momentumBoardState([], [], TODAY)).toEqual({ kind: "empty" });
    expect(momentumBoardState([task()], [], TODAY)).toEqual({ kind: "empty" }); // unpinned + no suggestion
  });

  it("suggests when there are candidates but no pins", () => {
    const t = task();
    const s = momentumBoardState([t], [sugg(t)], TODAY);
    expect(s.kind).toBe("suggesting");
    if (s.kind === "suggesting") {
      expect(s.suggestion?.task.id).toBe(t.id);
      expect(s.pinned).toEqual([]);
      expect(s.totalPinned).toBe(0);
    }
  });

  it("dedupes: a pinned primary appears only in the suggestion slot", () => {
    const pinnedA = task({ isDailyFocus: true, focusDate: TODAY });
    const pinnedB = task({ isDailyFocus: true, focusDate: TODAY });
    const s = momentumBoardState([pinnedA, pinnedB], [sugg(pinnedA)], TODAY);
    expect(s.kind).toBe("suggesting");
    if (s.kind === "suggesting") {
      expect(s.suggestion?.task.id).toBe(pinnedA.id);
      expect(s.pinned.map((t) => t.id)).toEqual([pinnedB.id]); // no duplicate row
      expect(s.totalPinned).toBe(2);
      expect(s.completedCount).toBe(0);
    }
  });

  it("counts completed pins and keeps open ones listed", () => {
    const done = task({ isDailyFocus: true, focusDate: TODAY, completed: true });
    const open = task({ isDailyFocus: true, focusDate: TODAY });
    const other = task();
    const s = momentumBoardState([done, open], [sugg(other)], TODAY);
    expect(s.kind).toBe("suggesting");
    if (s.kind === "suggesting") {
      expect(s.completedCount).toBe(1);
      expect(s.totalPinned).toBe(2);
      expect(s.pinned.map((t) => t.id)).toEqual([open.id]);
    }
  });

  it("is all-done when every pin is complete — optional extra win offered", () => {
    const done = task({ isDailyFocus: true, focusDate: TODAY, completed: true });
    const extra = task();
    const s = momentumBoardState([done, extra], [sugg(extra)], TODAY);
    expect(s).toEqual({ kind: "all-done", suggestion: expect.objectContaining({ kind: "primary" }) });
    // …and with nothing else to offer, suggestion is null (still celebratory, never pushy).
    expect(momentumBoardState([done], [], TODAY)).toEqual({ kind: "all-done", suggestion: null });
  });

  it("suggesting with pins but exhausted suggestions keeps the pinned list", () => {
    const open = task({ isDailyFocus: true, focusDate: TODAY });
    const s = momentumBoardState([open], [], TODAY);
    expect(s.kind).toBe("suggesting");
    if (s.kind === "suggesting") {
      expect(s.suggestion).toBeNull();
      expect(s.pinned.map((t) => t.id)).toEqual([open.id]);
    }
  });

  it("ignores pins from other days", () => {
    const stale = task({ isDailyFocus: true, focusDate: "2026-07-13" });
    expect(momentumBoardState([stale], [], TODAY)).toEqual({ kind: "empty" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @workspace/focusquest test -- momentum-board`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `artifacts/focusquest/src/lib/momentum-board.ts`**

```ts
import type { MomentumSuggestion, Task } from "@workspace/api-client-react";

// Successor of focus-board.ts: the Today's Focus board becomes the momentum
// surface (spec: momentum absorbs Pick Three; pinning survives as override).
export type MomentumBoardState =
  | { kind: "empty" }
  | { kind: "suggesting"; suggestion: MomentumSuggestion | null; pinned: Task[]; completedCount: number; totalPinned: number }
  | { kind: "all-done"; suggestion: MomentumSuggestion | null };

export function momentumBoardState(
  tasks: Task[],
  suggestions: MomentumSuggestion[],
  todayStr: string,
): MomentumBoardState {
  const pinnedToday = tasks.filter((t) => t.isDailyFocus && t.focusDate === todayStr);
  const openPins = pinnedToday.filter((t) => !t.completed);
  const suggestion = suggestions.find((s) => s.kind === "primary") ?? suggestions[0] ?? null;

  if (pinnedToday.length > 0 && openPins.length === 0) {
    // Victory state — the optional extra win must never point at a completed pin.
    return { kind: "all-done", suggestion };
  }
  if (pinnedToday.length === 0 && !suggestion) return { kind: "empty" };

  // The primary suggestion owns its card; drop it from the pinned list (no dupes).
  const pinned = openPins.filter((t) => t.id !== suggestion?.task.id);
  return {
    kind: "suggesting",
    suggestion,
    pinned,
    completedCount: pinnedToday.length - openPins.length,
    totalPinned: pinnedToday.length,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/focusquest test -- momentum-board`
Expected: PASS.

- [ ] **Step 5: Write `artifacts/focusquest/src/components/momentum-card.tsx`**

Visual style ports from the deleted RecommendCard (border-primary/50, bg-primary/5, "What's Next" strip → renamed). Full component:

```tsx
import { useEffect, useState } from "react";
import { Clock, LifeBuoy, Pin, RefreshCw, Sparkles, Check, Play, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  MomentumSuggestion, usePatchTaskFocus,
  getGetTasksQueryKey, getGetTasksMomentumQueryKey,
} from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/api-error";
import { CATEGORY_COLORS } from "@/lib/categories";
import { formatClock, MICRO_START_SECONDS } from "@/lib/countdown";
import { useCountdown } from "@/hooks/use-countdown";
import { useMicroStep } from "@/hooks/use-micro-step";
import { RescueSheet } from "./rescue-sheet";

export const MINUTES_CHOICES = [5, 15, 30, 60] as const;

export function MomentumCard({ suggestion, minutes, onMinutes, onSkip, skipping }: {
  suggestion: MomentumSuggestion;
  minutes: number | null;
  onMinutes: (m: number | null) => void;
  onSkip: () => void;
  skipping: boolean;
}) {
  const task = suggestion.task;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const focusMutation = usePatchTaskFocus();
  const [rescueOpen, setRescueOpen] = useState(false);
  const [clock, dispatch] = useCountdown();
  const { targetLabel, complete, isPending } = useMicroStep(task);

  // A new suggestion resets any in-flight micro-start.
  useEffect(() => { dispatch({ type: "reset" }); }, [task.id]);

  const todayStr = new Date().toISOString().split("T")[0];
  const isPinned = task.isDailyFocus && task.focusDate === todayStr;

  const handlePin = () => {
    focusMutation.mutate({ id: task.id, data: { pin: true } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
        toast({ title: "Pinned to Today's Focus", className: "border-primary" });
      },
      onError: (err: any) => toast({ title: apiErrorMessage(err, "Could not pin"), variant: "destructive" }),
    });
  };

  const catStyle = CATEGORY_COLORS[task.category ?? "default"] ?? CATEGORY_COLORS.default!;

  return (
    <div className="rounded-xl border border-primary/50 bg-primary/5 shadow-[0_0_20px_rgba(0,255,255,0.08)]">
      <div className="flex items-center justify-between px-4 pt-3 pb-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary">Next tiny win</span>
        </div>
        {/* "How long do you have?" chips */}
        <div className="flex items-center gap-1">
          {MINUTES_CHOICES.map((m) => (
            <button key={m} onClick={() => onMinutes(minutes === m ? null : m)}
              className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${minutes === m ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:border-primary/40"}`}>
              {m}m
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3">
        <h3 className="text-lg font-bold text-foreground leading-snug mb-1.5">{task.title}</h3>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {task.categoryLabel && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${catStyle}`}>{task.categoryLabel}</span>
          )}
          {task.estimatedMinutes && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />{task.estimatedMinutes}m
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3 italic">"{suggestion.reason}"</p>

        {clock.status !== "idle" ? (
          <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-background/40 px-3 py-2 mb-1">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Two minutes on</p>
              <p className="text-sm font-medium truncate">{targetLabel}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="font-mono text-primary text-lg" aria-live="polite">
                {clock.status === "zero" ? "Still going ✦" : formatClock(clock.remaining)}
              </span>
              <Button size="sm" onClick={() => { complete(); dispatch({ type: "reset" }); }} disabled={isPending} className="h-7 gap-1">
                <Check className="w-3.5 h-3.5" /> Did it
              </Button>
              <Button size="icon" variant="ghost" onClick={() => dispatch({ type: "reset" })} aria-label="Stop micro-start" className="h-7 w-7 text-muted-foreground">
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button size="sm" onClick={() => dispatch({ type: "start", seconds: MICRO_START_SECONDS })} className="h-8 gap-1.5">
              <Play className="w-3.5 h-3.5" /> Start (2 min)
            </Button>
            <Button size="sm" variant="ghost" onClick={onSkip} disabled={skipping} className="h-8 gap-1.5 text-muted-foreground">
              <RefreshCw className={`w-3.5 h-3.5 ${skipping ? "animate-spin" : ""}`} /> Not this one
            </Button>
            {!isPinned && (
              <Button size="sm" variant="ghost" onClick={handlePin} className="h-8 gap-1.5 text-muted-foreground">
                <Pin className="w-3.5 h-3.5" /> Pin it
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setRescueOpen(true)} className="h-8 gap-1.5 text-muted-foreground">
              <LifeBuoy className="w-3.5 h-3.5" /> I'm stuck
            </Button>
          </div>
        )}
      </div>
      <RescueSheet task={task} open={rescueOpen} onOpenChange={setRescueOpen} />
    </div>
  );
}
```

- [ ] **Step 6: Rework `pages/tasks.tsx`.**

  1. Delete the `Recommendation` interface (lines ~29–34) and the whole `RecommendCard` component (~36–160; find its closing brace).
  2. Delete the recommendation state/handlers: `recommendation`, `excludedIds`, `isRecommending`, `fetchRecommendation`, `handleRecommend`, `handleAnother`, `handleDismissRecommendation` (lines ~223–260) and the "Suggest a quest" trigger `<Button>` plus the `{recommendation && <RecommendCard …/>}` block (~400–435).
  3. Remove the now-unused `focusBoardState` import; add:

```ts
import { useGetTasksMomentum, BrainMode } from "@workspace/api-client-react";
import { momentumBoardState } from "@/lib/momentum-board";
import { MomentumCard } from "@/components/momentum-card";
import { MODE_META } from "@/lib/brain-mode-meta";
import { browserTimeZone } from "@/lib/timezone";
```

  4. Inside the `Tasks` component add the momentum plumbing (near the other hooks):

```ts
const tz = browserTimeZone();
const todayStrKey = format(new Date(), "yyyy-MM-dd");
const [skippedIds, setSkippedIds] = useState<number[]>([]);
const [altIndex, setAltIndex] = useState(0);
const [momentumMinutes, setMomentumMinutes] = useState<number | null>(() => {
  const raw = sessionStorage.getItem("momentumMinutes");
  if (!raw) return null;
  const [day, val] = raw.split(":");
  return day === todayStrKey ? Number(val) || null : null; // cleared daily
});
const setMinutes = (m: number | null) => {
  setMomentumMinutes(m);
  if (m) sessionStorage.setItem("momentumMinutes", `${todayStrKey}:${m}`);
  else sessionStorage.removeItem("momentumMinutes");
};
const { data: momentum, isFetching: momentumLoading } = useGetTasksMomentum({
  tz,
  ...(momentumMinutes ? { minutes: momentumMinutes } : {}),
  ...(skippedIds.length ? { exclude: skippedIds.join(",") } : {}),
});
// "Not this one": walk the returned alternates first (instant), then refetch with exclude.
const visibleSuggestions = (momentum?.suggestions ?? []).slice(altIndex);
const handleSkip = () => {
  const current = visibleSuggestions[0];
  if (!current) return;
  if (visibleSuggestions.length > 1) {
    setAltIndex((i) => i + 1);
  } else {
    setSkippedIds((ids) => [...ids, current.task.id]);
    setAltIndex(0);
  }
};
```

  5. Replace the Today's Focus IIFE (lines ~492–538) with:

```tsx
{(() => {
  const board = momentumBoardState(tasks ?? [], visibleSuggestions, todayStrKey);
  const flavor = MODE_META[momentum?.mode ?? BrainMode.neutral].flavor;
  const heading = (
    <div className="flex items-center gap-2">
      <Target className="w-4 h-4 text-primary" />
      <h2 className="text-sm font-semibold uppercase tracking-wider text-primary">Today's Focus</h2>
    </div>
  );
  if (board.kind === "empty") {
    return (
      <div className="mb-6">
        <div className="mb-3">{heading}</div>
        <div className="flex items-center gap-3 p-4 rounded-xl border-2 border-dashed border-primary/25 bg-primary/[0.03]">
          <Pin className="w-4 h-4 text-primary/70 flex-shrink-0" aria-hidden />
          <p className="text-sm text-muted-foreground">
            Nothing queued — add a quest below and the board takes it from there.
          </p>
        </div>
      </div>
    );
  }
  if (board.kind === "all-done") {
    return (
      <div className="mb-6 space-y-3">
        <div className="mb-3">{heading}</div>
        <p className="text-sm text-primary/90 px-1">Focus cleared for today ✦</p>
        {board.suggestion && (
          <div className="px-1">
            <p className="text-xs text-muted-foreground mb-2">One more tiny win, only if you feel like it:</p>
            <MomentumCard suggestion={board.suggestion}
              minutes={momentumMinutes} onMinutes={setMinutes} onSkip={handleSkip} skipping={momentumLoading} />
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-1">
        {heading}
        {board.totalPinned > 0 && (
          <span className="text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-muted border border-border">
            {board.completedCount} / {board.totalPinned} done
          </span>
        )}
      </div>
      {flavor && <p className="text-xs text-muted-foreground mb-3">{flavor}</p>}
      <div className="space-y-2">
        {board.suggestion && (
          <MomentumCard suggestion={board.suggestion}
            minutes={momentumMinutes} onMinutes={setMinutes} onSkip={handleSkip} skipping={momentumLoading} />
        )}
        {board.pinned.length > 0 && (
          <div className="space-y-2 pl-1 border-l-2 border-primary/30">
            {board.pinned.map((task) => (
              <TaskItem key={task.id} task={task} onEdit={handleOpenEdit} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
})()}
```

  6. Delete `artifacts/focusquest/src/lib/focus-board.ts` and `focus-board.test.ts`.

- [ ] **Step 7: Verify**

Run: `pnpm --filter @workspace/focusquest typecheck && pnpm --filter @workspace/focusquest test`
Expected: exit 0; the deleted focus-board suite is gone, momentum-board suite green.

- [ ] **Step 8: Commit**

```bash
git add -A artifacts/focusquest/src
git commit -m "feat(web): momentum board absorbs Pick Three; retire RecommendCard"
```

---

### Task 13: In-browser verification pass

**Files:** none created — this task drives the running app.

Start both processes with the Browser-pane preview tooling (never plain Bash): api-server (`pnpm --filter @workspace/api-server dev`, port from `artifacts/api-server/src/index.ts` / `.env`) and the Vite client (`pnpm --filter @workspace/focusquest dev`), or the repo's existing `.claude/launch.json` entries if present.

- [ ] **Step 1:** Load the app; confirm the header chip renders "Check in" (neutral).
- [ ] **Step 2:** Tap chip → Distracted. Confirm: chip label updates; tasks page board shows the distracted flavor line and a short-estimate suggestion; `GET /brain/state` returns `mode: "distracted"` with a 4-hour-capped `expiresAt` (network tab).
- [ ] **Step 3:** Tap chip → Frozen → "Enter Emergency Mode". Confirm full-screen overlay, one step/title, 2:00 countdown; let it reach 0:00 — copy flips to "Still going? Take your time." with no red/failure styling; "Did it" checks the step and fires the initiation XP toast; exit works from every screen.
- [ ] **Step 4:** Momentum card: "Not this one" swaps instantly (alternates), then refetches with `exclude` after two skips; minutes chips change the suggestion (pick 5m with only long quests → no-estimate/short quest wins); pin a quest → it jumps to the suggestion card or pinned list without duplication.
- [ ] **Step 5:** Rescue: on a multi-step quest choose "It's too big" → steps appear (or cooldown toast if pressed twice — expected); "I can't make myself start" → inline 2-min countdown; "Too much everything" → Emergency Mode; "This isn't the right quest right now" → alternative shown. Confirm one `POST /rescue/events` per intervention (network tab) and that a failed log doesn't block the flow.
- [ ] **Step 6:** Dashboard prompt: clear site data → prompt shows; dismiss → gone; reload → still gone (localStorage); check in → gone; while Hyperfocus → banner shows, prompt suppressed.
- [ ] **Step 7:** Screenshot the board in two different modes + Emergency Mode for the PR.

No commit (nothing changes); fix-forward any bug found (smallest fix, with a test where the bug was in a pure function), commit fixes as `fix(web): …` / `fix(api): …`.

---

### Task 14: Sweep, spec amendment, full verification, PR

**Files:**
- Modify: `docs/superpowers/specs/2026-07-14-act-iii-spine-design.md` (one line in Testing)
- Modify: memory/campaign-map is **not** in this repo — after merge only.

- [ ] **Step 1: Anti-shame copy pass.** Re-read every user-facing string added in Tasks 8–12 (grep the new files for quoted strings) against the spec's five guarantees. Specifically confirm: no counts of check-ins/rescues rendered anywhere; countdown zero-state has no failure framing; the past-due reason is "It's ready when you are — the date slipped by."; frozen copy lowers stakes. Fix anything that reads as guilt.

- [ ] **Step 2: Spec amendments (two lines).**
  1. Route tests: the repo has no route-test harness (no supertest); validation logic lives in unit-tested pure functions instead. In the spec's Testing section replace the line `- Route tests — checkin/rescue enum validation (422), auth (401), momentum param parsing, recommend-path removal (404).` with `- Validation logic (mode/source/blocker/intervention enums, momentum params) is unit-tested at the lib level; routes stay thin per house style (no route-test harness exists in this repo).`
  2. Emergency empty-state: the popover pre-check would require fetching all tasks inside the layout chip; the shipped behavior handles it inside the overlay instead (same guarantee, one less fetch). In the spec's Error handling section replace `Emergency Mode with no candidates at all: don't offer it from the Frozen tap (nothing to show); the popover says "Nothing in the log — add one tiny thing first" with the quick-add focused.` with `Emergency Mode with no candidates at all: the overlay itself shows "Nothing in the log — add one tiny thing first" with a calm exit (checking candidates before offering would need a task fetch in the layout chip; the in-overlay fallback keeps the same guarantee).`

- [ ] **Step 3: Full gates.**

Run, each expected to exit 0:

```bash
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/focusquest test
pnpm typecheck
```

- [ ] **Step 4: Commit the sweep**

```bash
git add -A
git commit -m "docs(spec): route-test note; anti-shame copy pass fixes"
```

- [ ] **Step 5: Push + PR.** Verify branch first: `git branch --show-current` → `feat/act3-spine`.

```bash
git push -u origin feat/act3-spine
& "C:\Program Files\GitHub CLI\gh.exe" pr create --title "feat: Act III spine — brain check-ins & modes, momentum engine, I'm-stuck rescue" --body "<summary of the three features, spec + plan links, test evidence, screenshots from Task 13>"
```

PR body must include: what shipped (three features), the two schema tables (already pushed to Neon), the `/tasks/recommend` → `/tasks/momentum` replacement, anti-shame guarantees honored, and the Task 13 screenshots. End the body with: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 6: Post-merge (outside this repo):** republish the campaign-map artifact (URL + instructions in the `project-feature-roadmap` memory) flipping Brain Check-In & Modes, Momentum Engine, and I'm Stuck Rescue to cleared, and update the roadmap memory.
