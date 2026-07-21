# The Gentle Door Implementation Plan (Act VII quest 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Progressive feature unlock by level (invisible-locked, monotonic, grandfathered) + hero-name rename with a server-enforced 7-day cooldown, per `docs/superpowers/specs/2026-07-20-gentle-door-design.md`.

**Architecture:** One pure server module (`feature-gates.ts`) derives `unlockedFeatures` from `max(level(totalPoints), highestLevel)` and an `unlockAll` grandfather flag; it rides the existing `GET /users/me/stats` payload. Completion/claim responses add `newlyUnlocked` for the level-up dialog. The client filters `NAV_GROUPS`, wraps gated routes with a `withGate` HOC, and hides embedded surfaces (CoinChip, WorldBossPanel). Rename hardens the existing `PATCH /users/me` via a pure `decideRename` module.

**Tech Stack:** Express + drizzle (Neon PG), OpenAPI→orval codegen, React 19 + wouter + TanStack Query v5, vitest.

## Global Constraints

- **Anti-shame law:** locked features are INVISIBLE. No "unlocks at level N", no countdowns, no grayed entries, no copy that names a locked surface. Celebration only at the unlock moment.
- **Fail open:** missing/undefined `unlockedFeatures` on the client ⇒ render everything. Gates are pacing, not authorization — no server-side 403s.
- **Monotonic:** an unlocked feature never re-locks. `newlyUnlocked` is ALWAYS `[]` for grandfathered (`unlockAll`) users.
- **No XP-curve changes.** Levels stay `getLevelInfo(totalPoints)` from `artifacts/api-server/src/lib/gamification.ts`.
- Never hand-edit `lib/*/src/generated/**` — regenerate with `pnpm --filter @workspace/api-spec codegen`.
- Tests: `pnpm --filter @workspace/api-server test`, `pnpm --filter @workspace/focusquest test` (pure-lib test style; components stay thin).
- Windows checkout: harmless `LF will be replaced by CRLF` warnings on commit — ignore them.
- Every commit ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Work on branch `feat/gentle-door` (created from `main` in Task 1).

---

### Task 1: Schema columns + migration 0003

**Files:**
- Modify: `lib/db/src/schema/users.ts` (after the `pushesSentDate`/`lastPushAt` block, before `createdAt`)
- Create (generated): `lib/db/drizzle/0003_gentle_door.sql` + `lib/db/drizzle/meta/*` updates
- Commit also: `docs/superpowers/plans/2026-07-20-gentle-door.md` (this plan, already in the working tree)

**Interfaces:**
- Produces: `usersTable.unlockAll: boolean NOT NULL DEFAULT true`, `usersTable.highestLevel: integer NOT NULL DEFAULT 1`, `usersTable.usernameChangedAt: timestamp | null` — every later server task relies on these exact property names on `User` (`$inferSelect`).

