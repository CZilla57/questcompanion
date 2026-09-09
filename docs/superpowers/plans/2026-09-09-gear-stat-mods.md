# Gear Stat Mods Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give gear typed ability mods so equipped gear raises the character-sheet ability and feeds the matching-category skill-check roll, while `statPower` stays the separate battle/defense number.

**Architecture:** A new `stat_mods jsonb` column on the `gear_items` catalog carries a `{abilityId: evenScoreBonus}` map, authored one-ability-per-item and seeded on boot. A pure lib (`gear-mods.ts`) sums equipped items' mods per ability and clamps to a per-ability cap. The roll path and the character-sheet route each read equipped gear through one shared DB helper and feed the capped bonus into the roll (as a new non-negative upside term) and the sheet (as an equipped-only overlay on top of the monotonic base score). Effects are equipped-only and upside-only.

**Tech Stack:** TypeScript, Express 5, Drizzle ORM / PostgreSQL, Vitest, React 19 + Vite, OpenAPI codegen (`api-zod` + `api-client-react`).

**Spec:** `docs/superpowers/specs/2026-09-09-gear-stat-mods-design.md`

## Global Constraints

- **Anti-shame / monotonic:** gear is upside-only. Base score/modifier never move; effective ≥ base always; unequip reproduces the exact pre-gear roll and sheet.
- **Even score bonuses only** (so `bonus/2` is a clean integer modifier). Earned base scores are always even, so effective scores stay even.
- **Per-ability cap = +4 score / +2 modifier** (`PER_ABILITY_CAP = 4`).
- **Magnitude by rarity only:** `common 0, rare +2, epic +2, legendary +4`.
- **No user-data migration** — `stat_mods` is catalog-side; `seedGear` reseeds on boot.
- **Migration hygiene:** a generated migration is committed WITH `lib/db/drizzle/meta/_journal.json` + the snapshot, then `npx tsc` is run in `lib/db` to rebuild dist decls.
- **No route-test harness exists** — pure-lib Vitest tests only; wired routes are verified by typecheck + the existing suite, and by the post-deploy live drive.
- **Bar to call it done:** `pnpm run typecheck` (root) green, `pnpm --filter @workspace/api-server run test` green, web build green, `pnpm --filter @workspace/db run ...` drizzle check green.
- **Scope:** Slice 1 = server + web (this plan). iOS parity is Slice 2 (separate plan). Non-goals: multi-ability items, slot-flavored behavior, deriving `statPower` from mods.

---

### Task 1: Add the `stat_mods` column + migration 0019

**Files:**
- Modify: `lib/db/src/schema/gear.ts` (add column to `gearItemsTable`)
- Create: `lib/db/drizzle/0019_*.sql` (generated)
- Modify: `lib/db/drizzle/meta/_journal.json` + new snapshot (generated)

**Interfaces:**
- Produces: `gearItemsTable.statMods` — a `jsonb` column typed `Partial<Record<AbilityId, number>>`, `NOT NULL DEFAULT '{}'`. `GearItem` gains `statMods`.

- [ ] **Step 1: Add the column.** In `lib/db/src/schema/gear.ts`, add `jsonb` to the drizzle imports and add the column after `inStore`:

```ts
import { pgTable, serial, text, integer, timestamp, boolean, unique, jsonb } from "drizzle-orm/pg-core";
```

```ts
  inStore: boolean("in_store").notNull().default(true),
  // Gear stat mods (RPG-depth Act I(b)): a { abilityId: evenScoreBonus } map.
  // Raises the matching ability on the sheet + roll while equipped; upside-only.
  // Empty for common items (they carry statPower only). See lib/gear-mods.ts.
  statMods: jsonb("stat_mods").$type<Partial<Record<GearAbilityId, number>>>().notNull().default({}),
```

Add the ability-id type at the top of the file (kept here so the schema package has no cross-package dep):

```ts
export type GearAbilityId = "might" | "intellect" | "attunement" | "presence" | "vigor" | "finesse";
```

- [ ] **Step 2: Generate the migration.** Run from `lib/db`:

```bash
cd lib/db && DATABASE_URL="postgres://x:x@localhost:5432/x" pnpm generate
```

Expected: a new `drizzle/0019_*.sql` adding `stat_mods jsonb ... default '{}'`, an updated `meta/_journal.json` (20 entries), and a new snapshot file.

- [ ] **Step 3: Rebuild dist decls.**

```bash
cd lib/db && npx tsc
```

Expected: no errors.

- [ ] **Step 4: Sanity-check the generated SQL.**

```bash
cat lib/db/drizzle/0019_*.sql
```

Expected: `ALTER TABLE "gear_items" ADD COLUMN "stat_mods" jsonb DEFAULT '{}'::jsonb NOT NULL;` (or equivalent).

- [ ] **Step 5: Commit.**

```bash
git add lib/db/src/schema/gear.ts lib/db/drizzle/0019_*.sql lib/db/drizzle/meta/ lib/db/dist
git commit -m "feat(db): add stat_mods jsonb to gear_items (migration 0019)"
```

---

### Task 2: `gear-mods.ts` pure lib — magnitude, cap, aggregation

**Files:**
- Create: `artifacts/api-server/src/lib/gear-mods.ts`
- Test: `artifacts/api-server/src/lib/gear-mods.test.ts`

