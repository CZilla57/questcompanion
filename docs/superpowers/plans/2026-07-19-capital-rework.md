# Capital Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the capital the realm's cumulative grand total on a 12-tier ladder, rendered as a full-width band, without touching the five-kingdom balance reading.

**Architecture:** The capital's value is *derived* at read time as the sum of all six `kingdom_points` rows — the write path is untouched, so there is no migration and no risk of drift. A second tier ladder (`capitalTier`, 12 entries) sits beside the existing `kingdomTier` (6 entries). The renderer seam gains per-kingdom scene dimensions because the capital's art is a 1024×192 band while the five kingdoms stay 320×192.

**Tech Stack:** TypeScript, Express + Drizzle (api-server), React + wouter + Tailwind (focusquest), Vitest, orval codegen from `lib/api-spec/openapi.yaml`, `sharp` for image assertions, `pngjs` for placeholder generation.

## Global Constraints

- **Branch:** all work lands on `feat/capital-rework`. Verify with `git branch --show-current` before every commit — concurrent sessions share this working tree.
- **The frontend must never import from `artifacts/api-server`.** Shared constants are re-declared in `artifacts/focusquest/src/lib/`, following the existing `Liveliness` precedent.
- **`TILE = 32`** (`artifacts/focusquest/src/lib/kingdom-sprites.ts:15`). All scene dimensions must be whole multiples of it.
- **Capital art:** 1024 × 192 px, tiers `tier-0.png` … `tier-11.png`, in `artifacts/focusquest/public/kingdoms/scenes/capital/`.
- **Capital tier names, exact:** Wilds, Waystation, Camp, Hamlet, Village, Town, Borough, City, Grand City, Metropolis, Crown City, Eternal Capital.
- **Capital tier thresholds, exact:** 0, 1, 150, 400, 1000, 2000, 3500, 6000, 10000, 16000, 25000, 40000.
- **The capital is never part of the balance reading.** `balanceRecentTotal`, `isWorldResting`, and `deriveNeglectInvitation` operate on `BALANCE_KINGDOMS` only.
- **Anti-shame law:** no surface may render a corrective verdict. The capital only ever grows.
- Run api-server tests from `artifacts/api-server`, frontend tests from `artifacts/focusquest`.

## File Structure

| File | Responsibility |
|---|---|
| `artifacts/api-server/src/lib/kingdoms.ts` | **Modify.** Add `capitalLifetime`, `CAPITAL_TIERS`, `capitalTier`, `MAX_CAPITAL_TIER`. |
| `artifacts/api-server/src/lib/kingdoms.test.ts` | **Modify.** Cover the new pure functions + balance-invariant regression. |
| `artifacts/api-server/src/routes/users.ts` | **Modify.** Derive the capital total, use `capitalTier`, return `liveliness: null` for the capital. |
| `lib/api-spec/openapi.yaml` | **Modify.** `liveliness` becomes nullable. |
| `artifacts/focusquest/public/kingdoms/scenes/capital/tier-*.png` | **Replace.** 6 files at 320×192 → 12 files at 1024×192. |
| `artifacts/focusquest/src/lib/kingdom-scene.ts` | **Modify.** `CAPITAL_SCENE_W/H`, `MAX_CAPITAL_TIER`, `sceneSize()`, per-kingdom tier clamp. |
| `artifacts/focusquest/src/lib/kingdom-scene.test.ts` | **Modify.** Per-kingdom image dimension + clamp assertions. |
| `artifacts/focusquest/src/components/kingdom-scene.tsx` | **Modify.** Per-kingdom canvas size; `liveliness: Liveliness \| null`. |
| `artifacts/focusquest/src/components/kingdom-tier-pips.tsx` | **Modify.** Accept a `total` prop instead of a global max. |
| `artifacts/focusquest/src/components/kingdom-map.tsx` | **Modify.** 2-centred / band / 3 layout. |
| `artifacts/focusquest/src/components/kingdom-strip.tsx` | **Modify.** Pass 12 as the capital pip total. |

**Sequencing note:** Task 3 generates placeholder art so the pipeline is testable before Chad's real images land. Chad overwrites the same 12 filenames later; no code changes when he does.

---

### Task 1: Capital grand total (`capitalLifetime`)

**Files:**
- Modify: `artifacts/api-server/src/lib/kingdoms.ts`
- Test: `artifacts/api-server/src/lib/kingdoms.test.ts`

**Interfaces:**
- Consumes: existing `KingdomId`, `KINGDOMS` from the same file.
- Produces: `capitalLifetime(lifetimeByKingdom: Partial<Record<KingdomId, number>>): number`

- [ ] **Step 1: Write the failing test**

Append to `artifacts/api-server/src/lib/kingdoms.test.ts`:

```ts
describe("capitalLifetime", () => {
  it("sums all six rows including the capital's own catch-all", () => {
    expect(capitalLifetime({
      hearth: 1200, wellspring: 300, forge: 3400,
      athenaeum: 60, crossroads: 900, capital: 1100,
    })).toBe(6960);
  });

  it("treats missing rows as zero", () => {
    expect(capitalLifetime({ hearth: 500 })).toBe(500);
    expect(capitalLifetime({})).toBe(0);
  });

  it("counts uncategorized work exactly once", () => {
    // Only the capital row is populated: the total must equal it, not double it.
    expect(capitalLifetime({ capital: 250 })).toBe(250);
  });
});
```