- [ ] **Step 1: Create the branch** (verify you're on `main` first — concurrent sessions share this tree):

```bash
git branch --show-current   # must print: main
git checkout -b feat/gentle-door
```

- [ ] **Step 2: Add the three columns** to `lib/db/src/schema/users.ts` directly above the `createdAt` line:

```ts
  // Act VII Gentle Door (q5): progressive-unlock state.
  // unlockAll — grandfather flag. The column default stamps TRUE onto every row
  // that exists when the migration runs (pre-quest behavior: everything open);
  // only the auth create path inserts FALSE, so exactly the accounts born after
  // this ship get the gentle door. Unforeseen insert paths fail open.
  unlockAll: boolean("unlock_all").notNull().default(true),
  // Monotonic unlock floor: highest level reached before any XP reversal.
  // Written ONLY in the /uncomplete transaction (the sole XP-lowering path) —
  // forward progress needs no writes because derived level covers it. Gates
  // read max(derived level, highestLevel) so a seen door never closes.
  highestLevel: integer("highest_level").notNull().default(1),
  // Rename cooldown anchor: set on each successful post-onboarding rename;
  // null until the first real rename (the onboarding set doesn't start the
  // clock — a minute-zero typo must be fixable immediately).
  usernameChangedAt: timestamp("username_changed_at"),
```

- [ ] **Step 3: Generate the migration** (placeholder URL is fine for generate — it never connects):

```bash
cd "C:/Users/Chadr/OneDrive/Documents/Quest-Companion"
DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" pnpm --filter @workspace/db generate --name gentle_door
```

Expected: emits `lib/db/drizzle/0003_gentle_door.sql`.

- [ ] **Step 4: Review the SQL** — it must be exactly three ADD COLUMNs, nothing else (no DROPs, no constraint churn):

```sql
ALTER TABLE "users" ADD COLUMN "unlock_all" boolean DEFAULT true NOT NULL;
ALTER TABLE "users" ADD COLUMN "highest_level" integer DEFAULT 1 NOT NULL;
ALTER TABLE "users" ADD COLUMN "username_changed_at" timestamp;
```

(Column order may differ; content must not.)

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck:libs
```

Expected: clean.

- [ ] **Step 6: Commit** (SQL + meta together, per repo rule):

```bash
git add lib/db/src/schema/users.ts lib/db/drizzle docs/superpowers/plans/2026-07-20-gentle-door.md
git commit -m "feat(db): gentle-door columns — unlock_all grandfather flag, highest_level floor, username_changed_at

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Do NOT run `db migrate` in this task** — live apply happens in Task 10 after the suite is green (shared live Neon).

---

### Task 2: Server pure lib `feature-gates.ts` (TDD)

**Files:**
- Create: `artifacts/api-server/src/lib/feature-gates.ts`
- Test: `artifacts/api-server/src/lib/feature-gates.test.ts`

**Interfaces:**
- Consumes: `getLevelInfo(totalPoints)` from `./gamification` (L2@100, L3@250, L4@500, L5@850, L6@1300).
- Produces (exact signatures later tasks import):
  - `FEATURE_KEYS: readonly ["focus","hero","progress","allies","rewards"]`, `type FeatureKey`
  - `FEATURE_GATES: Record<FeatureKey, number>` = `{ focus: 2, hero: 3, progress: 4, allies: 5, rewards: 6 }`
  - `effectiveLevel(u: { totalPoints: number; highestLevel: number }): number`
  - `unlockedFeatures(u: { totalPoints: number; highestLevel: number; unlockAll: boolean }): FeatureKey[]`
  - `isFeatureUnlocked(u, key: FeatureKey): boolean` (same `u` shape as `unlockedFeatures`)
  - `newlyUnlocked(u: { unlockAll: boolean; highestLevel: number }, beforeDerivedLevel: number, afterDerivedLevel: number): FeatureKey[]`

- [ ] **Step 1: Write the failing test** `artifacts/api-server/src/lib/feature-gates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  FEATURE_GATES, FEATURE_KEYS, effectiveLevel, isFeatureUnlocked, newlyUnlocked, unlockedFeatures,
} from "./feature-gates";

const fresh = (totalPoints: number, highestLevel = 1) =>
  ({ totalPoints, highestLevel, unlockAll: false });
const grandfathered = { totalPoints: 0, highestLevel: 1, unlockAll: true };

describe("effectiveLevel", () => {
  it("is the derived level when the floor is below it", () => {
    expect(effectiveLevel({ totalPoints: 250, highestLevel: 1 })).toBe(3);
  });
  it("is the floor when XP reversal dropped the derived level (monotonic)", () => {
    expect(effectiveLevel({ totalPoints: 99, highestLevel: 2 })).toBe(2);
  });
});

describe("unlockedFeatures", () => {
  it("is empty at L1 for a fresh account", () => {
    expect(unlockedFeatures(fresh(0))).toEqual([]);
  });
  it("opens exactly the charter ladder as levels rise", () => {
    expect(unlockedFeatures(fresh(100))).toEqual(["focus"]);
    expect(unlockedFeatures(fresh(250))).toEqual(["focus", "hero"]);
    expect(unlockedFeatures(fresh(500))).toEqual(["focus", "hero", "progress"]);
    expect(unlockedFeatures(fresh(850))).toEqual(["focus", "hero", "progress", "allies"]);
    expect(unlockedFeatures(fresh(1300))).toEqual([...FEATURE_KEYS]);
  });
  it("gives grandfathered users everything regardless of XP", () => {
    expect(unlockedFeatures(grandfathered)).toEqual([...FEATURE_KEYS]);
  });
  it("keeps a floored feature open after XP reversal", () => {
    expect(unlockedFeatures(fresh(99, 2))).toEqual(["focus"]);
  });
});

describe("isFeatureUnlocked", () => {
  it("matches the list", () => {
    expect(isFeatureUnlocked(fresh(100), "focus")).toBe(true);
    expect(isFeatureUnlocked(fresh(100), "hero")).toBe(false);
    expect(isFeatureUnlocked(grandfathered, "rewards")).toBe(true);
  });
});

describe("newlyUnlocked", () => {
  it("reports the gate crossed by an award", () => {
    expect(newlyUnlocked({ unlockAll: false, highestLevel: 1 }, 1, 2)).toEqual(["focus"]);
  });
  it("reports multiple gates when a big award skips levels", () => {
    expect(newlyUnlocked({ unlockAll: false, highestLevel: 1 }, 1, 4)).toEqual(["focus", "hero", "progress"]);
  });
  it("is ALWAYS empty for grandfathered users (they had everything)", () => {
    expect(newlyUnlocked({ unlockAll: true, highestLevel: 1 }, 1, 6)).toEqual([]);
  });
  it("does not re-celebrate a re-crossed gate the floor already holds", () => {
    // uncomplete dropped derived 2→1 with floor 2; re-crossing 1→2 is not new
    expect(newlyUnlocked({ unlockAll: false, highestLevel: 2 }, 1, 2)).toEqual([]);
  });
  it("is empty when no gate sits inside the crossed range", () => {
    expect(newlyUnlocked({ unlockAll: false, highestLevel: 1 }, 2, 2)).toEqual([]);
    expect(newlyUnlocked({ unlockAll: false, highestLevel: 1 }, 6, 10)).toEqual([]);
  });
});

describe("gate table", () => {
  it("pins the charter ladder", () => {
    expect(FEATURE_GATES).toEqual({ focus: 2, hero: 3, progress: 4, allies: 5, rewards: 6 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @workspace/api-server test -- feature-gates
```

Expected: FAIL — cannot resolve `./feature-gates`.

- [ ] **Step 3: Implement** `artifacts/api-server/src/lib/feature-gates.ts`:

```ts
// Act VII Gentle Door (q5): progressive unlock by level. Pure — no I/O.
// Locked features are INVISIBLE client-side (anti-shame law); these keys ride
// GET /users/me/stats as `unlockedFeatures`. Keys deliberately equal the
// client's NavGroupKey values (home/quests are always-on and never listed).
import { getLevelInfo } from "./gamification";

export const FEATURE_KEYS = ["focus", "hero", "progress", "allies", "rewards"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_GATES: Record<FeatureKey, number> = {
  focus: 2, hero: 3, progress: 4, allies: 5, rewards: 6,
};

export interface GateUser {
  totalPoints: number;
  highestLevel: number;
  unlockAll: boolean;
}

/** Gate level: derived level, floored by the pre-reversal high-water mark so an
 * uncomplete can never close a door the user has seen. */
export function effectiveLevel(u: Pick<GateUser, "totalPoints" | "highestLevel">): number {
  return Math.max(getLevelInfo(u.totalPoints).level, u.highestLevel);
}

export function unlockedFeatures(u: GateUser): FeatureKey[] {
  if (u.unlockAll) return [...FEATURE_KEYS];
  const level = effectiveLevel(u);
  return FEATURE_KEYS.filter((k) => level >= FEATURE_GATES[k]);
}

export function isFeatureUnlocked(u: GateUser, key: FeatureKey): boolean {
  return u.unlockAll || effectiveLevel(u) >= FEATURE_GATES[key];
}

/** Gates crossed by one award, for the level-up dialog's "Unlocked" line.
 * Takes DERIVED levels before/after; the floor is applied here so re-crossing
 * a floored gate is never re-celebrated. Always [] for grandfathered users —
 * congratulating them for "unlocking" a thing they've used for weeks is a lie. */
export function newlyUnlocked(
  u: Pick<GateUser, "unlockAll" | "highestLevel">,
  beforeDerivedLevel: number,
  afterDerivedLevel: number,
): FeatureKey[] {
  if (u.unlockAll) return [];
  const before = Math.max(beforeDerivedLevel, u.highestLevel);
  const after = Math.max(afterDerivedLevel, u.highestLevel);
  return FEATURE_KEYS.filter((k) => FEATURE_GATES[k] > before && FEATURE_GATES[k] <= after);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @workspace/api-server test -- feature-gates
```

Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/feature-gates.ts artifacts/api-server/src/lib/feature-gates.test.ts
git commit -m "feat(api): feature-gates pure lib — effective level, unlock ladder, newlyUnlocked

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Rename decision pure lib (TDD)

**Files:**
- Create: `artifacts/api-server/src/lib/rename.ts`
- Test: `artifacts/api-server/src/lib/rename.test.ts`

**Interfaces:**
- Produces (Task 5 imports these exactly):
  - `USERNAME_REGEX: RegExp` (`/^[a-zA-Z0-9_]{3,20}$/`)
  - `RENAME_COOLDOWN_MS: number` (7 days)
  - `type RenameDecision = { kind: "noop" } | { kind: "invalid_format" } | { kind: "cooldown"; renameAvailableAt: Date } | { kind: "ok"; isOnboardingSet: boolean }`
  - `decideRename(args: { current: string; requested: string; onboardingComplete: boolean; usernameChangedAt: Date | null; now: Date }): RenameDecision`
  - `renameAvailableAt(usernameChangedAt: Date | null, now: Date): string | null`
  - `isUniqueViolation(err: unknown): boolean` (walks `.cause` chain for pg code `23505`)

- [ ] **Step 1: Write the failing test** `artifacts/api-server/src/lib/rename.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decideRename, isUniqueViolation, renameAvailableAt } from "./rename";

const NOW = new Date("2026-07-20T12:00:00Z");
const base = {
  current: "OldName",
  requested: "NewName",
  onboardingComplete: true,
  usernameChangedAt: null as Date | null,
  now: NOW,
};

describe("decideRename", () => {
  it("no-ops on the same name (clock untouched)", () => {
    expect(decideRename({ ...base, requested: "OldName" })).toEqual({ kind: "noop" });
  });
  it("rejects bad formats server-side", () => {
    for (const bad of ["ab", "a".repeat(21), "has space", "sneaky-dash", ""]) {
      expect(decideRename({ ...base, requested: bad }).kind).toBe("invalid_format");
    }
  });
  it("trims before validating and comparing", () => {
    expect(decideRename({ ...base, requested: "  OldName  " })).toEqual({ kind: "noop" });
  });
  it("lets the onboarding set through with no clock (typos are free)", () => {
    expect(decideRename({ ...base, onboardingComplete: false }))
      .toEqual({ kind: "ok", isOnboardingSet: true });
  });
  it("allows the first real rename (usernameChangedAt null)", () => {
    expect(decideRename(base)).toEqual({ kind: "ok", isOnboardingSet: false });
  });
  it("cooldowns a second rename inside 7 days, reporting when it reopens", () => {
    const changed = new Date("2026-07-18T12:00:00Z"); // 2 days ago
    const d = decideRename({ ...base, usernameChangedAt: changed });
    expect(d.kind).toBe("cooldown");
    if (d.kind === "cooldown") {
      expect(d.renameAvailableAt.toISOString()).toBe("2026-07-25T12:00:00.000Z");
    }
  });
  it("allows a rename exactly at the 7-day boundary", () => {
    const changed = new Date("2026-07-13T12:00:00Z"); // exactly 7 days
    expect(decideRename({ ...base, usernameChangedAt: changed }).kind).toBe("ok");
  });
});

describe("renameAvailableAt", () => {
  it("is null when never renamed", () => {
    expect(renameAvailableAt(null, NOW)).toBeNull();
  });
  it("is null once the window has passed", () => {
    expect(renameAvailableAt(new Date("2026-07-01T00:00:00Z"), NOW)).toBeNull();
  });
  it("is the reopen instant while cooling down", () => {
    expect(renameAvailableAt(new Date("2026-07-19T00:00:00Z"), NOW)).toBe("2026-07-26T00:00:00.000Z");
  });
});

describe("isUniqueViolation", () => {
  it("spots pg 23505 directly and through cause chains", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation(new Error("wrap", { cause: { code: "23505" } }))).toBe(true);
    expect(isUniqueViolation(new Error("plain"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @workspace/api-server test -- rename
```

Expected: FAIL — cannot resolve `./rename`.

- [ ] **Step 3: Implement** `artifacts/api-server/src/lib/rename.ts`:

```ts
// Act VII Gentle Door (q5): hero-name rename rules. Pure — no I/O.
// The onboarding set is free and starts no clock; each later rename opens a
// 7-day window. The gentle door's whole point: minute-zero decisions are
// reversible.
export const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;
export const RENAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export type RenameDecision =
  | { kind: "noop" }
  | { kind: "invalid_format" }
  | { kind: "cooldown"; renameAvailableAt: Date }
  | { kind: "ok"; isOnboardingSet: boolean };

export function decideRename(args: {
  current: string;
  requested: string;
  onboardingComplete: boolean;
  usernameChangedAt: Date | null;
  now: Date;
}): RenameDecision {
  const requested = args.requested.trim();
  if (requested === args.current) return { kind: "noop" };
  if (!USERNAME_REGEX.test(requested)) return { kind: "invalid_format" };
  if (args.onboardingComplete && args.usernameChangedAt) {
    const availableAt = new Date(args.usernameChangedAt.getTime() + RENAME_COOLDOWN_MS);
    if (args.now.getTime() < availableAt.getTime()) {
      return { kind: "cooldown", renameAvailableAt: availableAt };
    }
  }
  return { kind: "ok", isOnboardingSet: !args.onboardingComplete };
}

/** ISO instant the next rename opens, or null when renaming is available now. */
export function renameAvailableAt(usernameChangedAt: Date | null, now: Date): string | null {
  if (!usernameChangedAt) return null;
  const at = new Date(usernameChangedAt.getTime() + RENAME_COOLDOWN_MS);
  return at.getTime() > now.getTime() ? at.toISOString() : null;
}

/** Postgres unique-violation (23505), wherever the driver buried it. */
export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  while (e && typeof e === "object") {
    if ((e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @workspace/api-server test -- rename
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/rename.ts artifacts/api-server/src/lib/rename.test.ts
git commit -m "feat(api): rename decision lib — format, onboarding-free set, 7-day cooldown, 23505 helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: OpenAPI contract + codegen

**Files:**
- Modify: `lib/api-spec/openapi.yaml` — `UserStats` (~line 2340), `TaskCompletionResult` (~2702), `QuestlineClaimResult` (~2833), `User` (~2280), PATCH `/users/me` responses (~line 180)
- Regenerate: `lib/api-client-react/src/generated/**`, `lib/api-zod/src/generated/**` (via codegen — never by hand)

**Interfaces:**
- Produces: client types/hooks used later — `UserStats.unlockedFeatures: FeatureKey[]`, `TaskCompletionResult.newlyUnlocked`, `QuestlineClaimResult.newlyUnlocked`, `User.renameAvailableAt: string | null`. Feature-key enum name in generated code will be derived from the shared schema name `FeatureKey`.

- [ ] **Step 1: Add a shared enum schema** next to the other small schemas (put it directly above `UserStats`):

```yaml
    FeatureKey:
      type: string
      description: Gentle Door progressive-unlock feature groups (keys match client nav groups)
      enum: [focus, hero, progress, allies, rewards]
```

- [ ] **Step 2: `UserStats`** — append to `required` list: `unlockedFeatures`; add property:

```yaml
        unlockedFeatures:
          type: array
          description: Features visible to this user. Grandfathered accounts always get all five; locked features are invisible client-side (never teased).
          items:
            $ref: "#/components/schemas/FeatureKey"
```

- [ ] **Step 3: `TaskCompletionResult`** — append `newlyUnlocked` to `required`; add property:

```yaml
        newlyUnlocked:
          type: array
          description: Gates crossed by this award (for the level-up dialog). Always empty for grandfathered users.
          items:
            $ref: "#/components/schemas/FeatureKey"
```

- [ ] **Step 4: `QuestlineClaimResult`** — same addition as Step 3 (append to `required`, same property block).

- [ ] **Step 5: `User`** (~line 2280) — append `renameAvailableAt` to its `required` list; add property:

```yaml
        renameAvailableAt:
          type: ["string", "null"]
          format: date-time
          description: Instant the next hero-name rename opens; null when renaming is available now.
```

- [ ] **Step 6: PATCH `/users/me`** (operationId `updateMe`, ~line 180) — look at the existing responses block (it has a `"200"`); add below it, matching the file's error style (inline object schemas with an `error` property, as used by other 4xx responses in this file — check one, e.g. the 409 on the questline claim path, and mirror its shape exactly):

```yaml
        "400":
          description: Invalid hero name format
          content:
            application/json:
              schema:
                type: object
                required: [error]
                properties:
                  error:
                    type: string
        "409":
          description: Hero name already taken
          content:
            application/json:
              schema:
                type: object
                required: [error]
                properties:
                  error:
                    type: string
        "429":
          description: Rename cooldown active
          content:
            application/json:
              schema:
                type: object
                required: [error, renameAvailableAt]
                properties:
                  error:
                    type: string
                  renameAvailableAt:
                    type: string
                    format: date-time
```

- [ ] **Step 7: Regenerate + typecheck**

```bash
pnpm --filter @workspace/api-spec codegen
pnpm typecheck:libs
```

Expected: codegen exits 0. **Typecheck of dependent packages may fail at the ROOT gate (`pnpm typecheck`) because server routes don't emit the new required fields yet — that's expected until Tasks 5–6 land; `typecheck:libs` itself must pass.** If `pnpm typecheck:libs` fails, fix the yaml, regenerate.

- [ ] **Step 8: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "feat(api-spec): unlockedFeatures on stats, newlyUnlocked on completion/claim, renameAvailableAt + 400/409/429 on users/me

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Server route wiring — stats, completion, claim, uncomplete floor, auth flag, rename

**Files:**
- Modify: `artifacts/api-server/src/routes/users.ts` (formatUser ~line 18, PATCH ~line 48, stats ~line 122)
- Modify: `artifacts/api-server/src/routes/tasks.ts` (complete tx ~line 660 + response ~line 891 + already_completed ~line 743; uncomplete tx ~line 995)
- Modify: `artifacts/api-server/src/routes/questlines.ts` (claim tx ~line 228 + response ~line 269)
- Modify: `artifacts/api-server/src/routes/auth.ts` (`upsertGameUser` insert ~line 102)

**Interfaces:**
- Consumes: Task 2 (`unlockedFeatures`, `newlyUnlocked` from `../lib/feature-gates`), Task 3 (`decideRename`, `renameAvailableAt`, `isUniqueViolation` from `../lib/rename`), Task 1 columns.
- Produces: runtime payloads matching Task 4's contract. After this task `pnpm typecheck` (root) must be fully green again.

- [ ] **Step 1: users.ts — stats + formatUser + PATCH.**

Imports:

```ts
import { unlockedFeatures } from "../lib/feature-gates";
import { decideRename, isUniqueViolation, renameAvailableAt } from "../lib/rename";
```

In `formatUser`, add after `pointsToNextLevel`:

```ts
    renameAvailableAt: renameAvailableAt(user.usernameChangedAt, new Date()),
```

In `GET /users/me/stats` res.json, add after `pointsIntoLevel`:

```ts
    unlockedFeatures: unlockedFeatures(user),
```

Replace the whole `router.patch("/users/me", …)` handler with:

```ts
router.patch("/users/me", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userId = req.gameUserId;

  const { username, displayName, avatarColor } = req.body as { username?: string; displayName?: string; avatarColor?: string };
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (displayName != null) updates.displayName = displayName;
  if (avatarColor != null) updates.avatarColor = avatarColor;

  const [current] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!current) { res.status(404).json({ error: "User not found" }); return; }

  if (username != null) {
    const decision = decideRename({
      current: current.username,
      requested: username,
      onboardingComplete: current.onboardingComplete,
      usernameChangedAt: current.usernameChangedAt,
      now: new Date(),
    });
    if (decision.kind === "invalid_format") {
      res.status(400).json({ error: "Hero names are 3–20 characters: letters, numbers, and underscores." });
      return;
    }
    if (decision.kind === "cooldown") {
      res.status(429).json({
        error: "Hero names can change once a week.",
        renameAvailableAt: decision.renameAvailableAt.toISOString(),
      });
      return;
    }
    if (decision.kind === "ok") {
      updates.username = username.trim();
      updates.onboardingComplete = true;
      // The onboarding set is free; only real renames start the 7-day clock.
      if (!decision.isOnboardingSet) updates.usernameChangedAt = new Date();
    }
    // "noop": same name — fall through without username updates.
  }

  if (Object.keys(updates).length === 0) {
    res.json(formatUser(current));
    return;
  }

  try {
    const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    res.json(formatUser(user));
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "That hero name is already taken. Try another." });
      return;
    }
    throw err;
  }
});
```

- [ ] **Step 2: tasks.ts — completion `newlyUnlocked` + uncomplete floor.**

Import (top of file, near the `getLevelInfo` import):

```ts
import { newlyUnlocked } from "../lib/feature-gates";
```

In the **complete** transaction, right after `const leveledUp = newLevel.level > oldLevel.level;` (~line 661), add:

```ts
    // Gentle Door: gates crossed by this award (floor-aware; [] for unlockAll).
    const unlockedByAward = newlyUnlocked(user, oldLevel.level, newLevel.level);
```

Thread `unlockedByAward` through the tx return object (add `unlockedByAward,` alongside `leveledUp,` in the `return { status: "ok", … }` block ~line 726) and the destructuring at ~line 759–760 (add `unlockedByAward`).

In the main `res.json` (~line 900) add after `leveledUp,`:

```ts
    newlyUnlocked: unlockedByAward,
```

In the `already_completed` early response (~line 752) add after `leveledUp: false,`:

```ts
      newlyUnlocked: [],
```

In the **uncomplete** transaction's user update (~line 995), add the floor write (comment included):

```ts
      // Gentle Door monotonic floor: capture the pre-reversal level so this XP
      // drop can never close a door the user has seen. Only written here — the
      // sole XP-lowering path.
      highestLevel: Math.max(user.highestLevel, getLevelInfo(user.totalPoints).level),
```

(`user.totalPoints` at that point is still the pre-reversal value — the tx computes `newTotalPoints` separately; verify you're reading the locked `user` row selected at the top of the tx, not `newTotalPoints`.)

- [ ] **Step 3: questlines.ts — claim `newlyUnlocked`.**

Import:

```ts
import { newlyUnlocked } from "../lib/feature-gates";
```

In the claim tx (after `const afterLevel = getLevelInfo(newTotal);` ~line 231):

```ts
    const unlockedByAward = newlyUnlocked(user, beforeLevel, afterLevel.level);
```

Add `unlockedByAward: FeatureKey[]`-typed member to the `Outcome` "ok" variant (import the type: `import { newlyUnlocked, type FeatureKey } from "../lib/feature-gates";`), return it from the tx, and add to the 200 response after `leveledUp:`:

```ts
    newlyUnlocked: outcome.unlockedByAward,
```

- [ ] **Step 4: auth.ts — fresh accounts get the gentle door.**

In `upsertGameUser`'s insert (~line 102–104):

```ts
  const [created] = await db
    .insert(usersTable)
    // unlockAll false: accounts born after the Gentle Door get progressive
    // unlock; every pre-existing row was stamped true by the migration default.
    .values({ externalId, username, unlockAll: false, ...(capture ?? {}) })
    .returning({ id: usersTable.id });
```

- [ ] **Step 5: Full typecheck + server suite**

```bash
pnpm typecheck
pnpm --filter @workspace/api-server test
```

Expected: both clean (root typecheck green again — Task 4's contract now has emitters).

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/users.ts artifacts/api-server/src/routes/tasks.ts artifacts/api-server/src/routes/questlines.ts artifacts/api-server/src/routes/auth.ts
git commit -m "feat(api): gentle-door wiring — stats unlockedFeatures, newlyUnlocked on award paths, uncomplete floor, unlockAll=false at signup, rename hardening

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Notification scheduler hero gate

**Files:**
- Modify: `artifacts/api-server/src/lib/notification-scheduler.ts` (`heroCareCandidate`, line 116)

**Interfaces:**
- Consumes: `isFeatureUnlocked` from `./feature-gates` (Task 2); `User` row already carries `unlockAll`/`highestLevel` (Task 1).

- [ ] **Step 1: Add the guard** as the first statement of `heroCareCandidate` (import `isFeatureUnlocked` from `./feature-gates`):

```ts
async function heroCareCandidate(user: User, now: Date): Promise<ProducedCandidate | null> {
  // Gentle Door: no hero-category pushes (hunger, companion milestones, flavor)
  // while the hero door is closed — "feed your hero" aimed at someone who has
  // never seen the hero is confusion shaped like shame. Skipping the milestone
  // marker maintenance too is safe: a stale marker can only suppress a future
  // celebration, never spam one.
  if (!isFeatureUnlocked(user, "hero")) return null;
```

- [ ] **Step 2: Typecheck + full server suite**

```bash
pnpm typecheck
pnpm --filter @workspace/api-server test
```

Expected: clean (scheduler has no direct unit test file; the guard's logic is Task 2's tested `isFeatureUnlocked`).

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/lib/notification-scheduler.ts
git commit -m "feat(api): suppress hero-category pushes while the hero door is closed

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Client pure lib `feature-gates.ts` (TDD)

**Files:**
- Create: `artifacts/focusquest/src/lib/feature-gates.ts`
- Test: `artifacts/focusquest/src/lib/feature-gates.test.ts`

**Interfaces:**
- Consumes: `NAV_GROUPS`, `type NavGroupKey` from `./nav-groups`.
- Produces (Tasks 8–9 import these exactly):
  - `type FeatureKey = "focus" | "hero" | "progress" | "allies" | "rewards"`
  - `isUnlocked(unlockedFeatures: readonly string[] | undefined, key: FeatureKey): boolean` — undefined ⇒ true (fail open)
  - `isNavGroupVisible(key: NavGroupKey, unlockedFeatures: readonly string[] | undefined): boolean`
  - `routeFeature(path: string): FeatureKey | null`
  - `featureLabel(key: string): string` (nav label lookup, falls back to the key)

- [ ] **Step 1: Write the failing test** `artifacts/focusquest/src/lib/feature-gates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NAV_GROUPS } from "./nav-groups";
import { featureLabel, isNavGroupVisible, isUnlocked, routeFeature } from "./feature-gates";

describe("isUnlocked", () => {
  it("fails OPEN when the list is missing (offline shell, cold start)", () => {
    expect(isUnlocked(undefined, "rewards")).toBe(true);
  });
  it("reads the server's list", () => {
    expect(isUnlocked(["focus"], "focus")).toBe(true);
    expect(isUnlocked(["focus"], "hero")).toBe(false);
    expect(isUnlocked([], "focus")).toBe(false);
  });
});

describe("isNavGroupVisible", () => {
  it("always shows home and quests", () => {
    expect(isNavGroupVisible("home", [])).toBe(true);
    expect(isNavGroupVisible("quests", [])).toBe(true);
  });
  it("shows exactly Home+Quests for a fresh L1 list", () => {
    const visible = NAV_GROUPS.filter((g) => isNavGroupVisible(g.key, []));
    expect(visible.map((g) => g.key)).toEqual(["home", "quests"]);
  });
  it("shows everything when the list is missing (fail open)", () => {
    const visible = NAV_GROUPS.filter((g) => isNavGroupVisible(g.key, undefined));
    expect(visible.length).toBe(NAV_GROUPS.length);
  });
  it("adds groups as the list grows", () => {
    const visible = NAV_GROUPS.filter((g) => isNavGroupVisible(g.key, ["focus", "hero"]));
    expect(visible.map((g) => g.key)).toEqual(["home", "quests", "focus", "hero"]);
  });
});

describe("routeFeature", () => {
  it("maps every gated route to its feature", () => {
    expect(routeFeature("/focus")).toBe("focus");
    expect(routeFeature("/avatar")).toBe("hero");
    expect(routeFeature("/progress")).toBe("progress");
    expect(routeFeature("/insights")).toBe("progress");
    expect(routeFeature("/partners")).toBe("allies");
    expect(routeFeature("/partners/7")).toBe("allies");
    expect(routeFeature("/leaderboard")).toBe("allies");
    expect(routeFeature("/rewards/treats")).toBe("rewards");
    expect(routeFeature("/rewards/store")).toBe("rewards");
    expect(routeFeature("/rewards/perks")).toBe("rewards");
  });
  it("leaves L1 routes ungated", () => {
    for (const p of ["/", "/tasks", "/questlines", "/questlines/3", "/recurring", "/reflection"]) {
      expect(routeFeature(p)).toBeNull();
    }
  });
});

describe("featureLabel", () => {
  it("uses the nav label users will see", () => {
    expect(featureLabel("focus")).toBe("Focus");
    expect(featureLabel("rewards")).toBe("Rewards");
  });
  it("falls back to the key for unknown values", () => {
    expect(featureLabel("mystery")).toBe("mystery");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @workspace/focusquest test -- feature-gates
```

Expected: FAIL — cannot resolve `./feature-gates`.

- [ ] **Step 3: Implement** `artifacts/focusquest/src/lib/feature-gates.ts`:

```ts
// Act VII Gentle Door (q5). Locked features are INVISIBLE — no teasers, no
// "unlocks at level N", no countdowns (anti-shame law). The client renders
// whatever the server's `unlockedFeatures` list says; an ABSENT list (offline
// shell, cold start) fails OPEN — this is pacing, not authorization, and a
// grandfathered user offline must never lose chrome.
import { NAV_GROUPS, type NavGroupKey } from "./nav-groups";

export type FeatureKey = "focus" | "hero" | "progress" | "allies" | "rewards";

const ALWAYS_ON: ReadonlySet<NavGroupKey> = new Set(["home", "quests"]);

export function isUnlocked(
  unlockedFeatures: readonly string[] | undefined,
  key: FeatureKey,
): boolean {
  return unlockedFeatures === undefined || unlockedFeatures.includes(key);
}

export function isNavGroupVisible(
  key: NavGroupKey,
  unlockedFeatures: readonly string[] | undefined,
): boolean {
  if (ALWAYS_ON.has(key)) return true;
  return isUnlocked(unlockedFeatures, key as FeatureKey);
}

// Path prefix → gate. Anything unlisted is L1 core and never gated.
const ROUTE_FEATURES: ReadonlyArray<{ prefix: string; feature: FeatureKey }> = [
  { prefix: "/focus", feature: "focus" },
  { prefix: "/avatar", feature: "hero" },
  { prefix: "/progress", feature: "progress" },
  { prefix: "/insights", feature: "progress" },
  { prefix: "/partners", feature: "allies" },
  { prefix: "/leaderboard", feature: "allies" },
  { prefix: "/rewards", feature: "rewards" },
];

export function routeFeature(path: string): FeatureKey | null {
  for (const r of ROUTE_FEATURES) {
    if (path === r.prefix || path.startsWith(`${r.prefix}/`)) return r.feature;
  }
  return null;
}

/** Label for the unlock celebration — the same word the nav will show. */
export function featureLabel(key: string): string {
  return NAV_GROUPS.find((g) => g.key === key)?.label ?? key;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @workspace/focusquest test -- feature-gates
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/lib/feature-gates.ts artifacts/focusquest/src/lib/feature-gates.test.ts
git commit -m "feat(web): client feature-gates lib — fail-open unlock checks, nav visibility, route map, labels

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Nav filtering, route guards, embedded surfaces

**Files:**
- Modify: `artifacts/focusquest/src/components/layout.tsx` (nav lists ~lines 170–171, 254, 321; `useGetNudges` ~line 177)
- Modify: `artifacts/focusquest/src/App.tsx` (Router, ~lines 189–216)
- Modify: `artifacts/focusquest/src/components/coin-chip.tsx`
- Modify: `artifacts/focusquest/src/pages/avatar.tsx` (WorldBossPanel ~line 844)
- Modify: `artifacts/focusquest/src/components/status-row.tsx` + `artifacts/focusquest/src/pages/now.tsx` (~line 170)
- Modify: `artifacts/focusquest/src/components/task-item.tsx` (gear toasts ~lines 164–200)

**Interfaces:**
- Consumes: Task 7 (`isUnlocked`, `isNavGroupVisible`, `type FeatureKey`), Task 4 generated `UserStats.unlockedFeatures`.
- Produces: `withGate(feature, Component)` HOC in `App.tsx` (local, not exported); `StatusRow` gains prop `linkToProgress?: boolean` (default `true`).

- [ ] **Step 1: layout.tsx.** Add imports:

```ts
import { useGetNudges, useGetBrainState, useGetMyStats, getGetNudgesQueryKey, BrainMode } from "@workspace/api-client-react";
import { isNavGroupVisible, isUnlocked } from "@/lib/feature-gates";
```

Inside `Layout`, replace the `useGetNudges` line and derive filtered lists (module-level `allNavItems`/`mobileNavItems` at lines 170–171 stay; filtering happens per-render because it depends on stats):

```ts
  const { data: gateStats } = useGetMyStats({ tz: browserTimeZone() });
  const unlocked = gateStats?.unlockedFeatures;
  const navItems = allNavItems.filter((i) => isNavGroupVisible(i.key, unlocked));
  const mobileItems = navItems.filter((i) => i.mobileShow);
  const alliesUnlocked = isUnlocked(unlocked, "allies");
  // No ally-nudge polling for a nav entry that doesn't exist yet. orval + TQ v5:
  // passing query options requires re-supplying the queryKey.
  const { data: navNudges } = useGetNudges({
    query: { enabled: alliesUnlocked, queryKey: getGetNudgesQueryKey() },
  });
```

Then switch the two render loops: sidebar `allNavItems.map` (~line 254) → `navItems.map`; bottom bar `mobileNavItems.map` (~line 321) → `mobileItems.map`.

- [ ] **Step 2: App.tsx route guards.** Add imports:

```ts
import { Redirect } from "wouter"; // already imported — verify
import { isUnlocked, type FeatureKey } from "@/lib/feature-gates";
```

Above `Router`, add the HOC + wrapped pages (module level, so component identity is stable across renders):

```tsx
// Gentle Door: locked pages are unreachable by URL too — quiet redirect home,
// no message (invisible, not scolded). Missing stats (offline) fails open.
function withGate<P extends object>(feature: FeatureKey, Page: React.ComponentType<P>) {
  return function GatedPage(props: P) {
    const { data: stats } = useGetMyStats({ tz: browserTimeZone() });
    if (stats && !isUnlocked(stats.unlockedFeatures, feature)) return <Redirect to="/" />;
    return <Page {...props} />;
  };
}

const FocusGated = withGate("focus", Focus);
const AvatarGated = withGate("hero", AvatarPage);
const ProgressGated = withGate("progress", Progress);
const InsightsGated = withGate("progress", Insights);
const PartnersGated = withGate("allies", Partners);
const PartnerDetailGated = withGate("allies", PartnerDetail);
const LeaderboardGated = withGate("allies", Leaderboard);
const RewardsTreatsGated = withGate("rewards", RewardsTreats);
const RewardsStoreGated = withGate("rewards", RewardsStore);
const RewardsPerksGated = withGate("rewards", RewardsPerks);
```

Swap the corresponding `component={…}` values in `Router` (e.g. `<Route path="/focus" component={FocusGated} />`, `<Route path="/partners/:id" component={PartnerDetailGated} />`, all three `/rewards/*` routes, etc.). `/`, `/tasks`, `/questlines*`, `/recurring`, `/reflection` stay unwrapped.

- [ ] **Step 3: coin-chip.tsx.** Read the file first (it's small). Gate render + query:

```tsx
import { useGetCoins, useGetMyStats, getGetCoinsQueryKey } from "@workspace/api-client-react";
import { browserTimeZone } from "@/lib/timezone";
import { isUnlocked } from "@/lib/feature-gates";

export function CoinChip() {
  const { data: stats } = useGetMyStats({ tz: browserTimeZone() });
  const rewardsUnlocked = isUnlocked(stats?.unlockedFeatures, "rewards");
  const { data } = useGetCoins({
    query: { enabled: rewardsUnlocked, queryKey: getGetCoinsQueryKey() },
  });
  // Coins EARN silently from L1 (server untouched); only the display waits for
  // the L6 reveal so the wallet is full when the door opens.
  if (!rewardsUnlocked) return null;
  // …existing render below, unchanged…
}
```

Keep the component's existing render body and any loading/null handling; only add the gate + `enabled`.

- [ ] **Step 4: avatar.tsx WorldBossPanel.** Add to the page component (it does not currently fetch stats):

```ts
import { useGetMyStats } from "@workspace/api-client-react";   // extend the existing import block
import { browserTimeZone } from "@/lib/timezone";
import { isUnlocked } from "@/lib/feature-gates";
```

In the component body: `const { data: gateStats } = useGetMyStats({ tz: browserTimeZone() });`
At ~line 844 replace `<WorldBossPanel />` with:

```tsx
              {/* World Boss is an allies-gate (L5) feature hosted on the hero page. */}
              {isUnlocked(gateStats?.unlockedFeatures, "allies") && <WorldBossPanel />}
```

- [ ] **Step 5: StatusRow link gate.** `status-row.tsx` becomes:

```tsx
// One quiet line where four stat cards used to be. Tap-through to /progress —
// unless Progress hasn't been unlocked yet, in which case it's plain text
// (no dead link, no tease).
import { Link } from "wouter";
import { Flame } from "lucide-react";
import { statusRowParts, type StatusRowStats } from "@/lib/status-row";

export function StatusRow({ stats, linkToProgress = true }: { stats: StatusRowStats; linkToProgress?: boolean }) {
  const parts = statusRowParts(stats);
  const inner = (
    <>
      {stats.streakDays > 0 && <Flame className="w-4 h-4 text-orange-400" aria-hidden />}
      <span>{parts.join(" · ")}</span>
    </>
  );
  const cls = "flex items-center gap-2 text-sm text-muted-foreground";
  if (!linkToProgress) return <div className={cls}>{inner}</div>;
  return (
    <Link href="/progress" className={`${cls} hover:text-foreground transition-colors`} aria-label="Open progress">
      {inner}
    </Link>
  );
}
```

In `now.tsx` (~line 170):

```tsx
      {stats && <StatusRow stats={stats} linkToProgress={isUnlocked(stats.unlockedFeatures, "progress")} />}
```

(add `import { isUnlocked } from "@/lib/feature-gates";` to now.tsx — Task 9 also imports `featureLabel` there, merge as needed).

- [ ] **Step 6: task-item.tsx gear-toast copy.** The component already calls `useGetMyStats` (line 4 import). Derive once near the other derived consts:

```ts
  const heroUnlocked = isUnlocked(statsData?.unlockedFeatures, "hero");
```

(match the actual stats variable name in the file — read it first). Then in the gear toast (~line 174):

```ts
              description: heroUnlocked
                ? `${res.gearReward.name} (${res.gearReward.rarity}) — equip it on your Hero page`
                : `${res.gearReward.name} (${res.gearReward.rarity}) joined your inventory`,
```

and the surprise-gear toast (~line 196):

```ts
                description: heroUnlocked
                  ? `A random ${g.rarity} item appeared — check your Hero page!`
                  : `A random ${g.rarity} item joined your inventory!`,
```

- [ ] **Step 7: Verify** — typecheck + client suite + the anti-shame grep:

```bash
pnpm typecheck
pnpm --filter @workspace/focusquest test
grep -ri "unlocks at\|unlock at level\|locked until" artifacts/focusquest/src && echo "ANTI-SHAME VIOLATION" || echo "clean"
```

Expected: typecheck + tests green; grep prints `clean`.

- [ ] **Step 8: Commit**

```bash
git add artifacts/focusquest/src/components/layout.tsx artifacts/focusquest/src/App.tsx artifacts/focusquest/src/components/coin-chip.tsx artifacts/focusquest/src/pages/avatar.tsx artifacts/focusquest/src/components/status-row.tsx artifacts/focusquest/src/pages/now.tsx artifacts/focusquest/src/components/task-item.tsx
git commit -m "feat(web): gentle-door surfaces — nav filtering, route guards, coin chip/boss panel/status-link/gear-toast gates

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Celebration line, onboarding copy, rename UI

**Files:**
- Modify: `artifacts/focusquest/src/pages/now.tsx` (level-up dialog ~line 293)
- Modify: `artifacts/focusquest/src/pages/questline-detail.tsx` (~line 62)
- Modify: `artifacts/focusquest/src/App.tsx` (OnboardingScreen copy line 94 + move regex)
- Create: `artifacts/focusquest/src/lib/username.ts`
- Create: `artifacts/focusquest/src/components/hero-identity.tsx`
- Modify: `artifacts/focusquest/src/pages/avatar.tsx` (mount HeroIdentity near the top of the page content)

**Interfaces:**
- Consumes: Task 7 `featureLabel`; Task 4 generated `useGetMe`, `useUpdateMe`, `getGetMeQueryKey`, `User.renameAvailableAt`, `TaskCompletionResult.newlyUnlocked`, `QuestlineClaimResult.newlyUnlocked`.
- Produces: `USERNAME_REGEX` + `heroNameError(name: string): string | null` in `lib/username.ts` (OnboardingScreen and HeroIdentity both consume).

- [ ] **Step 1: `lib/username.ts`** (move the regex out of App.tsx):

```ts
// Shared hero-name rules — OnboardingScreen and the Hero-page rename dialog
// must agree with the server's rename.ts.
export const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

export function heroNameError(name: string): string | null {
  const trimmed = name.trim();
  if (USERNAME_REGEX.test(trimmed)) return null;
  if (trimmed.length < 3) return "Hero name must be at least 3 characters.";
  if (trimmed.length > 20) return "Hero name must be 20 characters or fewer.";
  return "Only letters, numbers, and underscores allowed.";
}
```

In `App.tsx`: delete the local `const USERNAME_REGEX = …` (line 40), import `{ USERNAME_REGEX, heroNameError }` from `@/lib/username`, and in `handleSubmit` replace the three-branch ternary with `setValidationError(heroNameError(heroName));` + early return when non-null (keep behavior identical otherwise).

- [ ] **Step 2: Onboarding copy.** `App.tsx` line 93–95 becomes:

```tsx
        <p className="mb-8 text-sm text-muted-foreground">
          This is the name other players will see. You can change it later.
        </p>
```

- [ ] **Step 3: Level-up dialog "Unlocked" section.** In `now.tsx`, import `featureLabel` from `@/lib/feature-gates`. After the `<p className="text-muted-foreground">{levelUpData?.levelName …}</p>` line (~line 296), add:

```tsx
            {(levelUpData?.newlyUnlocked?.length ?? 0) > 0 && (
              <div className="mt-6">
                <h4 className="text-xs font-bold uppercase tracking-wider text-primary mb-3">Unlocked</h4>
                <div className="flex justify-center gap-3 flex-wrap">
                  {levelUpData.newlyUnlocked.map((k: string) => (
                    <div key={k} className="px-4 py-2 bg-primary/10 border border-primary/40 rounded-lg text-sm font-bold text-primary">
                      {featureLabel(k)}
                    </div>
                  ))}
                </div>
              </div>
            )}
```

- [ ] **Step 4: Questline claim toast.** `questline-detail.tsx` ~line 62:

```ts
          description: res.leveledUp
            ? `Level up! You're now ${res.levelName}.${
                res.newlyUnlocked.length > 0
                  ? ` ${res.newlyUnlocked.map(featureLabel).join(" & ")} unlocked!`
                  : ""
              }`
            : undefined,
```

(import `featureLabel` from `@/lib/feature-gates`).

- [ ] **Step 5: `components/hero-identity.tsx`** — identity row + rename dialog:

```tsx
// Gentle Door: the hero's name with a quiet rename affordance. Cooldown state
// comes from GET /users/me (renameAvailableAt) so the dialog can say when the
// door reopens without ever surfacing an error wall.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMe, useUpdateMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { heroNameError } from "@/lib/username";

export function HeroIdentity() {
  const { data: me } = useGetMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const updateMe = useUpdateMe();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!me) return null;

  const cooldownUntil = me.renameAvailableAt ? new Date(me.renameAvailableAt) : null;
  const onCooldown = cooldownUntil !== null && cooldownUntil.getTime() > Date.now();

  const openDialog = () => {
    setName(me.username);
    setError(null);
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed === me.username) { setOpen(false); return; }
    const msg = heroNameError(trimmed);
    if (msg) { setError(msg); return; }
    try {
      await updateMe.mutateAsync({ data: { username: trimmed } });
      await qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
      setOpen(false);
      toast({ title: `You are now ${trimmed}!`, className: "border-primary" });
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : "";
      setError(
        text.includes("409") || text.includes("taken")
          ? "That hero name is already taken. Try another."
          : text.includes("429") || text.includes("once a week")
          ? "Renamed recently — you can rename again soon."
          : "Something went wrong. Please try again.",
      );
    }
  };

  return (
    <div className="flex items-center gap-2">
      <h2 className="text-lg font-bold text-foreground">{me.username}</h2>
      <Button variant="ghost" size="icon" aria-label="Rename hero" className="text-muted-foreground h-7 w-7" onClick={openDialog}>
        <Pencil className="w-3.5 h-3.5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm bg-card border-primary/30">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-primary">Rename your hero</DialogTitle>
          </DialogHeader>
          {onCooldown ? (
            <p className="text-sm text-muted-foreground py-2">
              You can rename again on {cooldownUntil!.toLocaleDateString(undefined, { month: "long", day: "numeric" })}.
            </p>
          ) : (
            <form onSubmit={submit} className="space-y-3 mt-2">
              <Input value={name} onChange={(e) => { setName(e.target.value); setError(null); }} maxLength={20} autoFocus />
              <p className="text-xs text-muted-foreground">3–20 characters, letters, numbers, and underscores. You can rename once a week.</p>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={updateMe.isPending || name.trim().length === 0}>
                  {updateMe.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

Before writing, verify the generated hook names (`useGetMe`, `getGetMeQueryKey`) in `lib/api-client-react/src/generated/api.ts` (operationId is `getMe`); adjust if orval named them differently.

- [ ] **Step 6: Mount it** in `avatar.tsx` — at the top of the page's main content column, above the PixelHero/customization block (read the render to pick the exact spot; it should sit as the page's first heading row):

```tsx
        <HeroIdentity />
```

(import `{ HeroIdentity } from "@/components/hero-identity";`).

- [ ] **Step 7: Verify**

```bash
pnpm typecheck
pnpm --filter @workspace/focusquest test
grep -n "can't change it later" artifacts/focusquest/src/App.tsx || echo "copy gone"
```

Expected: green; `copy gone`.

- [ ] **Step 8: Commit**

```bash
git add artifacts/focusquest/src/lib/username.ts artifacts/focusquest/src/components/hero-identity.tsx artifacts/focusquest/src/pages/now.tsx artifacts/focusquest/src/pages/questline-detail.tsx artifacts/focusquest/src/pages/avatar.tsx artifacts/focusquest/src/App.tsx
git commit -m "feat(web): unlock celebration line, onboarding copy softened, hero rename UI

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Full verification, live migration, PR

**Files:** none new (verification + ops).

- [ ] **Step 1: Full gates**

```bash
pnpm typecheck
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/focusquest test
pnpm --filter @workspace/quick-add test
pnpm build
```

Expected: all green. Fix anything red before proceeding (systematic-debugging if non-obvious).

- [ ] **Step 2: Apply migration to live Neon** (Chad's standing instruction: apply schema myself; shared-DB check: nothing unmerged is live):

```bash
cd "C:/Users/Chadr/OneDrive/Documents/Quest-Companion"
export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\r')"
pnpm --filter @workspace/db migrate
```

Expected: applies `0003_gentle_door`, exits 0. Existing rows now carry `unlock_all = true` (grandfathered).

- [ ] **Step 3: Push + PR**

```bash
git push -u origin feat/gentle-door
"/c/Program Files/GitHub CLI/gh.exe" pr create --base main --head feat/gentle-door --title "feat(act7): The Gentle Door — progressive unlock + hero rename (quest 5)" --body "<summary per PR conventions; reference spec PR #75; list acceptance evidence>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: Report** — suite counts, migration output, PR URL, acceptance-item mapping.
