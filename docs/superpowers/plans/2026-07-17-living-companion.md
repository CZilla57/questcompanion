# Living Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the hero a reactive "living companion" layer — it responds to streaks, rest days, and returns after absence, and carries a light persisted bond that only ever grows — layered on the shipped hero-care base.

**Architecture:** Two new pure libs (`companion.ts`, `companion-copy.ts`) mirror the existing `hero-care.ts`/`hero-flavor.ts` pattern: a derived "beat" engine + deterministic curated copy, zero LLM, zero stored beat state. Ambient beats surface in `GET /users/me/hero-status`; "just-happened" reactions (bond-tier-up / level-up) ride `TaskCompletionResult`; streak-milestone celebration pushes fold into the existing `checkHeroCare` cron pass (mutually exclusive with hunger/flavor). Two new `users` columns: `bondQuestsCompleted` (monotonic) and `companionMilestoneNotified` (push dedup).

**Tech Stack:** TypeScript, Express (`artifacts/api-server`), Drizzle ORM + Neon Postgres (`lib/db`), OpenAPI + orval codegen (`lib/api-spec` → `lib/api-client-react`/`lib/api-zod`), React + TanStack Query (`artifacts/focusquest`), Vitest.

## Global Constraints

- **Anti-Shame Design law:** rest reads as rest (never failure); returns are warm (never a red missed-day wall); the bond never decreases (not on un-complete, not on delete). Every copy line and every state transition must honor this.
- **Pattern fidelity:** new pure libs mirror `hero-care.ts`/`hero-flavor.ts` exactly — deterministic `hashSeed`-seeded picks, no stored derived state, no LLM.
- **Copy engine is curated + deterministic.** No LLM in v1.
- **Pushes:** streak-milestone celebration only. No absence/welcome-back push (hunger already nudges absence). A companion push never shares a cron tick with a hunger/flavor push.
- **Never hand-edit** files under `*/src/generated` — regenerate via codegen.
- **Tests:** `pnpm --filter @workspace/api-server test` (Vitest). Filter one file with `... test -- <name>`.
- **Typecheck gate:** `pnpm typecheck` (root). CRLF warnings on commit are harmless.
- **Bond tiers (verbatim):** 0–9 Newly Met · 10–49 Trusted · 50–149 Steadfast · 150–399 Kindred · 400+ Legendary Bond.
- **Streak milestones (verbatim):** `[3, 7, 14, 30, 50, 100, 200, 365]`.
- **Gap thresholds (verbatim):** gap `1–2` days ⇒ `rest_day`; gap `≥3` ⇒ `welcome_back`.

## File Structure

- Create `artifacts/api-server/src/lib/companion.ts` — `bondTier`, `dayGap`, `deriveCompanionBeat`, `companionMilestonePush`, `completionCompanionReaction`, constants, types.
- Create `artifacts/api-server/src/lib/companion.test.ts` — unit tests for the above.
- Create `artifacts/api-server/src/lib/companion-copy.ts` — curated line pools + `companionLine`, `companionReactionLine`.
- Create `artifacts/api-server/src/lib/companion-copy.test.ts` — determinism + anti-shame snapshot tests.
- Modify `lib/db/src/schema/users.ts` — 2 new columns.
- Modify `lib/api-spec/openapi.yaml` — extend `HeroStatus` + `TaskCompletionResult`; regenerate clients.
- Modify `artifacts/api-server/src/routes/users.ts` — companion block in `hero-status`.
- Modify `artifacts/api-server/src/routes/tasks.ts` — bond increment + `companionReaction` in the completion transaction.
- Modify `artifacts/api-server/src/lib/notification-scheduler.ts` — companion milestone push in `checkHeroCare`.
- Modify `artifacts/focusquest/src/components/hero-vitality.tsx` — render companion line + bond tier.
- Modify `artifacts/focusquest/src/components/task-item.tsx` — `companionReaction` toast.

---

### Task 1: Companion foundations — `bondTier`, `dayGap`, constants