Add `capitalLifetime` to the existing import from `./kingdoms` at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd artifacts/api-server && npx vitest run src/lib/kingdoms.test.ts`
Expected: FAIL — `capitalLifetime is not a function` / import error.

- [ ] **Step 3: Write minimal implementation**

Add to `artifacts/api-server/src/lib/kingdoms.ts`, after `balanceRecentTotal`:

```ts
/**
 * The capital is the realm's grand total: every base point ever earned,
 * including the uncategorized work held in its own row.
 *
 * Derived, never stored. A sum of monotonic values is monotonic, so the
 * capital can never regress, and no backfill is needed for existing users.
 *
 * Deliberately sums ALL SIX ids, not BALANCE_KINGDOMS — this is the one place
 * the capital is included on purpose. It must never be reused as a balance
 * denominator; see balanceRecentTotal for that.
 */
export function capitalLifetime(
  lifetimeByKingdom: Partial<Record<KingdomId, number>>,
): number {
  return KINGDOMS.reduce((sum, k) => sum + (lifetimeByKingdom[k.id] ?? 0), 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd artifacts/api-server && npx vitest run src/lib/kingdoms.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print feat/capital-rework
git add artifacts/api-server/src/lib/kingdoms.ts artifacts/api-server/src/lib/kingdoms.test.ts
git commit -m "feat(kingdoms): derive the capital as the realm grand total"
```

---

### Task 2: 12-tier capital ladder (`capitalTier`) + balance-invariant regression

**Files:**
- Modify: `artifacts/api-server/src/lib/kingdoms.ts`
- Test: `artifacts/api-server/src/lib/kingdoms.test.ts`

**Interfaces:**
- Consumes: `KingdomTierInfo` (existing type: `{ tier: number; name: string; minPoints: number }`), `capitalLifetime` from Task 1.
- Produces: `capitalTier(points: number): KingdomTierInfo`, `MAX_CAPITAL_TIER: 11`, `CAPITAL_TIERS: KingdomTierInfo[]`

- [ ] **Step 1: Write the failing test**

Append to `artifacts/api-server/src/lib/kingdoms.test.ts`:

```ts
describe("capitalTier", () => {
  it("names every stage at its exact threshold", () => {
    expect(capitalTier(0).name).toBe("Wilds");
    expect(capitalTier(1).name).toBe("Waystation");
    expect(capitalTier(150).name).toBe("Camp");
    expect(capitalTier(400).name).toBe("Hamlet");
    expect(capitalTier(1000).name).toBe("Village");
    expect(capitalTier(2000).name).toBe("Town");
    expect(capitalTier(3500).name).toBe("Borough");
    expect(capitalTier(6000).name).toBe("City");
    expect(capitalTier(10000).name).toBe("Grand City");
    expect(capitalTier(16000).name).toBe("Metropolis");
    expect(capitalTier(25000).name).toBe("Crown City");
    expect(capitalTier(40000).name).toBe("Eternal Capital");
  });

  it("stays on the lower stage one point below each threshold", () => {
    expect(capitalTier(149).tier).toBe(1);
    expect(capitalTier(999).tier).toBe(3);
    expect(capitalTier(39999).tier).toBe(10);
  });

  it("caps at tier 11 and never exceeds it", () => {
    expect(capitalTier(40000).tier).toBe(MAX_CAPITAL_TIER);
    expect(capitalTier(10_000_000).tier).toBe(11);
  });

  it("has more stages than the kingdom ladder", () => {
    expect(MAX_CAPITAL_TIER).toBeGreaterThan(5);
    expect(CAPITAL_TIERS).toHaveLength(12);
  });

  it("is monotonic: more points never yields a lower tier", () => {
    let prev = -1;
    for (const p of [0, 1, 150, 400, 1000, 2000, 3500, 6000, 10000, 16000, 25000, 40000, 99999]) {
      const t = capitalTier(p).tier;
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });
});

describe("balance invariant", () => {
  // The capital now accumulates from every quest. If that total ever reaches a
  // balance denominator, uncategorized work silently dilutes every real
  // kingdom's share — the exact failure the original design forbids.
  const recent = { hearth: 100, wellspring: 100, forge: 100, athenaeum: 100, crossroads: 100 };

  it("balanceRecentTotal ignores the capital entirely", () => {
    expect(balanceRecentTotal(recent)).toBe(500);
    expect(balanceRecentTotal({ ...recent, capital: 999999 })).toBe(500);
  });

  it("isWorldResting is unaffected by capital points", () => {
    expect(isWorldResting({ capital: 999999 })).toBe(true);
    expect(isWorldResting({ ...recent, capital: 999999 })).toBe(false);
  });

  it("deriveNeglectInvitation never names the capital", () => {
    const invitation = deriveNeglectInvitation({
      lifetimeByKingdom: { capital: 999999, hearth: 5000 },
      recentByKingdom: { ...recent, hearth: 0, capital: 999999 },
    });
    expect(invitation?.kingdomId).not.toBe("capital");
  });

  it("a huge capital total does not change any kingdom's liveliness", () => {
    const total = balanceRecentTotal({ ...recent, capital: 999999 });
    expect(deriveLiveliness(100, total)).toBe("steady");
  });
});
```

Add `capitalTier`, `MAX_CAPITAL_TIER`, `CAPITAL_TIERS` to the import from `./kingdoms`. Ensure `balanceRecentTotal`, `isWorldResting`, `deriveNeglectInvitation`, `deriveLiveliness` are also imported.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd artifacts/api-server && npx vitest run src/lib/kingdoms.test.ts`
Expected: FAIL — `capitalTier is not a function`. The `balance invariant` block should already PASS (it pins existing behaviour).

- [ ] **Step 3: Write minimal implementation**

Add to `artifacts/api-server/src/lib/kingdoms.ts`, after `kingdomTier`:

```ts
export const MAX_CAPITAL_TIER = 11;

/**
 * The capital's own ladder, twelve stages deep. Separate from KINGDOM_TIERS
 * because the capital accumulates roughly 5-6x faster than any single kingdom:
 * it is the sum of all of them. Tier 7 lands near "all five at Village" and
 * tier 11 near "all five at Stronghold", so the top of the ladder means
 * something specific rather than being an arbitrary ceiling.
 *
 * Absolute thresholds, never relative to the user's own history - same
 * discipline as KINGDOM_TIERS and for the same reason.
 */
export const CAPITAL_TIERS: KingdomTierInfo[] = [
  { tier: 11, name: "Eternal Capital", minPoints: 40000 },
  { tier: 10, name: "Crown City",      minPoints: 25000 },
  { tier: 9,  name: "Metropolis",      minPoints: 16000 },
  { tier: 8,  name: "Grand City",      minPoints: 10000 },
  { tier: 7,  name: "City",            minPoints: 6000 },
  { tier: 6,  name: "Borough",         minPoints: 3500 },
  { tier: 5,  name: "Town",            minPoints: 2000 },
  { tier: 4,  name: "Village",         minPoints: 1000 },
  { tier: 3,  name: "Hamlet",          minPoints: 400 },
  { tier: 2,  name: "Camp",            minPoints: 150 },
  { tier: 1,  name: "Waystation",      minPoints: 1 },
  { tier: 0,  name: "Wilds",           minPoints: 0 },
];

export function capitalTier(points: number): KingdomTierInfo {
  for (const t of CAPITAL_TIERS) {
    if (points >= t.minPoints) return t;
  }
  return CAPITAL_TIERS[CAPITAL_TIERS.length - 1]!;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd artifacts/api-server && npx vitest run src/lib/kingdoms.test.ts`
Expected: PASS, all blocks.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add artifacts/api-server/src/lib/kingdoms.ts artifacts/api-server/src/lib/kingdoms.test.ts
git commit -m "feat(kingdoms): add the 12-stage capital ladder and pin the balance invariant"
```

---

### Task 3: Placeholder capital art (12 × 1024×192)

Unblocks every frontend task. Chad overwrites these same 12 filenames with real art later — no code changes when he does.

**Files:**
- Create: `artifacts/focusquest/scripts/generate-capital-placeholders.mjs`
- Replace: `artifacts/focusquest/public/kingdoms/scenes/capital/tier-0.png` … `tier-11.png`

**Interfaces:**
- Consumes: nothing.
- Produces: 12 PNG files, each exactly 1024×192.

- [ ] **Step 1: Write the generator**

Create `artifacts/focusquest/scripts/generate-capital-placeholders.mjs`:

```js
// Placeholder capital bands so the scene pipeline is testable before the real
// art lands. Overwritten by hand-drawn 1024x192 images; delete this script once
// all twelve are final.
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const W = 1024, H = 192, DIR = path.resolve(import.meta.dirname, "../public/kingdoms/scenes/capital");
const SAFE_X0 = 256, SAFE_X1 = 768;

fs.mkdirSync(DIR, { recursive: true });

for (let tier = 0; tier <= 11; tier++) {
  const png = new PNG({ width: W, height: H });
  const growth = tier / 11;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = ((W * y) + x) << 2;
      const inSafe = x >= SAFE_X0 && x < SAFE_X1;
      const ground = y > H * (0.62 - growth * 0.12);
      png.data[i]     = ground ? 40 + growth * 60 : 26;
      png.data[i + 1] = ground ? 60 + growth * 70 : 32;
      png.data[i + 2] = ground ? 70 + growth * 50 : 54;
      png.data[i + 3] = 255;
      // Safe-zone markers so cropping is obvious during development.
      if (inSafe && (y < 2 || y >= H - 2)) { png.data[i] = 255; png.data[i+1] = 190; png.data[i+2] = 80; }
      if (x === SAFE_X0 || x === SAFE_X1 - 1) { png.data[i] = 255; png.data[i+1] = 190; png.data[i+2] = 80; }
    }
  }
  // Crude "buildings": one block per tier, inside the safe zone.
  for (let b = 0; b < tier; b++) {
    const bw = 28, bh = 24 + b * 4;
    const bx = SAFE_X0 + 24 + b * 40, by = H - 34 - bh;
    for (let y = by; y < by + bh; y++) {
      for (let x = bx; x < bx + bw; x++) {
        const i = ((W * y) + x) << 2;
        png.data[i] = 120; png.data[i + 1] = 130; png.data[i + 2] = 190; png.data[i + 3] = 255;
      }
    }
  }
  fs.writeFileSync(path.join(DIR, `tier-${tier}.png`), PNG.sync.write(png));
}
console.log("wrote 12 capital placeholders at 1024x192");
```

- [ ] **Step 2: Remove the six stale 320×192 capital images and generate**

```bash
cd artifacts/focusquest
rm -f public/kingdoms/scenes/capital/tier-*.png
node scripts/generate-capital-placeholders.mjs
```

Expected: `wrote 12 capital placeholders at 1024x192`

- [ ] **Step 3: Verify dimensions**

```bash
cd artifacts/focusquest
node -e "const s=require('sharp');(async()=>{for(let t=0;t<=11;t++){const m=await s('public/kingdoms/scenes/capital/tier-'+t+'.png').metadata();console.log(t,m.width+'x'+m.height);}})()"
```

Expected: twelve lines, each `1024x192`.

- [ ] **Step 4: Commit**

```bash
git branch --show-current
git add artifacts/focusquest/scripts/generate-capital-placeholders.mjs artifacts/focusquest/public/kingdoms/scenes/capital/
git commit -m "chore(kingdoms): placeholder 1024x192 capital bands for all 12 tiers"
```

---

### Task 4: Route — derived total, capital ladder, nullable liveliness

**Files:**
- Modify: `lib/api-spec/openapi.yaml:2416-2433`
- Modify: `artifacts/api-server/src/routes/users.ts:189-242`

**Interfaces:**
- Consumes: `capitalLifetime` (Task 1), `capitalTier`, `MAX_CAPITAL_TIER` (Task 2).
- Produces: `GET /api/users/me/kingdoms` where the capital's `lifetimePoints` is the grand total, `tier` is 0–11, `tierName` is a capital stage name, and `liveliness` is `null`. The five kingdoms are unchanged and always populate `liveliness`.

- [ ] **Step 1: Make `liveliness` nullable in the OpenAPI spec**

In `lib/api-spec/openapi.yaml`, the `KingdomState` schema. Change:

```yaml
        liveliness:
          type: string
          enum: [dormant, stirring, steady, bustling]
```

to:

```yaml
        liveliness:
          type: string
          enum: [dormant, stirring, steady, bustling]
          nullable: true
          description: >-
            Share of recent activity. Null for the capital, which is a
            cumulative lifetime total and has no share to report.
```

Leave `liveliness` in the `required` list — the key is always present, its value may be null.

- [ ] **Step 2: Regenerate the client**

```bash
cd C:/Users/Chadr/OneDrive/Documents/Quest-Companion
pnpm codegen
```

Expected: `lib/api-client-react/src/generated/api.schemas.ts` now types `liveliness` as nullable.

Verify:
```bash
grep -n "liveliness" lib/api-client-react/src/generated/api.schemas.ts
```
Expected: the field's type includes `| null`.

- [ ] **Step 3: Write the failing route assertion**

The kingdoms route has no existing route-level test file. Add `artifacts/api-server/src/lib/kingdoms-route.test.ts` covering the payload-shaping logic as a pure unit, mirroring what the route does:

```ts
import { describe, it, expect } from "vitest";
import {
  KINGDOMS, kingdomTier, capitalTier, capitalLifetime, deriveLiveliness,
  balanceRecentTotal, type KingdomId,
} from "./kingdoms";

/** Mirrors the shaping in routes/users.ts GET /users/me/kingdoms. */
function shape(
  lifetimeByKingdom: Partial<Record<KingdomId, number>>,
  recentByKingdom: Partial<Record<KingdomId, number>>,
) {
  const total = balanceRecentTotal(recentByKingdom);
  return KINGDOMS.map((k) => {
    const lifetime = k.isCapital ? capitalLifetime(lifetimeByKingdom) : (lifetimeByKingdom[k.id] ?? 0);
    const t = k.isCapital ? capitalTier(lifetime) : kingdomTier(lifetime);
    return {
      id: k.id,
      lifetimePoints: lifetime,
      tier: t.tier,
      tierName: t.name,
      liveliness: k.isCapital ? null : deriveLiveliness(recentByKingdom[k.id] ?? 0, total),
    };
  });
}

describe("kingdoms payload", () => {
  const lifetime = { hearth: 1200, wellspring: 300, forge: 3400, athenaeum: 60, crossroads: 900, capital: 1100 };

  it("reports the capital as the grand total on its own ladder", () => {
    const capital = shape(lifetime, {}).find((k) => k.id === "capital")!;
    expect(capital.lifetimePoints).toBe(6960);
    expect(capital.tier).toBe(7);
    expect(capital.tierName).toBe("City");
  });

  it("returns null liveliness for the capital only", () => {
    const rows = shape(lifetime, { hearth: 100, forge: 100 });
    expect(rows.find((k) => k.id === "capital")!.liveliness).toBeNull();
    for (const k of rows.filter((r) => r.id !== "capital")) {
      expect(k.liveliness).not.toBeNull();
    }
  });

  it("leaves the five kingdoms on their own 6-tier ladder", () => {
    const forge = shape(lifetime, {}).find((k) => k.id === "forge")!;
    expect(forge.lifetimePoints).toBe(3400);
    expect(forge.tierName).toBe("Town");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd artifacts/api-server && npx vitest run src/lib/kingdoms-route.test.ts`
Expected: FAIL — the route file doesn't exist yet is fine; this tests the pure shaping, so it should fail only if Tasks 1–2 are incomplete. If Tasks 1–2 are done it will PASS immediately; that is acceptable, it is a characterization test for Step 5.

- [ ] **Step 5: Update the route**

In `artifacts/api-server/src/routes/users.ts`, extend the import from `../lib/kingdoms` to include `capitalLifetime` and `capitalTier`. Then replace the `kingdoms: KINGDOMS.map(...)` block (currently lines ~219-239) with:

```ts
    kingdoms: KINGDOMS.map((k) => {
      // The capital is the realm's grand total on its own 12-stage ladder; the
      // five balance kingdoms each report only their own lifetime on the
      // 6-stage ladder.
      const lifetime = k.isCapital
        ? capitalLifetime(lifetimeByKingdom)
        : (lifetimeByKingdom[k.id] ?? 0);
      const t = k.isCapital ? capitalTier(lifetime) : kingdomTier(lifetime);
      return {
        id: k.id,
        name: k.name,
        isCapital: k.isCapital,
        lifetimePoints: lifetime,
        tier: t.tier,
        tierName: t.name,
        // Null, not a fabricated value: liveliness is a share of recent
        // activity, and a cumulative total has no share to report. The old
        // special-case denominator here produced a number no surface could
        // interpret.
        liveliness: k.isCapital ? null : deriveLiveliness(recentByKingdom[k.id] ?? 0, total),
      };
    }),
```

- [ ] **Step 6: Run the full api-server suite**

Run: `cd artifacts/api-server && npx vitest run`
Expected: PASS, 504+ tests (501 baseline + the new ones).

- [ ] **Step 7: Typecheck**

Run: `cd C:/Users/Chadr/OneDrive/Documents/Quest-Companion && pnpm typecheck`
Expected: exit 0. If the frontend fails here on a null `liveliness`, that is expected — Task 5 fixes it. Note the failures and continue.

- [ ] **Step 8: Commit**

```bash
git branch --show-current
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated artifacts/api-server/src/routes/users.ts artifacts/api-server/src/lib/kingdoms-route.test.ts
git commit -m "feat(kingdoms): serve the capital as a grand total with null liveliness"
```

---

### Task 5: Scene seam — per-kingdom dimensions and tier ceilings

**Files:**
- Modify: `artifacts/focusquest/src/lib/kingdom-scene.ts`
- Test: `artifacts/focusquest/src/lib/kingdom-scene.test.ts:26-42`

**Interfaces:**
- Consumes: `TILE` from `./kingdom-sprites`.
- Produces: `CAPITAL_SCENE_W = 1024`, `CAPITAL_SCENE_H = 192`, `MAX_CAPITAL_TIER = 11`, `sceneSize(kingdomId: string): { w: number; h: number }`, `maxTierFor(kingdomId: string): number`. `SCENE_W`/`SCENE_H`/`MAX_KINGDOM_TIER` keep their current values and meaning for the five kingdoms.

- [ ] **Step 1: Write the failing test**

In `artifacts/focusquest/src/lib/kingdom-scene.test.ts`, replace the `resolves static tier scene images for all six kingdoms` test and the `clamps static scene image tiers` test with:

```ts
  it("resolves static tier scene images at each kingdom's own size", async () => {
    for (const id of SCENE_KINGDOM_IDS) {
      const { w, h } = sceneSize(id);
      for (let tier = 0; tier <= maxTierFor(id); tier++) {
        const url = resolveSceneImageUrl(id, tier);
        expect(url).toBe(`/kingdoms/scenes/${id}/tier-${tier}.png`);

        const file = path.resolve(__dirname, "../../public", url!.slice(1));
        const meta = await sharp(file).metadata();
        expect(`${meta.width}x${meta.height}`, `${id} tier ${tier}`).toBe(`${w}x${h}`);
      }
    }
  });

  it("gives the capital a wider band and a deeper ladder than the kingdoms", () => {
    expect(sceneSize("capital")).toEqual({ w: CAPITAL_SCENE_W, h: CAPITAL_SCENE_H });
    expect(sceneSize("hearth")).toEqual({ w: SCENE_W, h: SCENE_H });
    expect(maxTierFor("capital")).toBe(11);
    expect(maxTierFor("hearth")).toBe(5);
  });

  it("keeps every scene dimension a whole multiple of TILE", () => {
    for (const id of SCENE_KINGDOM_IDS) {
      const { w, h } = sceneSize(id);
      expect(w % TILE, `${id} width`).toBe(0);
      expect(h % TILE, `${id} height`).toBe(0);
    }
  });

  it("clamps static scene image tiers per kingdom", () => {
    expect(resolveSceneImageUrl("hearth", -10)).toBe("/kingdoms/scenes/hearth/tier-0.png");
    expect(resolveSceneImageUrl("hearth", 99)).toBe("/kingdoms/scenes/hearth/tier-5.png");
    expect(resolveSceneImageUrl("capital", 99)).toBe("/kingdoms/scenes/capital/tier-11.png");
    expect(resolveSceneImageUrl("capital", -1)).toBe("/kingdoms/scenes/capital/tier-0.png");
    expect(resolveSceneImageUrl("atlantis", 3)).toBeNull();
  });
```

Update the imports at the top of the test file to add `sceneSize`, `maxTierFor`, `CAPITAL_SCENE_W`, `CAPITAL_SCENE_H` from `./kingdom-scene`, and `TILE` to the existing `./kingdom-sprites` import.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd artifacts/focusquest && npx vitest run src/lib/kingdom-scene.test.ts`
Expected: FAIL — `sceneSize is not a function`.

- [ ] **Step 3: Write the implementation**

In `artifacts/focusquest/src/lib/kingdom-scene.ts`, after the existing `MAX_KINGDOM_TIER`:

```ts
/** The capital is a full-width band, not a tile: it is the only scene whose
 *  art fills the content column, so it has its own dimensions and its own
 *  deeper ladder. Both values stay whole multiples of TILE. */
export const CAPITAL_SCENE_W = 1024;
export const CAPITAL_SCENE_H = 192;
export const MAX_CAPITAL_TIER = 11;

export function sceneSize(kingdomId: string): { w: number; h: number } {
  return kingdomId === "capital"
    ? { w: CAPITAL_SCENE_W, h: CAPITAL_SCENE_H }
    : { w: SCENE_W, h: SCENE_H };
}

export function maxTierFor(kingdomId: string): number {
  return kingdomId === "capital" ? MAX_CAPITAL_TIER : MAX_KINGDOM_TIER;
}
```

Then change `resolveSceneImageUrl` to clamp per kingdom:

```ts
export function resolveSceneImageUrl(kingdomId: string, tier: number): string | null {
  if (!SCENE_KINGDOM_IDS.includes(kingdomId as (typeof SCENE_KINGDOM_IDS)[number])) return null;
  const safeTier = Math.max(0, Math.min(maxTierFor(kingdomId), Math.trunc(tier)));
  return `/kingdoms/scenes/${kingdomId}/tier-${safeTier}.png`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd artifacts/focusquest && npx vitest run src/lib/kingdom-scene.test.ts`
Expected: PASS. The image-dimension test now reads the 12 placeholder bands from Task 3.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add artifacts/focusquest/src/lib/kingdom-scene.ts artifacts/focusquest/src/lib/kingdom-scene.test.ts
git commit -m "feat(kingdoms): per-kingdom scene dimensions and tier ceilings"
```

---

### Task 6: Renderer — per-kingdom canvas, null liveliness

**Files:**
- Modify: `artifacts/focusquest/src/components/kingdom-scene.tsx`

**Interfaces:**
- Consumes: `sceneSize`, `resolveSceneImageUrl`, `Liveliness` from `@/lib/kingdom-scene`.
- Produces: `<KingdomScene kingdomId tier liveliness={Liveliness | null} width? className? label? />`. `liveliness={null}` means "no reading": full-opacity art, no overlay painted.

- [ ] **Step 1: Widen the liveliness type and size the canvas per kingdom**

In `artifacts/focusquest/src/components/kingdom-scene.tsx`:

Change the prop type from `liveliness: Liveliness;` to:

```ts
  /** Null means "no reading" — full art, no overlay. The capital uses this:
   *  liveliness is a share of recent activity, and a cumulative total has no
   *  share. Previously the capital passed a fake "steady" to avoid dimming. */
  liveliness: Liveliness | null;
```

Change `describeKingdom` to tolerate null:

```ts
function describeKingdom(kingdomId: string, tier: number, liveliness: Liveliness | null): string {
  const name = kingdomId.charAt(0).toUpperCase() + kingdomId.slice(1);
  const tierPhrase = TIER_PHRASE[tier] ?? TIER_PHRASE[0];
  if (liveliness === null) return `${name}, ${tierPhrase}`;
  const livelinessPhrase = LIVELINESS_PHRASE[liveliness] ?? LIVELINESS_PHRASE.dormant;
  return `${name}, ${tierPhrase}, ${livelinessPhrase} right now`;
}
```

Change `paintLivelinessOverlay` to take explicit dimensions and early-return on null:

```ts
function paintLivelinessOverlay(
  ctx: CanvasRenderingContext2D,
  liveliness: Liveliness | null,
  tier: number,
  w: number,
  h: number,
) {
  if (liveliness === null) return;
  switch (liveliness) {
    case "dormant":
      ctx.fillStyle = "rgba(12, 20, 42, 0.36)";
      ctx.fillRect(0, 0, w, h);
      if (tier > 0) {
        const glow = ctx.createRadialGradient(238, 124, 1, 238, 124, 28);
        glow.addColorStop(0, "rgba(255, 218, 142, 0.8)");
        glow.addColorStop(1, "rgba(255, 218, 142, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(210, 96, 56, 56);
      }
      break;
    case "stirring":
      ctx.fillStyle = "rgba(255, 197, 118, 0.1)";
      ctx.fillRect(0, 0, w, h);
      break;
    case "steady":
      break;
    case "bustling":
      ctx.fillStyle = "rgba(255, 218, 128, 0.12)";
      ctx.fillRect(0, 0, w, h);
      if (tier > 0) {
        ctx.fillStyle = "rgba(255, 235, 170, 0.55)";
        for (const [x, y] of [[54, 136], [148, 122], [250, 138]]) {
          ctx.fillRect(x, y, 3, 3);
        }
      }
      break;
  }
}
```

In the component body, replace the hardcoded `SCENE_W`/`SCENE_H` usages. Change the import to pull `sceneSize` instead of `SCENE_W, SCENE_H`, then:

```ts
  const { w: sceneW, h: sceneH } = sceneSize(kingdomId);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cancelled = false;

    (async () => {
      const url = resolveSceneImageUrl(kingdomId, tier);
      if (!url) return;

      const result = await Promise.allSettled([loadImage(url)]);
      if (cancelled) return;

      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, sceneW, sceneH);

      const loaded = result[0];
      if (loaded?.status === "fulfilled") {
        ctx.drawImage(loaded.value, 0, 0, sceneW, sceneH);
        paintLivelinessOverlay(ctx, liveliness, tier, sceneW, sceneH);
      }
      ctx.globalAlpha = 1;
    })();

    return () => { cancelled = true; };
  }, [kingdomId, tier, liveliness, sceneW, sceneH]);
```

And the returned element:

```tsx
    <canvas
      ref={ref}
      width={sceneW}
      height={sceneH}
      className={className}
      style={{
        ...(width !== undefined ? { width, height: (width * sceneH) / sceneW } : undefined),
        imageRendering: "pixelated",
      }}
      role="img"
      aria-label={label ?? describeKingdom(kingdomId, tier, liveliness)}
    />
```

- [ ] **Step 2: Typecheck**

Run: `cd artifacts/focusquest && npx tsc --noEmit -p tsconfig.json`
Expected: errors ONLY in `kingdom-map.tsx` / `kingdom-strip.tsx` where `liveliness` is still passed as non-null. Tasks 7–9 fix those.

- [ ] **Step 3: Commit**

```bash
git branch --show-current
git add artifacts/focusquest/src/components/kingdom-scene.tsx
git commit -m "feat(kingdoms): size the scene canvas per kingdom and allow null liveliness"
```

---

### Task 7: Tier pips take a total

**Files:**
- Modify: `artifacts/focusquest/src/components/kingdom-tier-pips.tsx`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `<KingdomTierPips tier={number} total={number} className? />`. `total` is the number of pips rendered; callers pass `MAX_CAPITAL_TIER` (11) + 1 = 12 for the capital.

- [ ] **Step 1: Replace the global max with a prop**

Rewrite `artifacts/focusquest/src/components/kingdom-tier-pips.tsx`:

```tsx
/**
 * Filled-pip readout of a kingdom's position on its tier ladder.
 *
 * This is the capital's visual grammar on BOTH surfaces, and it is deliberately
 * not the liveliness bar the five balance kingdoms use: pips count accumulated
 * structure, which only ever grows, where a liveliness bar reports a share of
 * recent activity. Keeping the two languages distinct is what stops the capital
 * reading as a sixth life area.
 *
 * `total` is a prop rather than a module constant because the capital's ladder
 * is twelve stages deep while the kingdoms' is six.
 */
export function KingdomTierPips({
  tier, total, className = "",
}: {
  tier: number;
  total: number;
  className?: string;
}) {
  return (
    <span className={`flex items-center gap-[3px] ${className}`} aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-1 w-1 rounded-full ${i < tier ? "bg-muted-foreground/70" : "bg-muted-foreground/20"}`}
        />
      ))}
    </span>
  );
}
```

Note the `MAX_KINGDOM_TIER` import is now unused — delete it.

- [ ] **Step 2: Typecheck**

Run: `cd artifacts/focusquest && npx tsc --noEmit -p tsconfig.json`
Expected: errors in `kingdom-map.tsx` and `kingdom-strip.tsx` for the missing `total` prop. Fixed in Tasks 8–9.

- [ ] **Step 3: Commit**

```bash
git branch --show-current
git add artifacts/focusquest/src/components/kingdom-tier-pips.tsx
git commit -m "refactor(kingdoms): let tier pips render a variable ladder length"
```

---

### Task 8: Insights layout — 2 centred / band / 3

**Files:**
- Modify: `artifacts/focusquest/src/components/kingdom-map.tsx`

**Interfaces:**
- Consumes: `KingdomScene` (Task 6), `KingdomTierPips` (Task 7), `MAX_CAPITAL_TIER` (Task 5).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Rewrite the layout**

Replace the capital block and the kingdom grid in `artifacts/focusquest/src/components/kingdom-map.tsx`. The section body becomes:

```tsx
      {/* Top pair, centred over the band. All five tiles are the SAME size:
          sizing tiles by activity would rank the user's life areas against each
          other and visibly shrink one the week they stepped away from it. */}
      {/* Six columns, not three: centring two tiles over a three-wide row needs
          half-column offsets, so the pair spans 2/6 each with a 1/6 spacer on
          either side. That makes every tile exactly 1/3 of the content width,
          matching the bottom row. A leading spacer in a 3-column grid would
          right-align the pair, not centre it. */}
      <div className="grid gap-3 sm:grid-cols-6">
        <div className="hidden sm:block" />
        {kingdoms.slice(0, 2).map((k) => (
          <div key={k.id} className="sm:col-span-2">
            <KingdomTile k={k} worldResting={data.worldResting} />
          </div>
        ))}
        <div className="hidden sm:block" />
      </div>

      {capital && (
        // Fixed height + object-cover: the band fills the content column at
        // every width, so its aspect ratio swings 3x between phone and desktop.
        // The art is authored 1024x192 with the composition in the centre 512px;
        // the outer quarters crop away on narrow viewports.
        <div className="relative rounded-lg border border-border overflow-hidden h-32 sm:h-40 lg:h-48">
          <KingdomScene
            kingdomId={capital.id}
            tier={capital.tier}
            liveliness={null}
            label={`The Capital, ${capital.tier > 0 ? capital.tierName.toLowerCase() : "not yet founded"}`}
            className="w-full h-full block object-cover object-center"
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/85 to-transparent px-3 pt-10 pb-2.5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">Seat of the realm</p>
                <p className="text-base font-medium leading-tight">The Capital</p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {capital.tier > 0 ? capital.tierName : "Unfounded"}
                </span>
                <KingdomTierPips tier={capital.tier} total={MAX_CAPITAL_TIER + 1} />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {kingdoms.slice(2).map((k) => (
          <KingdomTile key={k.id} k={k} worldResting={data.worldResting} />
        ))}
      </div>
```

Add the tile subcomponent above `KingdomMap` in the same file:

```tsx
function KingdomTile({
  k, worldResting,
}: {
  k: { id: string; name: string; tier: number; tierName: string; liveliness: Liveliness | null };
  worldResting: boolean;
}) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* The cast is required: the generated KingdomStateLiveliness and the
          local Liveliness are structurally identical but nominally distinct. */}
      <KingdomScene
        kingdomId={k.id}
        tier={k.tier}
        liveliness={(worldResting ? "stirring" : k.liveliness) as Liveliness | null}
        className="w-full block"
      />
      <div className="p-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium truncate">{k.name}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">{k.tierName}</span>
      </div>
    </div>
  );
}
```

Update the imports at the top of the file:

```tsx
import { useGetKingdoms } from "@workspace/api-client-react";
import { KingdomScene } from "@/components/kingdom-scene";
import { KingdomTierPips } from "@/components/kingdom-tier-pips";
import { MAX_CAPITAL_TIER, type Liveliness } from "@/lib/kingdom-scene";
```

Also update the component's doc comment to describe the new arrangement:

```tsx
/**
 * The full map. Sits directly above the category breakdown on /insights so the
 * two read as the same data — the map is the felt version, the breakdown the
 * precise one.
 *
 * Two kingdoms centred above the capital band, three below it. All five tiles
 * are the same size on purpose: the capital is the only element with a
 * different weight, because it is the only one measuring something different
 * (a lifetime total, not a share of recent activity).
 */
```

- [ ] **Step 2: Typecheck**

Run: `cd artifacts/focusquest && npx tsc --noEmit -p tsconfig.json`
Expected: errors only in `kingdom-strip.tsx` now (Task 9).

- [ ] **Step 3: Commit**

```bash
git branch --show-current
git add artifacts/focusquest/src/components/kingdom-map.tsx
git commit -m "feat(kingdoms): 2-over-band-over-3 insights layout with the capital band"
```

---

### Task 9: Dashboard strip — 12-stage capital, then full verification

**Files:**
- Modify: `artifacts/focusquest/src/components/kingdom-strip.tsx`

**Interfaces:**
- Consumes: `KingdomTierPips` (Task 7), `MAX_CAPITAL_TIER` (Task 5).
- Produces: nothing.

- [ ] **Step 1: Pass the capital's ladder length and guard null liveliness**

In `artifacts/focusquest/src/components/kingdom-strip.tsx`, add the import:

```tsx
import { MAX_CAPITAL_TIER } from "@/lib/kingdom-scene";
```

The five-kingdom map already overrides liveliness when the world is resting; make the fallback explicit so a null can never index the lookup:

```tsx
          const liveliness = data.worldResting ? "stirring" : (k.liveliness ?? "dormant");
```

And pass the total to the pips:

```tsx
          <KingdomTierPips tier={capital.tier} total={MAX_CAPITAL_TIER + 1} className="shrink-0" />
```

- [ ] **Step 2: Typecheck the whole workspace**

Run: `cd C:/Users/Chadr/OneDrive/Documents/Quest-Companion && pnpm typecheck`
Expected: exit 0, no errors.

- [ ] **Step 3: Run both suites**

```bash
cd artifacts/focusquest && npx vitest run
cd ../api-server && npx vitest run
```
Expected: both PASS. Frontend 160+, api-server 501+.

- [ ] **Step 4: Verify in the browser**

Start the preview and drive `/insights`:

```
preview_start { name: "frontend" }
```

Then, at viewport widths 375, 800, and 1280, confirm:
- the band fills the full content width at every size and its height is 128 / 160 / 192;
- the top two tiles are centred above the band, three sit below, and all five are the same size;
- the page never scrolls horizontally;
- the capital's aria-label reads `The Capital, <stage name>` with no liveliness phrase.

Read the console for errors (`read_console_messages`) and confirm none.

**Note:** screenshot capture has been unreliable in this environment (30s timeouts). If it fails, verify geometry with `javascript_tool` by reading `getBoundingClientRect()` on the band and tiles rather than skipping verification.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add artifacts/focusquest/src/components/kingdom-strip.tsx
git commit -m "feat(kingdoms): show the capital's 12-stage ladder on the dashboard strip"
```

---

### Task 10: Swap in the real art (blocked on Chad)

**Files:**
- Replace: `artifacts/focusquest/public/kingdoms/scenes/capital/tier-0.png` … `tier-11.png`
- Delete: `artifacts/focusquest/scripts/generate-capital-placeholders.mjs`

- [ ] **Step 1: Drop the 12 hand-drawn 1024×192 bands into place, same filenames**

- [ ] **Step 2: Verify dimensions**

Run: `cd artifacts/focusquest && npx vitest run src/lib/kingdom-scene.test.ts`
Expected: PASS. The dimension assertion fails loudly if any image is not exactly 1024×192.

- [ ] **Step 3: Check the safe zone on a real phone viewport**

Load `/insights` at 375px wide and confirm the capital still reads as a place — the centre 512px of each band must carry the composition.

- [ ] **Step 4: Delete the placeholder generator and commit**

```bash
git branch --show-current
git rm artifacts/focusquest/scripts/generate-capital-placeholders.mjs
git add artifacts/focusquest/public/kingdoms/scenes/capital/
git commit -m "feat(kingdoms): final capital band art for all 12 stages"
```