**Interfaces:**
- Consumes: `AbilityId` from `./character-sheet`; `GearRarity` from `@workspace/db`.
- Produces:
  - `PER_ABILITY_CAP = 4`
  - `gearAbilityBonus(rarity: GearRarity): number` — even score bonus (`common 0, rare 2, epic 2, legendary 4`).
  - `type AbilityMods = Partial<Record<AbilityId, number>>`
  - `equippedAbilityMods(equipped: { statMods: AbilityMods }[]): AbilityMods` — sum per ability, clamp each to `PER_ABILITY_CAP`, drop zero/negative entries.
  - `gearModifierFor(mods: AbilityMods, ability: AbilityId): number` — `Math.floor((mods[ability] ?? 0) / 2)` (the roll's modifier-space term).

- [ ] **Step 1: Write the failing test.** Create `artifacts/api-server/src/lib/gear-mods.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  PER_ABILITY_CAP,
  gearAbilityBonus,
  equippedAbilityMods,
  gearModifierFor,
} from "./gear-mods";

describe("gearAbilityBonus — rarity-only, even", () => {
  it("maps rarity to even score bonuses (common carries none)", () => {
    expect(gearAbilityBonus("common")).toBe(0);
    expect(gearAbilityBonus("rare")).toBe(2);
    expect(gearAbilityBonus("epic")).toBe(2);
    expect(gearAbilityBonus("legendary")).toBe(4);
  });
  it("is always even and never negative", () => {
    for (const r of ["common", "rare", "epic", "legendary"] as const) {
      const b = gearAbilityBonus(r);
      expect(b % 2).toBe(0);
      expect(b).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("equippedAbilityMods — sum then cap", () => {
  it("returns nothing for no equipped gear (unequip is neutral)", () => {
    expect(equippedAbilityMods([])).toEqual({});
  });
  it("sums same-ability items", () => {
    expect(equippedAbilityMods([{ statMods: { intellect: 2 } }, { statMods: { intellect: 2 } }]))
      .toEqual({ intellect: 4 });
  });
  it("clamps a single ability to the per-ability cap", () => {
    expect(equippedAbilityMods([
      { statMods: { might: 4 } }, { statMods: { might: 4 } },
    ])).toEqual({ might: PER_ABILITY_CAP });
  });
  it("keeps distinct abilities separate", () => {
    expect(equippedAbilityMods([{ statMods: { might: 2, finesse: 2 } }, { statMods: { finesse: 2 } }]))
      .toEqual({ might: 2, finesse: 4 });
  });
  it("is monotonic — adding gear never lowers an ability", () => {
    const base = equippedAbilityMods([{ statMods: { vigor: 2 } }]);
    const more = equippedAbilityMods([{ statMods: { vigor: 2 } }, { statMods: { vigor: 2 } }]);
    expect(more.vigor!).toBeGreaterThanOrEqual(base.vigor!);
  });
});

describe("gearModifierFor — score bonus to modifier", () => {
  it("halves the (even) score bonus into a modifier term", () => {
    expect(gearModifierFor({ intellect: 2 }, "intellect")).toBe(1);
    expect(gearModifierFor({ intellect: 4 }, "intellect")).toBe(2);
    expect(gearModifierFor({}, "intellect")).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/gear-mods.test.ts
```

Expected: FAIL — `Cannot find module './gear-mods'`.

- [ ] **Step 3: Implement `gear-mods.ts`.**

```ts
// Gear stat mods (RPG-depth Act I(b)). Pure + DB-free — the derived overlay for
// equipped gear's typed ability bonuses, shared by the roll (roll-engine) and
// the character sheet so they can never disagree. Every value is upside-only:
// the aggregate is clamped ≥ 0 and capped, so gear can only ever raise a score.
import type { AbilityId } from "./character-sheet";
import type { GearRarity } from "@workspace/db";

export type AbilityMods = Partial<Record<AbilityId, number>>;

/** Max total gear bonus to any single ability: +4 score = +2 modifier. Keeps a
 *  fully-geared hero tilting the odds without erasing the dice bands. */
export const PER_ABILITY_CAP = 4;

/** Even score bonus by rarity (rarity-only — level already drives statPower).
 *  Common carries no mod, giving rarity an identity beyond raw power. */
const BONUS_BY_RARITY: Record<GearRarity, number> = {
  common: 0,
  rare: 2,
  epic: 2,
  legendary: 4,
};

export function gearAbilityBonus(rarity: GearRarity): number {
  return BONUS_BY_RARITY[rarity];
}

/** Sum equipped items' stat_mods per ability, clamp each to the cap, and drop
 *  any non-positive entry so the result reads as "only what gear adds". */
export function equippedAbilityMods(equipped: { statMods: AbilityMods }[]): AbilityMods {
  const summed: AbilityMods = {};
  for (const item of equipped) {
    for (const [ability, bonus] of Object.entries(item.statMods) as [AbilityId, number][]) {
      if (!Number.isFinite(bonus) || bonus <= 0) continue;
      summed[ability] = (summed[ability] ?? 0) + bonus;
    }
  }
  const capped: AbilityMods = {};
  for (const [ability, bonus] of Object.entries(summed) as [AbilityId, number][]) {
    const c = Math.min(PER_ABILITY_CAP, bonus);
    if (c > 0) capped[ability] = c;
  }
  return capped;
}

/** The roll's modifier-space term for one ability: half the (even) score bonus. */
export function gearModifierFor(mods: AbilityMods, ability: AbilityId): number {
  return Math.floor((mods[ability] ?? 0) / 2);
}
```

- [ ] **Step 4: Run tests to green.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/gear-mods.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add artifacts/api-server/src/lib/gear-mods.ts artifacts/api-server/src/lib/gear-mods.test.ts
git commit -m "feat(api): gear-mods pure lib — magnitude, cap, per-ability aggregation"
```

---

### Task 3: Catalog — author abilities + emit `stat_mods`

**Files:**
- Modify: `lib/db/src/gear-catalog.ts`
- Test: `lib/db/src/gear-catalog.test.ts` (create if absent; otherwise add a `describe`)

**Interfaces:**
- Consumes: `GearAbilityId` from `./schema` (Task 1). Does NOT import `gearAbilityBonus` — `lib/db` must not depend on the api-server package, so the rarity→bonus table is replicated locally as `ABILITY_BONUS_BY_RARITY` with the exact same values and a cross-reference comment.
- Produces: `GearRosterItem.statMods`; `Row.ability` (optional per-item override); `rosterAbility(row)`; `seedGear` writes `statMods`.

- [ ] **Step 1: Write the failing invariant test.** Create/extend `lib/db/src/gear-catalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { GEAR_CATALOG } from "./gear-catalog";

const ABILITIES = ["might", "intellect", "attunement", "presence", "vigor", "finesse"] as const;

describe("gear catalog stat_mods", () => {
  it("gives common items no ability mod (statPower only)", () => {
    for (const item of GEAR_CATALOG.filter((i) => i.rarity === "common")) {
      expect(item.statMods, item.name).toEqual({});
    }
  });

  it("gives every rare+ item exactly one even ability mod in [2,4]", () => {
    for (const item of GEAR_CATALOG.filter((i) => i.rarity !== "common")) {
      const entries = Object.entries(item.statMods);
      expect(entries.length, item.name).toBe(1);
      const [, bonus] = entries[0]!;
      expect(bonus % 2, item.name).toBe(0);
      expect(bonus, item.name).toBeGreaterThanOrEqual(2);
      expect(bonus, item.name).toBeLessThanOrEqual(4);
    }
  });

  it("covers all six abilities on low-level (≤5) in-store gear — none is un-boostable", () => {
    const covered = new Set<string>();
    for (const item of GEAR_CATALOG.filter((i) => i.inStore && i.levelRequired <= 5)) {
      for (const a of Object.keys(item.statMods)) covered.add(a);
    }
    for (const a of ABILITIES) expect(covered.has(a), `ability ${a} uncovered`).toBe(true);
  });

  it("the weapon slot spans at least three abilities (a real weapon decision)", () => {
    const weaponAbilities = new Set<string>();
    for (const item of GEAR_CATALOG.filter((i) => i.slot === "weapon" && i.rarity !== "common")) {
      for (const a of Object.keys(item.statMods)) weaponAbilities.add(a);
    }
    expect(weaponAbilities.size).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.**

```bash
pnpm --filter @workspace/db exec vitest run src/gear-catalog.test.ts
```

Expected: FAIL — `statMods` undefined on catalog items (and coverage assertions fail).

- [ ] **Step 3: Add ability authoring + `stat_mods` to the catalog.** In `lib/db/src/gear-catalog.ts`:

Add to the top-level types (a `GearAbilityId` is already exported from `./schema` in Task 1 — import it):

```ts
import { gearItemsTable, type GearSlot, type GearRarity, type GearAbilityId } from "./schema";
```

Extend both row interfaces with an OPTIONAL per-item override and add `statMods` to the output row:

```ts
export interface GearRosterItem {
  name: string; description: string; slot: GearSlot; rarity: GearRarity;
  statPower: number; costXp: number; levelRequired: number; icon: string; spriteId: string;
  inStore: boolean; statMods: Partial<Record<GearAbilityId, number>>;
}
```

```ts
interface Row {
  name: string; description: string; slot: GearSlot; rarity: GearRarity;
  levelRequired: number; icon: string; spriteId: string; inStore: boolean;
  ability?: GearAbilityId; // optional per-item override; default derived by rosterAbility()
}
```

Add the ability-assignment rule + magnitude table (values mirror `api-server/src/lib/gear-mods.ts`, kept in sync by comment since `lib/db` must not depend on the api package):

```ts
// The ability each item boosts. Default is by slot, with weapon spriteId
// overrides so the weapon slot spans might/intellect/finesse — making the
// weapon choice a real decision, not a fixed spread. helmet carries attunement
// (a circlet of clarity) so all six abilities are covered across the catalog.
// A row may set `ability` to override for marquee flavor.
const DEFAULT_ABILITY_BY_SLOT: Record<GearSlot, GearAbilityId> = {
  weapon: "might",
  helmet: "attunement",
  armor: "vigor",
  boots: "finesse",
  accessory: "presence",
};
const WEAPON_SPRITE_ABILITY: Record<string, GearAbilityId> = {
  staff: "intellect",
  "archmage-staff": "intellect",
  bow: "finesse",
  slingshot: "finesse",
  crossbow: "finesse",
};
export function rosterAbility(row: Row): GearAbilityId {
  if (row.ability) return row.ability;
  if (row.slot === "weapon" && WEAPON_SPRITE_ABILITY[row.spriteId]) {
    return WEAPON_SPRITE_ABILITY[row.spriteId]!;
  }
  return DEFAULT_ABILITY_BY_SLOT[row.slot];
}

// Mirrors BONUS_BY_RARITY in api-server/src/lib/gear-mods.ts — keep in sync.
const ABILITY_BONUS_BY_RARITY: Record<GearRarity, number> = {
  common: 0, rare: 2, epic: 2, legendary: 4,
};
```

Extend the `GEAR_CATALOG` derivation to emit `statMods`:

```ts
export const GEAR_CATALOG: GearRosterItem[] = ROSTER.map((r) => {
  const statPower = gearStatPower(r.levelRequired, r.rarity);
  const bonus = ABILITY_BONUS_BY_RARITY[r.rarity];
  const statMods: Partial<Record<GearAbilityId, number>> =
    bonus > 0 ? { [rosterAbility(r)]: bonus } : {};
  return { ...r, statPower, costXp: statPower * 50, statMods };
});
```

Add `statMods` to the `seedGear` upsert `set`:

```ts
      set: {
        description: item.description, slot: item.slot, rarity: item.rarity,
        statPower: item.statPower, costXp: item.costXp, levelRequired: item.levelRequired,
        icon: item.icon, spriteId: item.spriteId, inStore: item.inStore,
        statMods: item.statMods,
      },
```

- [ ] **Step 4: Run tests to green.**

```bash
pnpm --filter @workspace/db exec vitest run src/gear-catalog.test.ts && cd lib/db && npx tsc && cd -
```

Expected: PASS + no tsc errors. If the coverage test fails, the low-level in-store roster is missing a slot at level ≤5 — add or re-level an existing in-store item so each of the five slots (and thus all six abilities via the weapon sprites) appears at level ≤5, OR set an explicit `ability` override on a low-level in-store row.

- [ ] **Step 5: Commit.**

```bash
git add lib/db/src/gear-catalog.ts lib/db/src/gear-catalog.test.ts lib/db/dist
git commit -m "feat(db): author gear abilities + emit stat_mods in the catalog"
```

---

### Task 4: Shared equipped-gear read helper

**Files:**
- Create: `artifacts/api-server/src/lib/equipped-gear.ts`
- Modify: `artifacts/api-server/src/routes/battle.ts:17-33` (`getUserPower` reuses it)

**Interfaces:**
- Produces: `readEquippedGear(userId: number): Promise<EquippedGearRow[]>` where `EquippedGearRow = { statPower: number; rarity: GearRarity; attuned: boolean; statMods: AbilityMods }`. One query shape reused by battle power, the roll, and the sheet.

- [ ] **Step 1: Implement the helper.** Create `artifacts/api-server/src/lib/equipped-gear.ts`:

```ts
// One shared read of a user's currently-equipped gear, carrying both the battle
// number (statPower/rarity/attuned) and the roll/sheet mods (statMods). Reused
// by getUserPower, the completion roll, and the character-sheet route so the
// query shape can't drift. DB-bound (not pure); the pure aggregation lives in
// gear-mods.ts.
import { and, eq } from "drizzle-orm";
import { db, gearItemsTable, userGearTable, type GearRarity } from "@workspace/db";
import type { AbilityMods } from "./gear-mods";

export interface EquippedGearRow {
  statPower: number;
  rarity: GearRarity;
  attuned: boolean;
  statMods: AbilityMods;
}

export async function readEquippedGear(userId: number): Promise<EquippedGearRow[]> {
  const rows = await db
    .select({ gear: gearItemsTable, userGear: userGearTable })
    .from(userGearTable)
    .innerJoin(gearItemsTable, eq(userGearTable.gearItemId, gearItemsTable.id))
    .where(and(eq(userGearTable.userId, userId), eq(userGearTable.equipped, true)));
  return rows.map((r) => ({
    statPower: r.gear.statPower,
    rarity: r.gear.rarity,
    attuned: r.userGear.attuned,
    statMods: (r.gear.statMods ?? {}) as AbilityMods,
  }));
}
```

- [ ] **Step 2: Refactor `getUserPower` to use it.** In `artifacts/api-server/src/routes/battle.ts`, replace the inline equipped query (lines 21–32) so it reads:

```ts
import { readEquippedGear } from "../lib/equipped-gear";
```

```ts
export async function getUserPower(userId: number): Promise<number> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return 0;
  const equipped = await readEquippedGear(userId);
  const power = gearPower(equipped.map((g) => ({
    statPower: g.statPower, rarity: g.rarity, attuned: g.attuned,
  })));
  const level = getLevelInfo(user.totalPoints).level;
  return calcBattlePower(level, power);
}
```

(Remove now-unused `gearItemsTable`/`userGearTable` imports only if no other reference remains in the file — grep first.)

- [ ] **Step 3: Verify typecheck + existing suite.**

```bash
pnpm run typecheck && pnpm --filter @workspace/api-server run test
```

Expected: green (battle behavior unchanged — same power math, new read path).

- [ ] **Step 4: Commit.**

```bash
git add artifacts/api-server/src/lib/equipped-gear.ts artifacts/api-server/src/routes/battle.ts
git commit -m "refactor(api): shared readEquippedGear helper (reused by getUserPower)"
```

---

### Task 5: Roll engine — add the `gearBonus` upside term

**Files:**
- Modify: `artifacts/api-server/src/lib/roll-engine.ts` (`SkillCheck`, `resolveCheck`, `resolveTaskCheck`)
- Test: `artifacts/api-server/src/lib/roll-engine.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SkillCheck.gearBonus: number`; `resolveCheck` + `resolveTaskCheck` accept optional `gearBonus?: number` (clamped ≥ 0, folded into `total`).

- [ ] **Step 1: Write the failing tests.** Add to `artifacts/api-server/src/lib/roll-engine.test.ts`:

```ts
import { resolveCheck } from "./roll-engine";

describe("resolveCheck — gear bonus (upside-only)", () => {
  const base = { seed: "task:1:1:2026-09-09", modifier: 1, proficiency: 2, dc: 15, ability: "intellect" as const };

  it("adds a non-negative gearBonus to the total and surfaces it", () => {
    const without = resolveCheck(base);
    const with2 = resolveCheck({ ...base, gearBonus: 2 });
    expect(with2.total).toBe(without.total + 2);
    expect(with2.gearBonus).toBe(2);
  });

  it("is byte-identical to the pre-gear roll when gearBonus is absent or 0 (unequip = neutral)", () => {
    const a = resolveCheck(base);
    const b = resolveCheck({ ...base, gearBonus: 0 });
    expect(b).toEqual({ ...a, gearBonus: 0 });
  });

  it("never lets a negative gearBonus lower the total", () => {
    const without = resolveCheck(base);
    const neg = resolveCheck({ ...base, gearBonus: -5 });
    expect(neg.total).toBe(without.total);
    expect(neg.gearBonus).toBe(0);
  });
});
```

- [ ] **Step 2: Run and watch fail.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/roll-engine.test.ts
```

Expected: FAIL — `gearBonus` missing on `SkillCheck` / not summed.

- [ ] **Step 3: Implement.** In `roll-engine.ts`:

Add to the `SkillCheck` interface:

```ts
  /** Modifier-space contribution from equipped gear's stat mods, ≥ 0. Already
   *  included in `total`; surfaced so a client can label a "+N gear" term. */
  gearBonus: number;
```

In `resolveCheck`, add `gearBonus?: number` to the args type, then extend the bonus channel and the returned object. Change:

```ts
  const bonus = Math.max(0, boostBonus) + Math.max(0, args.restedBonus ?? 0);
```

to:

```ts
  const gearBonus = Math.max(0, args.gearBonus ?? 0);
  const bonus = Math.max(0, boostBonus) + Math.max(0, args.restedBonus ?? 0) + gearBonus;
```

and add `gearBonus` to the returned `SkillCheck` object (alongside `modifier`, `proficiency`, …):

```ts
    gearBonus,
```

In `resolveTaskCheck`, add `gearBonus?: number` to the args type and pass it through to `resolveCheck`:

```ts
    gearBonus: args.gearBonus,
```

- [ ] **Step 4: Run to green (whole roll-engine suite, to catch the seed-stability regression).**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/roll-engine.test.ts
```

Expected: PASS, including all pre-existing roll-engine tests (no-gear path unchanged).

- [ ] **Step 5: Commit.**

```bash
git add artifacts/api-server/src/lib/roll-engine.ts artifacts/api-server/src/lib/roll-engine.test.ts
git commit -m "feat(api): roll-engine gearBonus upside term on skill checks"
```

---

### Task 6: Character sheet — optional gear overlay

**Files:**
- Modify: `artifacts/api-server/src/lib/character-sheet.ts` (`AbilityScore`, `abilityScores`, `characterSheet`)
- Test: `artifacts/api-server/src/lib/character-sheet.test.ts`

**Interfaces:**
- Consumes: `AbilityMods` from `./gear-mods`.
- Produces: `AbilityScore` gains `gearBonus: number`, `effectiveScore: number`, `effectiveModifier: number`. `abilityScores` gains optional `gearMods?: AbilityMods`. `characterSheet` gains optional `gearMods?: AbilityMods` passthrough.

- [ ] **Step 1: Write the failing tests.** Add to `artifacts/api-server/src/lib/character-sheet.test.ts`:

```ts
import { abilityScores } from "./character-sheet";

describe("abilityScores — gear overlay (upside-only)", () => {
  const args = { lifetimeByKingdom: { athenaeum: 3000 }, focus: { completedIntervals: 0 } };

  it("is unchanged when no gearMods are passed (backward compatible)", () => {
    const sheet = abilityScores(args);
    const intel = sheet.find((a) => a.id === "intellect")!;
    expect(intel.score).toBe(16);
    expect(intel.gearBonus).toBe(0);
    expect(intel.effectiveScore).toBe(16);
    expect(intel.effectiveModifier).toBe(intel.modifier);
  });

  it("overlays gear on top without moving the base score", () => {
    const sheet = abilityScores({ ...args, gearMods: { intellect: 2 } });
    const intel = sheet.find((a) => a.id === "intellect")!;
    expect(intel.score).toBe(16);              // base untouched
    expect(intel.gearBonus).toBe(2);
    expect(intel.effectiveScore).toBe(18);
    expect(intel.effectiveModifier).toBe(intel.modifier + 1);
  });

  it("lets gear push the effective score past the natural 20 ceiling", () => {
    const maxed = { lifetimeByKingdom: { athenaeum: 999_999 }, focus: { completedIntervals: 0 } };
    const sheet = abilityScores({ ...maxed, gearMods: { intellect: 4 } });
    const intel = sheet.find((a) => a.id === "intellect")!;
    expect(intel.score).toBe(20);              // earned cap
    expect(intel.effectiveScore).toBe(24);     // gear exceeds it
  });
});
```

- [ ] **Step 2: Run and watch fail.**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/character-sheet.test.ts
```

Expected: FAIL — `gearBonus`/`effectiveScore` missing.

- [ ] **Step 3: Implement.** In `character-sheet.ts`:

Add the import:

```ts
import type { AbilityMods } from "./gear-mods";
```

Extend the `AbilityScore` interface:

```ts
  /** Equipped-gear score bonus for this ability (0 when none). Overlay only —
   *  never changes `score`/`modifier`, which stay the earned, monotonic values. */
  gearBonus: number;
  /** score + gearBonus. May exceed 20 (gear breaks the natural ceiling). */
  effectiveScore: number;
  /** floor((effectiveScore - 10) / 2) — the modifier the roll actually uses. */
  effectiveModifier: number;
```

Change `abilityScores` to accept the optional mods and compute the overlay:

```ts
export function abilityScores(args: {
  lifetimeByKingdom: Partial<Record<KingdomId, number>>;
  focus: FocusDiscipline;
  gearMods?: AbilityMods;
}): AbilityScore[] {
  return ABILITIES.map((meta) => {
    const value = meta.kingdomId
      ? (args.lifetimeByKingdom[meta.kingdomId] ?? 0)
      : args.focus.completedIntervals;
    const score = meta.kingdomId ? scoreForKingdomPoints(value) : scoreForFocus(value);
    const progress = stepProgress(value, meta.kingdomId ? KINGDOM_LADDER : FOCUS_LADDER);
    const gearBonus = Math.max(0, args.gearMods?.[meta.id] ?? 0);
    const effectiveScore = score + gearBonus;
    return {
      id: meta.id,
      name: meta.name,
      abbreviation: meta.abbreviation,
      score,
      modifier: abilityModifier(score),
      gearBonus,
      effectiveScore,
      effectiveModifier: abilityModifier(effectiveScore),
      kingdomId: meta.kingdomId,
      progress,
    };
  });
}
```

Thread the optional mods through `characterSheet`:

```ts
export function characterSheet(args: {
  lifetimeByKingdom: Partial<Record<KingdomId, number>>;
  focus: FocusDiscipline;
  heroClass: string;
  level: number;
  battlePower: number;
  gearMods?: AbilityMods;
}): CharacterSheet {
  const capitalPoints = capitalLifetime(args.lifetimeByKingdom);
  return {
    abilities: abilityScores({ lifetimeByKingdom: args.lifetimeByKingdom, focus: args.focus, gearMods: args.gearMods }),
    proficiencyBonus: proficiencyBonus(capitalTier(capitalPoints).tier),
    heroClass: args.heroClass,
    level: args.level,
    battlePower: args.battlePower,
  };
}
```

- [ ] **Step 4: Run to green (whole file — confirms drift-guard + monotonic tests still pass).**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/character-sheet.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add artifacts/api-server/src/lib/character-sheet.ts artifacts/api-server/src/lib/character-sheet.test.ts
git commit -m "feat(api): character-sheet gear overlay (effective score/modifier)"
```

---

### Task 7: Wire gear into the completion roll

**Files:**
- Modify: `artifacts/api-server/src/routes/tasks.ts` (`rollCompletionCheck` at :63-97 and its call site at :1045)

**Interfaces:**
- Consumes: `readEquippedGear`, `equippedAbilityMods`, `gearModifierFor`, `abilityForKingdom`, `kingdomForCategory`.
- Produces: the completion roll's `SkillCheck.gearBonus` reflects equipped gear for the task's ability.

- [ ] **Step 1: Add imports.** In `artifacts/api-server/src/routes/tasks.ts`:

```ts
import { readEquippedGear } from "../lib/equipped-gear";
import { equippedAbilityMods, gearModifierFor } from "../lib/gear-mods";
import { abilityForKingdom } from "../lib/character-sheet";
import { kingdomForCategory } from "../lib/kingdoms";
```

(Some of these may already be imported — grep and dedupe.)

- [ ] **Step 2: Compute + pass the gear bonus in `rollCompletionCheck`.** Add a `gearBonus` param and fold it into the `resolveTaskCheck` call. Change the signature:

```ts
async function rollCompletionCheck(
  userId: number,
  taskId: number,
  category: string,
  difficulty: string,
  completionDay: string,
  boost?: RollBoost,
  restedBonus?: number,
  gearBonus?: number,
): Promise<SkillCheck> {
```

and the `resolveTaskCheck` call at the end of that function:

```ts
  return resolveTaskCheck({
    seed: taskCheckSeed(userId, taskId, completionDay),
    abilities,
    proficiency,
    category,
    difficulty,
    boost,
    restedBonus,
    gearBonus,
  });
```

- [ ] **Step 3: Compute the gear bonus at the call site.** At `tasks.ts:1045`, just before the `rollCompletionCheck` call, read equipped gear and derive the term for the task's ability:

```ts
    const equippedGear = await readEquippedGear(userId);
    const gearMods = equippedAbilityMods(equippedGear);
    const taskAbility = abilityForKingdom(kingdomForCategory(task.category));
    const gearBonus = gearModifierFor(gearMods, taskAbility);
    skillCheck = await rollCompletionCheck(userId, id, task.category, task.difficulty, today!, consumed?.boost, restedBonus, gearBonus);
```

(Replace the existing single-line `rollCompletionCheck(...)` call; leave the surrounding best-effort try/catch and the `bandNarration`/`bandEffect` lines that follow untouched.)

- [ ] **Step 4: Verify.**

```bash
pnpm run typecheck && pnpm --filter @workspace/api-server run test
```

Expected: green.

- [ ] **Step 5: Commit.**

```bash
git add artifacts/api-server/src/routes/tasks.ts
git commit -m "feat(api): equipped gear feeds the completion skill-check roll"
```

---

### Task 8: Wire gear into the character-sheet route

**Files:**
- Modify: `artifacts/api-server/src/routes/users.ts:325-354` (`GET /users/me/character-sheet`)

**Interfaces:**
- Consumes: `readEquippedGear`, `equippedAbilityMods`.
- Produces: the `/users/me/character-sheet` response carries the gear overlay fields.

- [ ] **Step 1: Add imports.** In `artifacts/api-server/src/routes/users.ts`:

```ts
import { readEquippedGear } from "../lib/equipped-gear";
import { equippedAbilityMods } from "../lib/gear-mods";
```

- [ ] **Step 2: Read gear + pass `gearMods`.** In the `character-sheet` handler, before the `res.json(characterSheet({...}))` call, add:

```ts
  const gearMods = equippedAbilityMods(await readEquippedGear(userId));
```

and add `gearMods` to the `characterSheet({...})` args:

```ts
  res.json(characterSheet({
    lifetimeByKingdom,
    focus: { completedIntervals },
    heroClass: hero.avatarClass,
    level: hero.level,
    battlePower: hero.battlePower,
    gearMods,
  }));
```

- [ ] **Step 3: Verify.**

```bash
pnpm run typecheck && pnpm --filter @workspace/api-server run test
```

Expected: green.

- [ ] **Step 4: Commit.**

```bash
git add artifacts/api-server/src/routes/users.ts
git commit -m "feat(api): character-sheet route serves the gear overlay"
```

---

### Task 9: OpenAPI contract + client regen

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (`AbilityScore`, `SkillCheck`)
- Regenerate: `api-zod` + `api-client-react` (via `pnpm codegen`)

**Interfaces:**
- Produces: generated `AbilityScore` gains `gearBonus`/`effectiveScore`/`effectiveModifier`; generated `SkillCheck` gains `gearBonus`.

- [ ] **Step 1: Extend `AbilityScore`.** In `lib/api-spec/openapi.yaml`, update the `AbilityScore` schema `required` list and properties:

```yaml
      required: [id, name, abbreviation, score, modifier, kingdomId, progress, gearBonus, effectiveScore, effectiveModifier]
```

and add under `properties` (after `modifier`):

```yaml
        gearBonus:
          type: integer
          description: Equipped-gear score bonus for this ability (0 when none). Overlay only; never changes the earned score/modifier.
        effectiveScore:
          type: integer
          description: score + gearBonus. May exceed 20 — gear breaks the natural ceiling.
        effectiveModifier:
          type: integer
          description: floor((effectiveScore - 10) / 2) — the modifier the roll uses.
```

- [ ] **Step 2: Extend `SkillCheck`.** Add `gearBonus` to its `required` list and properties:

```yaml
      required: [d20, modifier, proficiency, total, dc, band, ability, gearBonus]
```

```yaml
        gearBonus:
          type: integer
          description: Modifier-space contribution from equipped gear, ≥ 0. Already included in total; surfaced so clients can label a "+N gear" term.
```

- [ ] **Step 3: Regenerate clients.**

```bash
cd lib/api-spec && pnpm codegen && cd -
```

Expected: `api-zod` + `api-client-react` generated sources update to include the new fields.

- [ ] **Step 4: Typecheck the libs (catches stale dist).**

```bash
pnpm -w run typecheck:libs
```

Expected: green.

- [ ] **Step 5: Commit.**

```bash
git add lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react
git commit -m "feat(api-spec): AbilityScore gear overlay + SkillCheck gearBonus; regen"
```

---

### Task 10: Web — sheet overlay + gear ability badge

**Files:**
- Modify: `artifacts/focusquest/src/components/character-sheet.tsx` (`AbilityBlock`)
- Modify: the gear card in the Inventory/Store view (grep for where `statPower`/`rarity` render on a gear item, e.g. `artifacts/focusquest/src/pages/avatar.tsx` or an inventory component) to add an ability-mod badge.

**Interfaces:**
- Consumes: generated `AbilityScore` (with `gearBonus`/`effectiveScore`/`effectiveModifier`) and the gear item's `statMods`.

- [ ] **Step 1: Show the effective score + gear delta in `AbilityBlock`.** In `character-sheet.tsx`, replace the score/modifier lines (currently rendering `ability.score` and `formatMod(ability.modifier)`) with an effective-aware version that falls back when a client outruns the server:

```tsx
  const gearBonus = ability.gearBonus ?? 0;
  const effScore = ability.effectiveScore ?? ability.score;
  const effMod = ability.effectiveModifier ?? ability.modifier;
```

```tsx
      <div className="mt-1 text-2xl font-semibold leading-none tabular-nums">{effScore}</div>
      <div className="mt-1 text-sm font-medium text-primary tabular-nums">{formatMod(effMod)}</div>
      {gearBonus > 0 && (
        <div className="mt-0.5 text-[10px] font-medium text-amber-400 tabular-nums">
          +{gearBonus} gear
        </div>
      )}
```

- [ ] **Step 2: Add an ability badge to the gear card.** Locate the gear-card render (grep `statPower` under `artifacts/focusquest/src`), and where rarity/power already render, add a badge derived from the item's `statMods` (one entry). Example, given a `gear` item with a `statMods` record:

```tsx
{Object.entries(gear.statMods ?? {}).map(([ability, bonus]) => (
  <span key={ability} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-400">
    +{bonus} {ability.slice(0, 3)}
  </span>
))}
```

(Match the surrounding badge/label styling in that component rather than copying these classes verbatim if they differ.)

- [ ] **Step 3: Build the web app.**

```bash
pnpm --filter @workspace/focusquest run build
```

Expected: green.

- [ ] **Step 4: Verify in the preview.** Start the dev server (`preview_start` name from `.claude/launch.json`), open the Hero character sheet with a rare+ item equipped, confirm the effective score shows with a "+N gear" line, and a gear card shows the ability badge. Screenshot for the record.

- [ ] **Step 5: Commit.**

```bash
git add artifacts/focusquest/src
git commit -m "feat(web): character sheet gear overlay + gear-card ability badge"
```

---

### Task 11: Full verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Run the full bar.**

```bash
pnpm run typecheck && pnpm --filter @workspace/api-server run test && pnpm --filter @workspace/focusquest run build && pnpm --filter @workspace/db exec vitest run
```

Expected: all green.

- [ ] **Step 2: Confirm the migration meta is complete.**

```bash
git show --stat HEAD~ -- lib/db/drizzle/meta/_journal.json >/dev/null 2>&1; ls lib/db/drizzle/0019_*.sql && ls lib/db/drizzle/meta/*0019* 2>/dev/null || python3 -c "import json;print(len(json.load(open('lib/db/drizzle/meta/_journal.json'))['entries']))"
```

Expected: `0019` sql present and the journal shows 20 entries.

- [ ] **Step 3: Push + open the PR to main.**

```bash
git push -u origin claude/dnd-gear-stat-mods
gh pr create --base main --head claude/dnd-gear-stat-mods --title "feat: gear stat mods — typed ability bonuses (RPG-depth Act I(b))" --body "Implements docs/superpowers/specs/2026-09-09-gear-stat-mods-design.md. Server+web slice; iOS parity to follow."
```

- [ ] **Step 4: Post-deploy live drive (after merge + deploy).** Equip a rare INT item → `/users/me/character-sheet` shows intellect `effectiveScore` raised with `gearBonus > 0` → complete a learning quest → the completion `skillCheck.gearBonus` is `+1` → unequip → both return to base.

---

## Slice 2 (separate plan): iOS parity

Not in this plan. When Slice 1 is merged + deployed, a follow-up plan on the swift integration branch will: decode `gearBonus`/`effectiveScore`/`effectiveModifier` on the iOS `AbilityScore` and `gearBonus` on `SkillCheck`; show the effective score + "+N gear" on HeroView's character sheet; show the ability badge on gear cards; and add the gear term to the `CompletionSheet` roll math. iOS Codable drops unknown keys, so the live app keeps working until then.

## Self-review notes

- **Spec coverage:** score model + cap (Tasks 2, 5, 6); data model + authoring (Tasks 1, 3); shared read (Task 4); roll wiring (Task 5, 7); sheet wiring (Task 6, 8); contract/clients (Task 9); web display (Task 10); anti-shame invariants (tests in Tasks 2, 5, 6); rollout (Task 11). iOS is deferred by design (Slice 2).
- **Type consistency:** `AbilityMods` defined in `gear-mods.ts` (Task 2), consumed by `equipped-gear.ts` (Task 4) and `character-sheet.ts` (Task 6). `GearAbilityId` defined in `schema/gear.ts` (Task 1), consumed by `gear-catalog.ts` (Task 3). `gearBonus` name is consistent across `SkillCheck` (Task 5), `AbilityScore` (Task 6), OpenAPI (Task 9), web (Task 10).
- **Cross-package sync:** the rarity→bonus table is duplicated in `lib/db/gear-catalog.ts` and `api-server/gear-mods.ts` (lib/db must not depend on the api package); both carry a cross-reference comment. Values: `common 0, rare 2, epic 2, legendary 4`.