**Files:**
- Create: `artifacts/api-server/src/lib/companion.ts`
- Test: `artifacts/api-server/src/lib/companion.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `STREAK_MILESTONES: readonly number[]` = `[3,7,14,30,50,100,200,365]`
  - `bondTier(bondQuestsCompleted: number): { tier: number; name: string; minQuests: number }`
  - `dayGap(fromDateKey: string | null, toDateKey: string): number | null` — whole-day count `toDateKey - fromDateKey`; `null` when `fromDateKey` is null.

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/companion.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { bondTier, dayGap, STREAK_MILESTONES } from "./companion";

describe("bondTier", () => {
  it("maps lifetime completions to the 5 named tiers", () => {
    expect(bondTier(0)).toMatchObject({ tier: 0, name: "Newly Met" });
    expect(bondTier(9)).toMatchObject({ tier: 0, name: "Newly Met" });
    expect(bondTier(10)).toMatchObject({ tier: 1, name: "Trusted" });
    expect(bondTier(49)).toMatchObject({ tier: 1, name: "Trusted" });
    expect(bondTier(50)).toMatchObject({ tier: 2, name: "Steadfast" });
    expect(bondTier(149)).toMatchObject({ tier: 2, name: "Steadfast" });
    expect(bondTier(150)).toMatchObject({ tier: 3, name: "Kindred" });
    expect(bondTier(399)).toMatchObject({ tier: 3, name: "Kindred" });
    expect(bondTier(400)).toMatchObject({ tier: 4, name: "Legendary Bond" });
    expect(bondTier(99999)).toMatchObject({ tier: 4, name: "Legendary Bond" });
  });
});

describe("dayGap", () => {
  it("returns null for a user who has never been active", () => {
    expect(dayGap(null, "2026-07-17")).toBeNull();
  });
  it("counts whole calendar days between two date keys", () => {
    expect(dayGap("2026-07-17", "2026-07-17")).toBe(0);
    expect(dayGap("2026-07-16", "2026-07-17")).toBe(1);
    expect(dayGap("2026-07-15", "2026-07-17")).toBe(2);
    expect(dayGap("2026-07-10", "2026-07-17")).toBe(7);
  });
  it("spans month boundaries correctly", () => {
    expect(dayGap("2026-06-30", "2026-07-02")).toBe(2);
  });
});

describe("STREAK_MILESTONES", () => {
  it("is the agreed ladder", () => {
    expect([...STREAK_MILESTONES]).toEqual([3, 7, 14, 30, 50, 100, 200, 365]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- companion`
Expected: FAIL — cannot find module `./companion`.

- [ ] **Step 3: Write minimal implementation**

Create `artifacts/api-server/src/lib/companion.ts`:

```ts
// Living Companion: a reactive layer over hero-care. Like hunger, the companion's
// "beat" is derived at read time and never stored. The only persisted state is the
// monotonic bond (users.bondQuestsCompleted) and a streak-push dedup marker.

export const STREAK_MILESTONES: readonly number[] = [3, 7, 14, 30, 50, 100, 200, 365];

// Gap (in whole local days since last active) that reads as an honored rest vs a
// return-from-absence. gap 1–2 ⇒ rest_day; gap ≥ ABSENCE_MIN_DAYS ⇒ welcome_back.
export const ABSENCE_MIN_DAYS = 3;

export type BondTierInfo = { tier: number; name: string; minQuests: number };

const BOND_TIERS: BondTierInfo[] = [
  { tier: 4, name: "Legendary Bond", minQuests: 400 },
  { tier: 3, name: "Kindred", minQuests: 150 },
  { tier: 2, name: "Steadfast", minQuests: 50 },
  { tier: 1, name: "Trusted", minQuests: 10 },
  { tier: 0, name: "Newly Met", minQuests: 0 },
];

export function bondTier(bondQuestsCompleted: number): BondTierInfo {
  for (const t of BOND_TIERS) {
    if (bondQuestsCompleted >= t.minQuests) return t;
  }
  return BOND_TIERS[BOND_TIERS.length - 1]!;
}

/**
 * Whole-day difference (toDateKey - fromDateKey) between two YYYY-MM-DD keys, using
 * a UTC anchor of each local date so DST can't shift the count (same technique as
 * date-buckets.buildDayDates). Null when the user has never been active.
 */
export function dayGap(fromDateKey: string | null, toDateKey: string): number | null {
  if (!fromDateKey) return null;
  const from = new Date(fromDateKey + "T00:00:00Z").getTime();
  const to = new Date(toDateKey + "T00:00:00Z").getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server test -- companion`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/companion.ts artifacts/api-server/src/lib/companion.test.ts
git commit -m "feat(companion): bond tiers, day-gap helper, milestone constants"
```

---

### Task 2: `deriveCompanionBeat` — the precedence engine

**Files:**
- Modify: `artifacts/api-server/src/lib/companion.ts`
- Test: `artifacts/api-server/src/lib/companion.test.ts`

**Interfaces:**
- Consumes: `ABSENCE_MIN_DAYS`, `STREAK_MILESTONES` (Task 1); `HungerStage` from `./hero-care`.
- Produces:
  - `type CompanionBeatKind = "welcome_back" | "streak_milestone" | "rest_day" | "ambient" | "quiet"`
  - `type CompanionBeat = { kind: CompanionBeatKind; streakDays: number; bondTier: number }`
  - `deriveCompanionBeat(ctx: { streakDays: number; dayGap: number | null; hungerStage: HungerStage; bondTier: number }): CompanionBeat`

- [ ] **Step 1: Write the failing test**

Append to `artifacts/api-server/src/lib/companion.test.ts`:

```ts
import { deriveCompanionBeat } from "./companion";

describe("deriveCompanionBeat", () => {
  const base = { streakDays: 0, dayGap: 0 as number | null, hungerStage: "well_fed" as const, bondTier: 0 };

  it("welcome_back wins when the gap is >= 3 days, even over a milestone", () => {
    const beat = deriveCompanionBeat({ ...base, dayGap: 5, streakDays: 7 });
    expect(beat.kind).toBe("welcome_back");
  });
  it("welcome_back shows even when the hero is fainted (stays warm)", () => {
    expect(deriveCompanionBeat({ ...base, dayGap: 9, hungerStage: "fainted" }).kind).toBe("welcome_back");
  });
  it("streak_milestone fires on a milestone day (gap 0)", () => {
    for (const n of [3, 7, 14, 30, 50, 100, 200, 365]) {
      expect(deriveCompanionBeat({ ...base, streakDays: n }).kind).toBe("streak_milestone");
    }
  });
  it("non-milestone streak with no gap is ambient", () => {
    expect(deriveCompanionBeat({ ...base, streakDays: 8 }).kind).toBe("ambient");
  });
  it("rest_day for a 1-2 day gap when not a milestone", () => {
    expect(deriveCompanionBeat({ ...base, dayGap: 1 }).kind).toBe("rest_day");
    expect(deriveCompanionBeat({ ...base, dayGap: 2 }).kind).toBe("rest_day");
  });
  it("ambient yields to hunger (quiet) when starving or fainted", () => {
    expect(deriveCompanionBeat({ ...base, hungerStage: "starving" }).kind).toBe("quiet");
    expect(deriveCompanionBeat({ ...base, hungerStage: "fainted" }).kind).toBe("quiet");
  });
  it("null gap (brand-new user) with no milestone is ambient", () => {
    expect(deriveCompanionBeat({ ...base, dayGap: null }).kind).toBe("ambient");
  });
  it("carries streakDays and bondTier through", () => {
    const beat = deriveCompanionBeat({ ...base, streakDays: 7, bondTier: 3 });
    expect(beat).toMatchObject({ streakDays: 7, bondTier: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- companion`
Expected: FAIL — `deriveCompanionBeat` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `artifacts/api-server/src/lib/companion.ts`:

```ts
import type { HungerStage } from "./hero-care";

export type CompanionBeatKind = "welcome_back" | "streak_milestone" | "rest_day" | "ambient" | "quiet";

export type CompanionBeat = { kind: CompanionBeatKind; streakDays: number; bondTier: number };

/**
 * The single most-salient relational beat, derived from current state.
 * Precedence: welcome_back → streak_milestone → rest_day → ambient. `ambient`
 * yields to hunger (→ `quiet`, companion says nothing) when the hero is
 * starving/fainted; welcome_back/milestone/rest are never hunger-gated.
 */
export function deriveCompanionBeat(ctx: {
  streakDays: number;
  dayGap: number | null;
  hungerStage: HungerStage;
  bondTier: number;
}): CompanionBeat {
  const carry = { streakDays: ctx.streakDays, bondTier: ctx.bondTier };
  if (ctx.dayGap !== null && ctx.dayGap >= ABSENCE_MIN_DAYS) {
    return { kind: "welcome_back", ...carry };
  }
  if (STREAK_MILESTONES.includes(ctx.streakDays)) {
    return { kind: "streak_milestone", ...carry };
  }
  if (ctx.dayGap !== null && ctx.dayGap >= 1 && ctx.dayGap < ABSENCE_MIN_DAYS) {
    return { kind: "rest_day", ...carry };
  }
  if (ctx.hungerStage === "starving" || ctx.hungerStage === "fainted") {
    return { kind: "quiet", ...carry };
  }
  return { kind: "ambient", ...carry };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server test -- companion`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/companion.ts artifacts/api-server/src/lib/companion.test.ts
git commit -m "feat(companion): derive the most-salient reaction beat"
```

---

### Task 3: Curated copy — `companionLine` + `companionReactionLine`

**Files:**
- Create: `artifacts/api-server/src/lib/companion-copy.ts`
- Test: `artifacts/api-server/src/lib/companion-copy.test.ts`

**Interfaces:**
- Consumes: `hashSeed` from `./hero-care`; `CompanionBeat` from `./companion`.
- Produces:
  - `companionLine(beat: CompanionBeat, args: { userId: number; now: Date }): string` — deterministic pick; `""` for `quiet`.
  - `companionReactionLine(kind: "bond_tier_up" | "leveled_up", args: { userId: number; now: Date; bondTierName?: string; newLevel?: number }): string`

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/companion-copy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { companionLine, companionReactionLine } from "./companion-copy";
import type { CompanionBeat } from "./companion";

const now = new Date("2026-07-17T12:00:00Z");
const beat = (kind: CompanionBeat["kind"], over: Partial<CompanionBeat> = {}): CompanionBeat =>
  ({ kind, streakDays: 0, bondTier: 0, ...over });

describe("companionLine", () => {
  it("returns an empty string for quiet (defers to hunger)", () => {
    expect(companionLine(beat("quiet"), { userId: 1, now })).toBe("");
  });
  it("returns a non-empty line for every visible beat", () => {
    for (const k of ["welcome_back", "streak_milestone", "rest_day", "ambient"] as const) {
      expect(companionLine(beat(k, { streakDays: 7, bondTier: 2 }), { userId: 1, now }).length).toBeGreaterThan(0);
    }
  });
  it("interpolates the streak count into a milestone line", () => {
    const line = companionLine(beat("streak_milestone", { streakDays: 30 }), { userId: 1, now });
    expect(line).toContain("30");
  });
  it("is deterministic for the same user + 3h bucket", () => {
    const a = companionLine(beat("ambient", { bondTier: 1 }), { userId: 42, now });
    const b = companionLine(beat("ambient", { bondTier: 1 }), { userId: 42, now });
    expect(a).toBe(b);
  });
  it("welcome_back copy is warm — never guilt/shame language", () => {
    // Sample across users to cover the whole pool.
    for (let u = 0; u < 20; u++) {
      const line = companionLine(beat("welcome_back"), { userId: u, now }).toLowerCase();
      expect(line).not.toMatch(/miss(ed)? \d|fail|behind|lost your|broke|guilt|should have/);
    }
  });
});

describe("companionReactionLine", () => {
  it("names the new tier on a bond tier-up", () => {
    expect(companionReactionLine("bond_tier_up", { userId: 1, now, bondTierName: "Kindred" }))
      .toContain("Kindred");
  });
  it("names the new level on a level-up", () => {
    expect(companionReactionLine("leveled_up", { userId: 1, now, newLevel: 12 })).toContain("12");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- companion-copy`
Expected: FAIL — cannot find module `./companion-copy`.

- [ ] **Step 3: Write minimal implementation**

Create `artifacts/api-server/src/lib/companion-copy.ts`:

```ts
// Curated companion voice. Deterministic, anti-shame by construction: rest reads
// as rest, returns are warm, never a word of guilt. Picked from (userId, 3h bucket)
// like hero-flavor vignettes — stable within a bucket, rotates on its own.
import { hashSeed } from "./hero-care";
import type { CompanionBeat } from "./companion";

const BUCKET_MS = 3 * 60 * 60 * 1000;

const WELCOME_BACK = [
  "There you are — I kept the campfire warm. 🔥",
  "Welcome back, friend. Ready when you are, no rush.",
  "Good to see you again. Let's pick up right where we left off.",
  "You're back! I saved the good stories for you.",
];

const REST_DAY = [
  "Resting up? Smart — even heroes need a quiet day.",
  "A well-earned breather. I'll be right here when you're ready.",
  "Taking it easy today. That's part of the journey too.",
];

const STREAK_MILESTONE = [
  "{n} days running — proud to adventure with you! 🔥",
  "{n}-day streak! We're unstoppable lately.",
  "That's {n} days in a row. Look at us go!",
];

// Ambient greeting warms with the bond tier (index = tier 0..4).
const AMBIENT_BY_TIER: string[][] = [
  ["Glad to be adventuring with you.", "Off to a good start, you and I."],
  ["Always good to have you around.", "You and me — a solid team."],
  ["We've been through a lot together, haven't we?", "Steady as ever, my friend."],
  ["Kindred spirits, you and I.", "I'd follow you on any quest."],
  ["Legends are written by pairs like us.", "After all this, we're the stuff of stories."],
];

function pick(pool: string[], userId: number, now: Date, salt: string): string {
  const bucket = Math.floor(now.getTime() / BUCKET_MS);
  return pool[hashSeed(`${userId}:${bucket}:${salt}`) % pool.length]!;
}

export function companionLine(beat: CompanionBeat, args: { userId: number; now: Date }): string {
  switch (beat.kind) {
    case "quiet":
      return "";
    case "welcome_back":
      return pick(WELCOME_BACK, args.userId, args.now, "welcome_back");
    case "rest_day":
      return pick(REST_DAY, args.userId, args.now, "rest_day");
    case "streak_milestone":
      return pick(STREAK_MILESTONE, args.userId, args.now, "streak").replace("{n}", String(beat.streakDays));
    case "ambient": {
      const tier = Math.min(Math.max(beat.bondTier, 0), AMBIENT_BY_TIER.length - 1);
      return pick(AMBIENT_BY_TIER[tier]!, args.userId, args.now, `ambient:${tier}`);
    }
  }
}

const BOND_TIER_UP = [
  "Our bond deepens — we're {tier} now. ❤️",
  "{tier}. After everything, that feels right.",
];
const LEVELED_UP = [
  "Level {n}! I always knew you had it in you.",
  "Level {n} — onward, together!",
];

export function companionReactionLine(
  kind: "bond_tier_up" | "leveled_up",
  args: { userId: number; now: Date; bondTierName?: string; newLevel?: number },
): string {
  if (kind === "bond_tier_up") {
    return pick(BOND_TIER_UP, args.userId, args.now, "tierup").replace("{tier}", args.bondTierName ?? "closer");
  }
  return pick(LEVELED_UP, args.userId, args.now, "levelup").replace("{n}", String(args.newLevel ?? ""));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server test -- companion-copy`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/companion-copy.ts artifacts/api-server/src/lib/companion-copy.test.ts
git commit -m "feat(companion): curated anti-shame companion copy"
```

---

### Task 4: `companionMilestonePush` + `completionCompanionReaction`

**Files:**
- Modify: `artifacts/api-server/src/lib/companion.ts`
- Test: `artifacts/api-server/src/lib/companion.test.ts`

**Interfaces:**
- Consumes: `STREAK_MILESTONES`, `bondTier` (Task 1); `companionReactionLine` from `./companion-copy` (Task 3).
- Produces:
  - `companionMilestonePush(streakDays: number, notifiedMilestone: string | null): { push: { title: string; body: string; tag: string } | null; marker: string | null }`
  - `completionCompanionReaction(args: { bondBefore: number; leveledUp: boolean; newLevel: number; userId: number; now: Date }): string | null`

- [ ] **Step 1: Write the failing test**

Append to `artifacts/api-server/src/lib/companion.test.ts`:

```ts
import { companionMilestonePush, completionCompanionReaction } from "./companion";

describe("companionMilestonePush", () => {
  it("pushes once when a milestone is freshly reached, setting the marker", () => {
    const r = companionMilestonePush(7, null);
    expect(r.push).not.toBeNull();
    expect(r.push!.tag).toBe("companion");
    expect(r.push!.body).toContain("7");
    expect(r.marker).toBe("7");
  });
  it("does not re-push the same milestone", () => {
    const r = companionMilestonePush(7, "7");
    expect(r.push).toBeNull();
    expect(r.marker).toBe("7"); // unchanged
  });
  it("is silent on a non-milestone day and leaves the marker unchanged", () => {
    const r = companionMilestonePush(8, "7");
    expect(r.push).toBeNull();
    expect(r.marker).toBe("7");
  });
  it("clears the marker when the streak breaks (below the lowest milestone)", () => {
    const r = companionMilestonePush(0, "7");
    expect(r.push).toBeNull();
    expect(r.marker).toBeNull();
  });
  it("re-celebrates a rebuilt streak after a break cleared the marker", () => {
    expect(companionMilestonePush(3, null).push).not.toBeNull();
  });
});

describe("completionCompanionReaction", () => {
  const base = { userId: 1, now: new Date("2026-07-17T12:00:00Z"), newLevel: 5, leveledUp: false };
  it("returns a tier-up line when the completion crosses a bond threshold", () => {
    // 9 -> 10 crosses Newly Met -> Trusted
    expect(completionCompanionReaction({ ...base, bondBefore: 9 })).toContain("Trusted");
  });
  it("returns a level-up line when leveled up without a tier crossing", () => {
    const line = completionCompanionReaction({ ...base, bondBefore: 20, leveledUp: true, newLevel: 6 });
    expect(line).toContain("6");
  });
  it("prefers tier-up over level-up when both happen", () => {
    expect(completionCompanionReaction({ ...base, bondBefore: 49, leveledUp: true }))
      .toContain("Steadfast"); // 49 -> 50
  });
  it("returns null when nothing notable happened", () => {
    expect(completionCompanionReaction({ ...base, bondBefore: 20 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- companion`
Expected: FAIL — the two functions are not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `artifacts/api-server/src/lib/companion.ts`:

```ts
import { companionReactionLine } from "./companion-copy";

/**
 * Streak-milestone celebration push (positive) with its dedup marker. `marker` is
 * the value the caller should persist to users.companionMilestoneNotified: the hit
 * milestone when pushing, null when the streak has broken (so a rebuilt streak can
 * celebrate again), otherwise the unchanged prior value.
 */
export function companionMilestonePush(
  streakDays: number,
  notifiedMilestone: string | null,
): { push: { title: string; body: string; tag: string } | null; marker: string | null } {
  const isMilestone = STREAK_MILESTONES.includes(streakDays);
  if (isMilestone && notifiedMilestone !== String(streakDays)) {
    return {
      push: {
        title: `${streakDays}-day streak! 🔥`,
        body: `Your companion is cheering — ${streakDays} days adventuring together.`,
        tag: "companion",
      },
      marker: String(streakDays),
    };
  }
  // Streak broke: clear the marker so the next run at this milestone celebrates again.
  if (streakDays < STREAK_MILESTONES[0]!) return { push: null, marker: null };
  return { push: null, marker: notifiedMilestone };
}

/**
 * The companion's line for a "just happened" completion moment, or null. Precedence:
 * a bond tier crossing (bondBefore → bondBefore+1) beats a level-up.
 */
export function completionCompanionReaction(args: {
  bondBefore: number;
  leveledUp: boolean;
  newLevel: number;
  userId: number;
  now: Date;
}): string | null {
  const after = bondTier(args.bondBefore + 1);
  if (after.tier > bondTier(args.bondBefore).tier) {
    return companionReactionLine("bond_tier_up", { userId: args.userId, now: args.now, bondTierName: after.name });
  }
  if (args.leveledUp) {
    return companionReactionLine("leveled_up", { userId: args.userId, now: args.now, newLevel: args.newLevel });
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server test -- companion`
Expected: PASS (both `companion` and `companion-copy` suites green).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/companion.ts artifacts/api-server/src/lib/companion.test.ts
git commit -m "feat(companion): streak-milestone push + completion reaction helpers"
```

---

### Task 5: Schema — add `bondQuestsCompleted` + `companionMilestoneNotified`

**Files:**
- Modify: `lib/db/src/schema/users.ts` (after `hungerNotifiedStage` / `lastFlavorPushAt`, ~line 30)

**Interfaces:**
- Consumes: nothing.
- Produces: `usersTable.bondQuestsCompleted` (int, not null, default 0); `usersTable.companionMilestoneNotified` (text, nullable). Both flow into `User` via `$inferSelect`.

- [ ] **Step 1: Add the columns**

In `lib/db/src/schema/users.ts`, immediately after the line `lastFlavorPushAt: timestamp("last_flavor_push_at"),`:

```ts
  // Act VI Living Companion: monotonic bond metric (lifetime quest completions).
  // Incremented in the completion transaction; NEVER decremented (anti-shame).
  bondQuestsCompleted: integer("bond_quests_completed").notNull().default(0),
  // Streak-milestone celebration push dedup marker (last milestone value pushed,
  // e.g. "7"); cleared when the streak breaks. Mirrors hungerNotifiedStage.
  companionMilestoneNotified: text("companion_milestone_notified"),
```

(`integer` and `text` are already imported at the top of the file.)

- [ ] **Step 2: Typecheck the db package**

Run: `pnpm --filter @workspace/db typecheck` (or `pnpm typecheck`)
Expected: PASS.

- [ ] **Step 3: Push the schema to Neon**

From the repo root (Bash), export the URL the drizzle config needs but doesn't load, then push:

```bash
export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"
pnpm --filter @workspace/db push
```

Expected: `[✓] Changes applied` — both are additive columns (a `not null default 0` int and a nullable text), so no destructive/interactive prompt. (Shared Neon DB across branches — see reference-shared-live-db-branches; these columns are additive and safe.)

- [ ] **Step 4: Commit**

```bash
git add lib/db/src/schema/users.ts
git commit -m "feat(db): companion bond + milestone-dedup columns on users"
```

---

### Task 6: OpenAPI + codegen — extend `HeroStatus` and `TaskCompletionResult`

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (`HeroStatus` ~2343, `TaskCompletionResult` ~2599)

**Interfaces:**
- Consumes: nothing.
- Produces (in regenerated `@workspace/api-client-react` + `@workspace/api-zod`):
  - `HeroStatus.companion: { beat: string; line: string; bondTier: number; bondTierName: string; bondQuestsCompleted: number }`
  - `TaskCompletionResult.companionReaction?: string | null`

- [ ] **Step 1: Extend `HeroStatus`**

In `lib/api-spec/openapi.yaml`, change the `HeroStatus` `required` line to include `companion`:

```yaml
      required: [stage, mood, lastFedAt, activity, companion]
```

Then add, after the `activity` property block (keep indentation aligned with `activity:`):

```yaml
        companion:
          type: object
          required: [beat, line, bondTier, bondTierName, bondQuestsCompleted]
          description: Living Companion reaction (Act VI) — derived relational beat + bond
          properties:
            beat:
              type: string
              enum: [welcome_back, streak_milestone, rest_day, ambient, quiet]
            line:
              type: string
              description: Curated companion line; empty when beat is "quiet"
            bondTier:
              type: integer
            bondTierName:
              type: string
            bondQuestsCompleted:
              type: integer
```

- [ ] **Step 2: Extend `TaskCompletionResult`**

In the `TaskCompletionResult` schema, after the `heroRevived` property block, add:

```yaml
        companionReaction:
          oneOf:
            - type: string
            - type: "null"
          description: Companion's line for a just-happened bond tier-up or level-up, else null
```

(Leave `required` unchanged — `companionReaction` is optional/nullable.)

- [ ] **Step 3: Regenerate clients**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: orval rewrites `lib/api-client-react` + `lib/api-zod`; no errors.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no consumers broken; new fields are additive).

- [ ] **Step 5: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react lib/api-zod
git commit -m "feat(api-spec): companion block on hero-status + completion reaction"
```

---

### Task 7: Wire the companion block into `GET /users/me/hero-status`

**Files:**
- Modify: `artifacts/api-server/src/routes/users.ts` (handler ~142–159; imports ~7–8)

**Interfaces:**
- Consumes: `bondTier`, `dayGap`, `deriveCompanionBeat` (Tasks 1–2); `companionLine` (Task 3); `resolveTimeZone`, `localDateKey` from `./date-buckets`; `usersTable.bondQuestsCompleted` (Task 5).
- Produces: `hero-status` response now includes the `companion` object matching the OpenAPI schema.

- [ ] **Step 1: Add imports**

At the top of `artifacts/api-server/src/routes/users.ts`, alongside the existing hero-care imports:

```ts
import { bondTier, dayGap, deriveCompanionBeat } from "../lib/companion";
import { companionLine } from "../lib/companion-copy";
```

Confirm `resolveTimeZone` and `localDateKey` are already imported from `../lib/date-buckets` in this file (the `xp-history` handler uses `resolveTimeZone`/`buildDaySlots`); if `localDateKey` is missing from that import, add it.

- [ ] **Step 2: Build and return the companion block**

Replace the body of the `hero-status` handler (from `const now = new Date();` through the `res.json({...})`) with:

```ts
  const now = new Date();
  const stage = hungerStage(user.lastFedAt, now);
  const vignette = currentVignette(user.id, stage, user.avatarClass, now);

  const tz = resolveTimeZone(user.timezone);
  const tier = bondTier(user.bondQuestsCompleted);
  const beat = deriveCompanionBeat({
    streakDays: user.streakDays,
    dayGap: dayGap(user.lastActiveDate, localDateKey(now, tz)),
    hungerStage: stage,
    bondTier: tier.tier,
  });

  res.json({
    stage,
    mood: moodFor(stage),
    lastFedAt: user.lastFedAt.toISOString(),
    activity: { id: vignette.id, text: vignette.text },
    companion: {
      beat: beat.kind,
      line: companionLine(beat, { userId: user.id, now }),
      bondTier: tier.tier,
      bondTierName: tier.name,
      bondQuestsCompleted: user.bondQuestsCompleted,
    },
  });
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Verify in the running app**

Start the dev server (preview_start with the focusquest config) and confirm `GET /users/me/hero-status` returns a `companion` block via read_network_requests (or hit the endpoint). Expected: `companion.line` non-empty for an active well-fed user (ambient), `bondTierName` present.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/users.ts
git commit -m "feat(api): companion block in hero-status response"
```

---

### Task 8: Bond increment + `companionReaction` in the completion transaction

**Files:**
- Modify: `artifacts/api-server/src/routes/tasks.ts` (TxOutcome type ~519–533; tx body ~535–688; destructure ~714–715; response ~867–890; import ~29)

**Interfaces:**
- Consumes: `completionCompanionReaction` (Task 4); `usersTable.bondQuestsCompleted` (Task 5).
- Produces: response includes `companionReaction: string | null`; `bondQuestsCompleted` incremented by 1 per completion.

- [ ] **Step 1: Add the import**

Near the existing `import { hungerStage } from "../lib/hero-care";` in `tasks.ts`:

```ts
import { completionCompanionReaction } from "../lib/companion";
```

- [ ] **Step 2: Add `companionReaction` to the `TxOutcome` ok-variant type**

In the `TxOutcome` union's `status: "ok"` object (after `heroRevived: boolean;`), add:

```ts
        companionReaction: string | null;
```

- [ ] **Step 3: Compute the bond + reaction inside the transaction**

In the transaction body, just before the `await tx.update(usersTable).set({ ... })` that persists user state (the one setting `lastFedAt: now`), add:

```ts
    // Act VI Living Companion: bond grows by one per completion (monotonic).
    const bondBefore = user.bondQuestsCompleted;
    const companionReaction = completionCompanionReaction({
      bondBefore,
      leveledUp,
      newLevel: newLevel.level,
      userId,
      now,
    });
```

Then, inside that same `tx.update(usersTable).set({ ... })` call, add the increment alongside `lastFedAt: now`:

```ts
      bondQuestsCompleted: bondBefore + 1,
```

Finally, add `companionReaction` to the returned ok-object (next to `heroRevived,`):

```ts
      companionReaction,
```

- [ ] **Step 4: Surface it in the HTTP response**

Add `companionReaction` to the destructure at ~line 714–715:

```ts
  const { task, boostedBase, pointsToAdd, bonusAwarded, focusBonusAwarded, streakBonus, multiplierLabel, multiplierValue,
    newTotalPoints, newLevel, leveledUp, newStreak, oldStreak, freezeConsumed, heroRevived, companionReaction } = outcome;
```

And add it to the final `res.json({ ... })` (after `heroRevived,`):

```ts
    companionReaction,
```

The `already_completed` early response keeps no companion reaction (it awards nothing) — leave that `res.json` unchanged; `companionReaction` is optional in the schema.

- [ ] **Step 5: Confirm `/uncomplete` does NOT touch the bond**

Open the `POST /tasks/:id/uncomplete` transaction (~893+). Verify it does not reference `bondQuestsCompleted`. Do not add anything — the anti-shame invariant is that the bond never decrements. (No code change; this step is a guard check.)

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Verify in the running app**

With the dev server running, complete a quest and confirm via read_network_requests that the completion response carries `companionReaction` (null in the common case; a line when the completion crosses a bond tier — e.g. seed a user near a threshold — or on a level-up). Then re-fetch `hero-status` and confirm `companion.bondQuestsCompleted` incremented by 1. Un-complete the quest and confirm `bondQuestsCompleted` did **not** decrease.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/routes/tasks.ts
git commit -m "feat(api): grow monotonic bond + companion reaction on completion"
```

---

### Task 9: Streak-milestone push in the `checkHeroCare` cron pass

**Files:**
- Modify: `artifacts/api-server/src/lib/notification-scheduler.ts` (imports ~11; `checkHeroCare` ~199–235)

**Interfaces:**
- Consumes: `companionMilestonePush` (Task 4); `usersTable.companionMilestoneNotified` (Task 5).
- Produces: at most one companion milestone push per user per tick, never in the same tick as a hunger/flavor push.

- [ ] **Step 1: Add the import**

Extend the existing hero-care import in `notification-scheduler.ts`:

```ts
import { hungerStage, hungerWarning, shouldSendFlavorPush } from "./hero-care";
import { companionMilestonePush } from "./companion";
```

- [ ] **Step 2: Insert the companion branch**

In `checkHeroCare`, inside the per-user `try`, **after** the hunger-warning block (which ends with `continue; // a warning and a flavor push never share a tick`) and **before** the `shouldSendFlavorPush` block, add:

```ts
      // Companion streak-milestone celebration (positive). Mutually exclusive with
      // hunger/flavor: the warning above already `continue`d, and a milestone push
      // `continue`s past flavor. Marker dedups + clears on a broken streak.
      const milestone = companionMilestonePush(user.streakDays, user.companionMilestoneNotified);
      if (milestone.push) {
        await notify(user.id, milestone.push.title, milestone.push.body, milestone.push.tag);
        await db.update(usersTable)
          .set({ companionMilestoneNotified: milestone.marker })
          .where(eq(usersTable.id, user.id));
        continue; // a milestone push and a flavor push never share a tick
      }
      if (milestone.marker !== user.companionMilestoneNotified) {
        // Streak broke since the last push — clear the marker so it can re-celebrate.
        await db.update(usersTable)
          .set({ companionMilestoneNotified: milestone.marker })
          .where(eq(usersTable.id, user.id));
      }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Verify the pass runs**

The cron entrypoint is `tick()` (POST /api/cron/tick). With the dev server running, invoke a tick (or the existing dev trigger) for a user whose `streakDays` is a milestone (e.g. seed `streak_days = 7`, `companion_milestone_notified = null`) and confirm via preview_logs that the hero-care pass runs without error and the marker is set to `"7"`. Re-running the tick must not push again (marker dedups).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/notification-scheduler.ts
git commit -m "feat(cron): companion streak-milestone push in hero-care pass"
```

---

### Task 10: Frontend — companion line in `HeroVitality` + completion toast

**Files:**
- Modify: `artifacts/focusquest/src/components/hero-vitality.tsx`
- Modify: `artifacts/focusquest/src/components/task-item.tsx` (~147, after the `heroRevived` toast)

**Interfaces:**
- Consumes: `useGetHeroStatus().data.companion` and `TaskCompletionResult.companionReaction` from the regenerated client (Task 6).
- Produces: the companion line + bond tier render under the vitality bar; a companion toast on notable completions.

- [ ] **Step 1: Render the companion line + bond tier in `HeroVitality`**

In `hero-vitality.tsx`, replace the final "Currently:" block (the last `<div>` before the closing `</div>`) so the companion line leads for salient beats and the vignette stays the ambient fallback:

```tsx
      {!compact && <div className="text-xs text-muted-foreground italic">{data.mood}</div>}
      {data.companion.line && data.companion.beat !== "ambient" ? (
        <div className="text-xs font-medium text-primary">{data.companion.line}</div>
      ) : null}
      <div className="text-xs text-muted-foreground">
        Currently: <span className="italic">{data.activity.text}</span>
      </div>
      {!compact && (
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {data.companion.bondTierName}
          {data.companion.beat === "ambient" && data.companion.line ? ` · ${data.companion.line}` : ""}
        </div>
      )}
```

- [ ] **Step 2: Add the companion completion toast in `task-item.tsx`**

Immediately after the `if (res.heroRevived) { ... }` block (~line 153), add:

```tsx
          if (res.companionReaction) {
            toast({
              title: res.companionReaction,
              className: "border-primary",
            });
          }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Verify in the running app**

Start the focusquest dev server (preview_start). On the dashboard / hero summary, confirm the bond tier name renders and the ambient companion greeting shows. Complete a quest and confirm the "Quest Complete" toast still fires; for a completion that crosses a bond tier or levels up, confirm the companion toast appears. Screenshot the hero summary for the user.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/components/hero-vitality.tsx artifacts/focusquest/src/components/task-item.tsx
git commit -m "feat(ui): companion line + bond tier + completion reaction toast"
```

---

## Final verification

- [ ] `pnpm --filter @workspace/api-server test` — all companion + existing suites green.
- [ ] `pnpm typecheck` — clean across libs, artifacts, scripts.
- [ ] Manual: `hero-status` returns the `companion` block; completing a quest increments `bondQuestsCompleted` and can return a `companionReaction`; un-complete never lowers the bond; a milestone-streak user gets exactly one companion push per tick.

## Self-Review Notes

- **Spec coverage:** ambient beats + precedence (Task 2), welcome-back/rest/streak/level-up reactions (Tasks 2–4), monotonic bond + tiers (Tasks 1, 8), completion-moment reactions (Tasks 4, 8), streak-milestone-only pushes with mutual exclusion + reset (Tasks 4, 9), curated no-LLM copy (Task 3), 2 columns (Task 5), API surface (Task 6), frontend (Task 10). All spec sections map to a task.
- **Anti-shame invariants:** bond never decrements (Task 8 step 5 guard + no uncomplete change); rest/welcome copy asserted warm (Task 3 test); no push stacks on hunger/flavor (Task 9 `continue` chain); milestone push at most once per episode (Task 4 test); ambient yields to hunger via `quiet` (Task 2 test).
- **Type consistency:** `CompanionBeat`/`CompanionBeatKind` defined in Task 2 and consumed by Task 3; `companionMilestonePush`/`completionCompanionReaction` signatures defined in Task 4 and consumed by Tasks 8–9; column names `bondQuestsCompleted`/`companionMilestoneNotified` consistent across Tasks 5–9; response field `companionReaction` consistent across Tasks 6, 8, 10.
