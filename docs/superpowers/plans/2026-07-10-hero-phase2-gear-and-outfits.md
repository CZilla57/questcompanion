# Hero Phase 2 — Gear-on-Body & Class Outfits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make equipped gear and class outfits visibly render on the layered hero, driven by an extended LPC build pipeline, a code-defined gear roster + idempotent seed, and one UI flip.

**Architecture:** The compositor (`resolveLayers` + `PixelHero`) already supports `outfit:*`/`gear:*` layers and the rarity tint pass. This plan supplies the missing pieces: (1) extend `scripts/src/build-lpc-assets.ts` with a curation manifest that reads LPC `sheet_definitions/**/*.json` to export baked class outfits and per-build gear archetype sprites (with auto-attribution); (2) regenerate `catalog.ts` + `CREDITS.csv`; (3) a code-defined gear roster + idempotent seed that backfills `gear_items.spriteId`; (4) return `spriteId` from the store API; (5) flip the hardcoded `equipped: []` in the Hero page and add a credits view. Engagement FX are deferred to Phase 3.

**Tech Stack:** pnpm monorepo; Node + `pngjs` for asset compositing (Windows has no Pillow/ImageMagick); Drizzle + Neon Postgres (drizzle-kit push, no migration files); Express API; React + Vite + vitest (focusquest package only); OpenAPI + Orval codegen.

## Global Constraints

- **Art = assets only, never LPC generator code** (GPL). Attribution is mandatory: every bundled `public/lpc/**` PNG must have a `catalog.ts` entry with author/license/sourceUrl and a `CREDITS.csv` row. Pull attribution from each def's `credits` block.
- **Builds are exactly two:** `male`, `female`. Every outfit and gear archetype must export a sprite for **both** builds.
- **Rarity is a runtime tint, never baked.** `spriteId` identifies the archetype *shape*; multiple items share one. Signature legendaries get a dedicated `spriteId`.
- **Z-order bands (catalog `zIndex`):** `aura=5, body=10, hair=30, outfit=40, boots=50, armor=60, helmet=70, weapon=80, accessory=90`. (Matches `resolve-layers.test.ts`.)
- **Native frame:** 64×64, south standing frame cropped from `walk.png` at row `y=128` (existing `cropSouth`).
- **`catalog.ts` is generated** — never hand-edit; regenerate via `pnpm --filter @workspace/scripts build-lpc`.
- **Codegen:** after editing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec codegen` (never hand-edit `*/src/generated`).
- **DB push:** after editing `lib/db/src/schema/*`, run `pnpm --filter @workspace/db push`. GOTCHA: `drizzle.config.ts` does not load `.env` — export first: `export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"`.
- **Tests:** `pnpm --filter @workspace/focusquest test` (vitest is focusquest-only; there is no api-server test runner).
- **Typecheck gate:** `pnpm typecheck` (root). Windows CRLF warnings on commit are harmless.
- **Commits:** end each message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Work on branch `feat/hero-phase2-gear-outfits` (already created).

## LPC path model (reference for Tasks 1–3)

A `sheet_definitions/**/*.json` def has one or more `layer_N` objects. Each carries a `zPos` and per-body-type path prefixes (`male`/`female`/`teen`), e.g. `"torso/chainmail/male/"`. The PNG resolves as (**corrected empirically in Task 1 — `loadDefFrame` already implements this**):
- **Variant-based def** (has a `variants: string[]` of color names, e.g. tunic): `spritesheets/{prefix}walk/{variant}.png` — note `walk` is a *directory* and the pre-colored sheet is named by variant. (NOT `{prefix}{variant}/walk.png`, which 404s.)
- **Palette/recolor def** (no `variants`, has `recolors`, e.g. chainmail metal / longsleeve): `spritesheets/{prefix}walk.png` (single base sheet).
- Attribution: `defCredit` unions **all** `credits[]` blocks of a def (Task 1 fix), so asymmetric per-body-type credits are never omitted.

Two known wrinkles the spike (Task 1) must confirm empirically:
1. A def may have **only one** body-type key (e.g. `torso_clothes_tunic` is female-only) — the resolver must throw a clear error so the manifest can supply a per-build override.
2. The leaf `walk.png` location (bare `{prefix}walk.png` vs `{prefix}{variant}/walk.png`) — confirm by listing `spritesheets/{prefix}` via the GitHub contents API if a fetch 404s.

**Verified def paths (relative to `sheet_definitions/`)** for use in the manifests:
- Torso: `torso/shirts/torso_clothes_tunic.json` (female-only, variants), `torso/shirts/torso_clothes_robe.json` (robe), `torso/torso_chainmail.json` (metal), `torso/armour/torso_armour_leather.json`, `torso/armour/torso_armour_plate.json`, `torso/armour/torso_armour_legion.json`.
- Legs: `legs/pants/legs_pants.json`, `legs/pants/legs_pantaloons.json`, `legs/legs_armour.json`.
- Feet: `feet/shoes/feet_shoes_basic.json`, `feet/feet_armour.json`, `feet/feet_sandals.json`.
- Weapons: `weapons/sword/weapon_sword_arming.json`, `weapons/sword/weapon_sword_longsword.json`, `weapons/sword/weapon_sword_katana.json`, `weapons/magic/weapon_magic_gnarled.json` (staff), `weapons/magic/weapon_magic_wand.json`, `weapons/ranged/weapon_ranged_crossbow.json`.
- Headwear: `headwear/helmets/helmets/` (dir — list to pick a helm def), `headwear/hats/` (dir), `headwear/coverings/` (hoods).

To list a directory when finalizing a def choice:
`curl -s "https://api.github.com/repos/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/contents/sheet_definitions/<path>" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>JSON.parse(s).forEach(e=>console.log(e.type,e.name)))"`

---

### Task 1: Pipeline spike — one outfit + one gear archetype, both builds, on-body

Proves outfit compositing and gear-sprite export end-to-end before volume curation. Scope: fighter t0 outfit (shirt+pants+shoes) and the `sword` weapon archetype, for male **and** female.

**Files:**
- Modify: `scripts/src/build-lpc-assets.ts` (add manifest types, def resolver, outfit + gear builders, z-bands, main() calls)
- Regenerates: `artifacts/focusquest/public/lpc/outfit/*`, `artifacts/focusquest/public/lpc/gear/*`, `artifacts/focusquest/src/lib/hero/catalog.ts`, `artifacts/focusquest/public/lpc/CREDITS.csv`
- Test: `artifacts/focusquest/src/lib/hero/resolve-layers.test.ts` (add real-catalog case)

**Interfaces:**
- Produces (for Tasks 2–3): the build-script helpers below, and catalog ids `outfit:{class}:t{tier}:{build}` and `gear:{spriteId}:{build}`.
- Produces (for Task 6): `catalog.ts` entries these tasks generate are consumed by `resolveLayers`.

- [ ] **Step 1: Add z-bands and manifest types to the build script.**

In `scripts/src/build-lpc-assets.ts`, extend the `Z` map and add types + the def cache. Place near the existing `const Z = { body: 10, hair: 30 };`:

```ts
const Z = { aura: 5, body: 10, hair: 30, outfit: 40, boots: 50, armor: 60, helmet: 70, weapon: 80, accessory: 90 };
const GEAR_Z = { boots: Z.boots, armor: Z.armor, helmet: Z.helmet, weapon: Z.weapon, accessory: Z.accessory };

// A clothing/gear part: a def path (relative to sheet_definitions/) + optional color variant.
// Use { male, female } when a def only covers one body type and a per-build override is needed.
type DefRef = { def: string; variant?: string };
type PartRef = DefRef | { male: DefRef; female: DefRef };
const perBuild = (r: PartRef, build) => ("def" in r ? r : r[build]);

const defCache = new Map();
async function fetchDef(defPath) {
  if (!defCache.has(defPath)) defCache.set(defPath, await fetchJson(`${RAW}/sheet_definitions/${defPath}`));
  return defCache.get(defPath);
}
const defCredit = (def) => {
  const c = def.credits?.[0] ?? {};
  return { author: (c.authors ?? []).join("; "), license: (c.licenses ?? []).join(", "), sourceUrl: (c.urls ?? [])[0] ?? "" };
};
```

- [ ] **Step 2: Add the def-frame resolver.**

Resolves a def+build+variant to a cropped south frame, throwing a clear error on a missing body-type or sheet:

```ts
// Load the south standing frame for a def's layer_1 for a given build.
async function loadDefFrame({ def: defPath, variant }, build) {
  const def = await fetchDef(defPath);
  const layer = def.layer_1;
  const prefix = layer[build];
  if (!prefix) throw new Error(`def ${defPath} has no '${build}' layer — supply a per-build override in the manifest`);
  const seg = variant ? `${variant}/` : "";
  const sheet = await loadSheet(`${RAW}/spritesheets/${prefix}${seg}walk.png`);
  if (!sheet) throw new Error(`no sheet at spritesheets/${prefix}${seg}walk.png for def ${defPath} (build ${build}) — check variant/leaf path`);
  return { frame: cropSouth(sheet), credit: defCredit(def), zPos: layer.zPos };
}
```

- [ ] **Step 3: Add the outfit builder (bake torso+legs+feet into one PNG per build).**

```ts
// Composite an ordered list of parts (feet, legs, torso...) into one baked outfit sprite per build.
async function buildOutfit(cls, tier, parts /* PartRef[] in draw order: feet→legs→torso */) {
  for (const build of BUILDS) {
    let img = new PNG({ width: 64, height: 64 }); // transparent base
    const creds = [];
    for (const part of parts) {
      const { frame, credit } = await loadDefFrame(perBuild(part, build), build);
      img = over(img, frame);
      creds.push(credit);
    }
    writePng("outfit", `${cls}_t${tier}_${build}`, img);
    const c = mergeCredits(creds);
    entries.push({ id: `outfit:${cls}:t${tier}:${build}`, category: "outfit", zIndex: Z.outfit, file: `/lpc/outfit/${cls}_t${tier}_${build}.png`, ...c });
  }
  console.log(`✓ outfit ${cls} t${tier}`);
}

// Union author/license/url across the parts of a baked sprite.
function mergeCredits(creds) {
  return {
    author: [...new Set(creds.flatMap(c => c.author.split("; ")).filter(Boolean))].join("; "),
    license: [...new Set(creds.flatMap(c => c.license.split(", ")).filter(Boolean))].join(", "),
    sourceUrl: creds.find(c => c.sourceUrl)?.sourceUrl ?? "",
  };
}
```

Add `mkdirSync(join(LPC_OUT, "outfit"), { recursive: true });` and `mkdirSync(join(LPC_OUT, "gear"), { recursive: true });` alongside the existing body/hair mkdirs in `main()`.

- [ ] **Step 4: Add the gear-archetype builder (one base sprite per build; no baked rarity).**

```ts
// Export a single gear archetype shape per build. Rarity tint is applied at runtime.
async function buildGear(spriteId, category, part /* PartRef */) {
  for (const build of BUILDS) {
    const { frame, credit } = await loadDefFrame(perBuild(part, build), build);
    writePng("gear", `${spriteId}_${build}`, frame);
    entries.push({ id: `gear:${spriteId}:${build}`, category, zIndex: GEAR_Z[category], file: `/lpc/gear/${spriteId}_${build}.png`, ...credit });
  }
  console.log(`✓ gear ${spriteId} (${category})`);
}
```

- [ ] **Step 5: Wire the spike manifest into `main()`** (after the existing hair loop, before the catalog write):

```ts
// --- SPIKE manifest (fighter t0 + sword). Expanded in Tasks 2–3. ---
await buildOutfit("fighter", 0, [
  { def: "feet/shoes/feet_shoes_basic.json", variant: "brown" },
  { def: "legs/pants/legs_pants.json", variant: "brown" },
  // tunic is female-only; provide a male-capable shirt override during the spike:
  { male: { def: "torso/shirts/torso_clothes_longsleeve/…verify…", variant: "brown" },
    female: { def: "torso/shirts/torso_clothes_tunic.json", variant: "brown" } },
]);
await buildGear("sword", "weapon", { def: "weapons/sword/weapon_sword_arming.json" });
```

- [ ] **Step 6: Run the build and resolve any path errors.**

Run: `pnpm --filter @workspace/scripts build-lpc`
Expected: prints `✓ outfit fighter t0` and `✓ gear sword (weapon)`, ending `DONE: N assets`.
If it throws `no sheet at spritesheets/...`: list that `spritesheets/<prefix>` dir with the GitHub contents `curl` one-liner (see reference above) to find whether `walk.png` is bare or under a color subfolder, and fix the `variant`/def. If it throws `has no 'male' layer`: replace the offending part with a `{ male, female }` override using a def that has a `male` key (e.g. an armour or longsleeve def). Repeat until it completes for both builds.

- [ ] **Step 7: Verify catalog + files exist.**

Run: `node -e "const {catalogById}=require('./artifacts/focusquest/src/lib/hero/catalog.ts')" 2>/dev/null || true` (catalog is TS; instead grep):
Run: `pnpm --filter @workspace/focusquest exec grep -c "outfit:fighter:t0" artifacts/focusquest/src/lib/hero/catalog.ts`
Expected: `2` (male + female). And confirm PNGs: `ls artifacts/focusquest/public/lpc/outfit artifacts/focusquest/public/lpc/gear` shows `fighter_t0_male.png`, `fighter_t0_female.png`, `sword_male.png`, `sword_female.png`.

- [ ] **Step 8: Write a real-catalog resolveLayers test.**

Append to `artifacts/focusquest/src/lib/hero/resolve-layers.test.ts`:

```ts
import { catalogById as realCatalog } from "./catalog";

describe("resolveLayers against generated catalog", () => {
  it("includes the fighter t0 outfit for an ungeared fighter", () => {
    const l = resolveLayers({ ...look, avatarClass: "fighter", tier: 0 }, realCatalog);
    expect(l.some((x) => x.file.includes("/outfit/fighter_t0_male.png"))).toBe(true);
  });
  it("draws an equipped sword over the outfit with no tint at common rarity", () => {
    const l = resolveLayers(
      { ...look, avatarClass: "fighter", tier: 0, equipped: [{ slot: "weapon", spriteId: "sword", rarity: "common" }] },
      realCatalog,
    );
    const sword = l.find((x) => x.file.includes("/gear/sword_male.png"));
    expect(sword).toBeDefined();
    expect(sword!.tint).toBeUndefined();
    expect(l[l.length - 1].file).toContain("sword"); // weapon z=80 is on top
  });
});
```

- [ ] **Step 9: Run the tests.**

Run: `pnpm --filter @workspace/focusquest test`
Expected: PASS (all existing + the two new cases).

- [ ] **Step 10: Visually confirm the outfit on-body in the running app.**

Start the `frontend` (and `api`) preview servers, open the Hero page as a fighter, and screenshot. Expected: the hero now wears the t0 outfit (shirt/pants/shoes) rather than a bare body. (Gear-on-body is confirmed in Task 6 after the seed exists.)

- [ ] **Step 11: Commit.**

```bash
git add scripts/src/build-lpc-assets.ts artifacts/focusquest/public/lpc artifacts/focusquest/src/lib/hero/catalog.ts artifacts/focusquest/src/lib/hero/resolve-layers.test.ts
git commit -m "feat(hero): LPC outfit+gear build pipeline spike (fighter t0 + sword)"
```

---

### Task 2: Full class-outfit manifest (16 outfits → 32 sprites)

**Files:**
- Modify: `scripts/src/build-lpc-assets.ts` (expand the outfit manifest to all classes × tiers)
- Regenerates: `public/lpc/outfit/*`, `catalog.ts`, `CREDITS.csv`

**Interfaces:**
- Consumes: `buildOutfit`, `DefRef`/`PartRef`, verified def paths (Task 1).
- Produces: catalog ids `outfit:{fighter|mage|ranger|healer}:t{0..3}:{male|female}` (32 total).

- [ ] **Step 1: Replace the spike outfit call with the full manifest.**

Each entry is `[feet, legs, torso]` in draw order. Start from these curated choices (each must resolve for **both** builds — use `{ male, female }` overrides where a def is single-gender; the build script throws a precise error if not):

```ts
const OUTFITS = {
  fighter: {
    0: [feetShoes("brown"), pants("brown"), shirt("brown")],
    1: [feetArmour(), legsArmour(), torsoLeather()],
    2: [feetArmour(), legsArmour(), torsoChainmail()],
    3: [feetArmour(), legsArmour(), torsoPlate()],
  },
  ranger: {
    0: [feetShoes("forest"), pants("forest"), shirt("forest")],
    1: [feetBoots("brown"), pants("brown"), torsoLeather()],
    2: [feetBoots("brown"), legsArmour(), torsoLeather()],
    3: [feetBoots("walnut"), legsArmour(), torsoLeather()],
  },
  mage: {
    0: [feetShoes("blue"), pants("blue"), robe("blue")],
    1: [feetShoes("blue"), pants("navy"), robe("navy")],
    2: [feetSandals("purple"), robeLegs("purple"), robe("purple")],
    3: [feetSandals("lavender"), robeLegs("lavender"), robe("lavender")],
  },
  healer: {
    0: [feetShoes("white"), pants("white"), robe("white")],
    1: [feetShoes("white"), pants("gray"), robe("gray")],
    2: [feetSandals("sky"), robeLegs("sky"), robe("sky")],
    3: [feetSandals("lavender"), robeLegs("lavender"), robe("lavender")],
  },
};
// Helper constructors return PartRef with verified defs; e.g.:
const feetShoes = (v) => ({ def: "feet/shoes/feet_shoes_basic.json", variant: v });
const feetSandals = (v) => ({ def: "feet/feet_sandals.json", variant: v });
const feetArmour = () => ({ def: "feet/feet_armour.json" });
const feetBoots = (v) => ({ def: "feet/boots/…verify…", variant: v });
const pants = (v) => ({ def: "legs/pants/legs_pants.json", variant: v });
const legsArmour = () => ({ def: "legs/legs_armour.json" });
const robeLegs = (v) => ({ def: "legs/pants/legs_pantaloons.json", variant: v });
const robe = (v) => ({ def: "torso/shirts/torso_clothes_robe.json", variant: v });
const torsoLeather = () => ({ def: "torso/armour/torso_armour_leather.json" });
const torsoChainmail = () => ({ def: "torso/torso_chainmail.json" });
const torsoPlate = () => ({ def: "torso/armour/torso_armour_plate.json" });
// shirt() must cover both builds (tunic is female-only):
const shirt = (v) => ({ male: { def: "torso/armour/torso_armour_leather.json" }, female: { def: "torso/shirts/torso_clothes_tunic.json", variant: v } });

for (const [cls, tiers] of Object.entries(OUTFITS))
  for (const [tier, parts] of Object.entries(tiers))
    await buildOutfit(cls, Number(tier), parts);
```

- [ ] **Step 2: Run the build and resolve each error the script reports.**

Run: `pnpm --filter @workspace/scripts build-lpc`
Expected: 16 `✓ outfit …` lines. For any `has no 'male' layer` or `no sheet at …` error, use the directory-listing `curl` to pick a valid def/variant (or add a `{ male, female }` override) and re-run. `…verify…` placeholders (feetBoots, shirt male) MUST be replaced with a listed real filename before this step is considered done.

- [ ] **Step 3: Assert all 32 outfit sprites + catalog entries exist.**

Run: `ls artifacts/focusquest/public/lpc/outfit | wc -l` → Expected `32`.
Run: `grep -c '"category": "outfit"' artifacts/focusquest/src/lib/hero/catalog.ts` → Expected `32`.

- [ ] **Step 4: Run tests + typecheck.**

Run: `pnpm --filter @workspace/focusquest test` → PASS.
Run: `pnpm --filter @workspace/scripts typecheck` → clean.

- [ ] **Step 5: Visually confirm one tier per class** in the running app (switch class, observe distinct outfits). Screenshot.

- [ ] **Step 6: Commit.**

```bash
git add scripts/src/build-lpc-assets.ts artifacts/focusquest/public/lpc artifacts/focusquest/src/lib/hero/catalog.ts artifacts/focusquest/public/lpc/CREDITS.csv
git commit -m "feat(hero): export all 16 class outfits (32 sprites) via LPC pipeline"
```

---

### Task 3: Gear archetypes + signature legendaries (~40 sprites)

**Files:**
- Modify: `scripts/src/build-lpc-assets.ts` (gear manifest)
- Regenerates: `public/lpc/gear/*`, `catalog.ts`, `CREDITS.csv`

**Interfaces:**
- Consumes: `buildGear`, `GEAR_Z`, verified weapon/armour/headwear defs (Task 1).
- Produces: catalog ids `gear:{spriteId}:{male|female}` for every archetype below. **These `spriteId` strings are the contract the Task 4 roster references — keep them stable.**

- [ ] **Step 1: Add the gear manifest** (replace the spike `buildGear("sword"…)` call). Archetype `spriteId`s (shape, tinted by rarity) + a few signature legendaries (unique shapes):

```ts
const GEAR = [
  // weapon archetypes
  { spriteId: "sword",    category: "weapon", part: { def: "weapons/sword/weapon_sword_arming.json" } },
  { spriteId: "greatsword", category: "weapon", part: { def: "weapons/sword/weapon_sword_longsword.json" } },
  { spriteId: "staff",    category: "weapon", part: { def: "weapons/magic/weapon_magic_gnarled.json" } },
  { spriteId: "crossbow", category: "weapon", part: { def: "weapons/ranged/weapon_ranged_crossbow.json" } },
  // helmet archetypes (list headwear/helmets/helmets to pick real filenames)
  { spriteId: "cap",      category: "helmet", part: { def: "headwear/coverings/…verify hood/cap…" } },
  { spriteId: "helm",     category: "helmet", part: { def: "headwear/helmets/helmets/…verify…" } },
  { spriteId: "greathelm", category: "helmet", part: { def: "headwear/helmets/helmets/…verify…" } },
  // armor (torso) archetypes
  { spriteId: "leather-armor", category: "armor", part: { def: "torso/armour/torso_armour_leather.json" } },
  { spriteId: "mail",     category: "armor", part: { def: "torso/torso_chainmail.json" } },
  { spriteId: "plate",    category: "armor", part: { def: "torso/armour/torso_armour_plate.json" } },
  // boots (feet) archetypes
  { spriteId: "shoes",    category: "boots", part: { def: "feet/shoes/feet_shoes_basic.json", variant: "brown" } },
  { spriteId: "boots",    category: "boots", part: { def: "feet/boots/…verify…", variant: "brown" } },
  { spriteId: "greaves",  category: "boots", part: { def: "feet/feet_armour.json" } },
  // accessory archetypes (capes/amulets — list headwear/neck and torso/cape)
  { spriteId: "cape",     category: "accessory", part: { def: "torso/cape/…verify…" } },
  { spriteId: "amulet",   category: "accessory", part: { def: "headwear/neck/…verify…" } },
  // signature legendaries (unique shapes; distinct def or variant)
  { spriteId: "excalibur", category: "weapon", part: { def: "weapons/sword/weapon_sword_katana.json" } },
  { spriteId: "archmage-staff", category: "weapon", part: { def: "weapons/magic/weapon_magic_wand.json" } },
  { spriteId: "dragon-plate", category: "armor", part: { def: "torso/armour/torso_armour_legion.json" } },
  { spriteId: "crown",    category: "helmet", part: { def: "headwear/hats/…verify crown…" } },
];
for (const g of GEAR) await buildGear(g.spriteId, g.category, g.part);
```

- [ ] **Step 2: Run the build; resolve every `…verify…` and any path error.**

Run: `pnpm --filter @workspace/scripts build-lpc`. Replace each `…verify…` by listing the relevant dir with the `curl` one-liner and choosing a real filename; re-run until all `✓ gear …` lines print. Note the final `spriteId` set — it is the contract for Task 4.

- [ ] **Step 3: Assert gear sprites + entries.**

Run: `grep -c '"id": "gear:' artifacts/focusquest/src/lib/hero/catalog.ts` → Expected `2 × (number of GEAR entries)`.
Run: `ls artifacts/focusquest/public/lpc/gear | wc -l` → same count.

- [ ] **Step 4: Run tests.** `pnpm --filter @workspace/focusquest test` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add scripts/src/build-lpc-assets.ts artifacts/focusquest/public/lpc artifacts/focusquest/src/lib/hero/catalog.ts artifacts/focusquest/public/lpc/CREDITS.csv
git commit -m "feat(hero): export gear archetype + signature-legendary sprites"
```

---

### Task 4: Gear roster + idempotent seed + name-unique constraint

**Files:**
- Modify: `lib/db/src/schema/gear.ts` (add `name` unique constraint)
- Create: `scripts/src/gear-catalog.ts` (roster source of truth)
- Create: `scripts/src/seed-gear.ts` (idempotent upsert + catalog pre-flight)
- Modify: `scripts/package.json` (add `@workspace/db` dep + `seed-gear` script)

**Interfaces:**
- Consumes: `spriteId` strings produced by Task 3; `db`, `pool`, `gearItemsTable`, `GearSlot`, `GearRarity` from `@workspace/db`; `catalogById` from the generated `artifacts/focusquest/src/lib/hero/catalog.ts`.
- Produces: seeded `gear_items` rows with non-null `spriteId`. The store/avatar routes read these.

- [ ] **Step 1: Add the name-unique constraint.**

In `lib/db/src/schema/gear.ts`, change the `gearItemsTable` definition to add a table-extras callback (import `unique` is already present):

```ts
export const gearItemsTable = pgTable("gear_items", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  slot: text("slot").$type<GearSlot>().notNull(),
  rarity: text("rarity").$type<GearRarity>().notNull(),
  statPower: integer("stat_power").notNull(),
  costXp: integer("cost_xp").notNull(),
  levelRequired: integer("level_required").notNull().default(1),
  icon: text("icon").notNull(),
  spriteId: text("sprite_id"),
}, (table) => [
  unique("gear_items_name_unique").on(table.name),
]);
```

- [ ] **Step 2: Push the schema.**

Run: `export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)" && pnpm --filter @workspace/db push`
Expected: `[✓] Changes applied` (additive unique index; no destructive prompt). If existing rows have duplicate names, the index creation fails — de-dupe those rows first, then re-run.

- [ ] **Step 3: Add `@workspace/db` to scripts.**

In `scripts/package.json`, add to `dependencies`: `"@workspace/db": "workspace:*"`, and to `scripts`: `"seed-gear": "tsx ./src/seed-gear.ts"`. Then run `pnpm install`.

- [ ] **Step 4: Write the gear roster.** `scripts/src/gear-catalog.ts` — every `spriteId` MUST be one produced in Task 3. Multiple items may share a `spriteId` (rarity differentiates). `icon` is a lucide name already used by the store UI (`Sword`, `HardHat`, `ShieldHalf`, `Footprints`, `Gem`, `Crown`).

```ts
import type { GearSlot, GearRarity } from "@workspace/db";

export interface GearRosterItem {
  name: string; description: string; slot: GearSlot; rarity: GearRarity;
  statPower: number; costXp: number; levelRequired: number; icon: string; spriteId: string;
}

export const GEAR_CATALOG: GearRosterItem[] = [
  // weapons
  { name: "Rusty Sword",    description: "A pitted blade, but it cuts.",       slot: "weapon", rarity: "common",    statPower: 4,  costXp: 100,  levelRequired: 1,  icon: "Sword", spriteId: "sword" },
  { name: "Knight's Blade", description: "Balanced steel for a true fighter.", slot: "weapon", rarity: "rare",      statPower: 10, costXp: 600,  levelRequired: 5,  icon: "Sword", spriteId: "sword" },
  { name: "Zweihänder",     description: "A massive two-handed greatsword.",   slot: "weapon", rarity: "epic",      statPower: 18, costXp: 1600, levelRequired: 12, icon: "Sword", spriteId: "greatsword" },
  { name: "Gnarled Staff",  description: "Channels arcane focus.",             slot: "weapon", rarity: "rare",      statPower: 9,  costXp: 600,  levelRequired: 5,  icon: "Gem",   spriteId: "staff" },
  { name: "Hunter's Sling",    description: "A swift ranged sidearm.",          slot: "weapon", rarity: "rare",      statPower: 9,  costXp: 550,  levelRequired: 5,  icon: "Sword", spriteId: "slingshot" },  // was crossbow (blank south frame → slingshot, Task 3)
  { name: "Excalibur",      description: "The legendary blade of kings.",      slot: "weapon", rarity: "legendary", statPower: 30, costXp: 5000, levelRequired: 25, icon: "Sword", spriteId: "excalibur" },
  { name: "Staff of the Archmage", description: "Raw magic given form.",       slot: "weapon", rarity: "legendary", statPower: 28, costXp: 5000, levelRequired: 25, icon: "Gem",   spriteId: "archmage-staff" },
  // helmets
  { name: "Leather Cap",    description: "Simple head protection.",            slot: "helmet", rarity: "common",    statPower: 3,  costXp: 80,   levelRequired: 1,  icon: "HardHat", spriteId: "cap" },
  { name: "Iron Helm",      description: "Sturdy forged headgear.",            slot: "helmet", rarity: "rare",      statPower: 8,  costXp: 500,  levelRequired: 4,  icon: "HardHat", spriteId: "helm" },
  { name: "Great Helm",     description: "Full-face knightly protection.",     slot: "helmet", rarity: "epic",      statPower: 14, costXp: 1400, levelRequired: 11, icon: "HardHat", spriteId: "greathelm" },
  { name: "Crown of Valor", description: "Worn only by champions.",            slot: "helmet", rarity: "legendary", statPower: 24, costXp: 4500, levelRequired: 22, icon: "Crown",   spriteId: "crown" },
  // armor
  { name: "Leather Vest",   description: "Light, flexible protection.",        slot: "armor",  rarity: "common",    statPower: 5,  costXp: 120,  levelRequired: 1,  icon: "ShieldHalf", spriteId: "leather-armor" },
  { name: "Chainmail",      description: "Interlocking steel rings.",          slot: "armor",  rarity: "rare",      statPower: 12, costXp: 700,  levelRequired: 6,  icon: "ShieldHalf", spriteId: "mail" },
  { name: "Plate Armor",    description: "Heavy forged protection.",           slot: "armor",  rarity: "epic",      statPower: 20, costXp: 1800, levelRequired: 13, icon: "ShieldHalf", spriteId: "plate" },
  { name: "Dragonscale Plate", description: "Forged from dragon hide.",        slot: "armor",  rarity: "legendary", statPower: 34, costXp: 5500, levelRequired: 26, icon: "ShieldHalf", spriteId: "dragon-plate" },
  // boots
  { name: "Worn Shoes",     description: "Better than bare feet.",             slot: "boots",  rarity: "common",    statPower: 2,  costXp: 60,   levelRequired: 1,  icon: "Footprints", spriteId: "shoes" },
  { name: "Traveler's Boots", description: "Made for the long road.",          slot: "boots",  rarity: "rare",      statPower: 7,  costXp: 450,  levelRequired: 4,  icon: "Footprints", spriteId: "boots" },
  { name: "Steel Greaves",  description: "Armored leg guards.",                slot: "boots",  rarity: "epic",      statPower: 13, costXp: 1300, levelRequired: 11, icon: "Footprints", spriteId: "greaves" },
  // accessory
  { name: "Traveler's Cloak", description: "A warm, sturdy cape.",             slot: "accessory", rarity: "common", statPower: 3, costXp: 90,   levelRequired: 1,  icon: "Gem", spriteId: "cape" },
  { name: "Amulet of Focus", description: "Sharpens the mind.",                slot: "accessory", rarity: "rare",   statPower: 8, costXp: 550,  levelRequired: 5,  icon: "Gem", spriteId: "amulet" },
];
```

- [ ] **Step 5: Write the seed with a catalog pre-flight guard.** `scripts/src/seed-gear.ts`:

```ts
import { db, pool, gearItemsTable } from "@workspace/db";
import { GEAR_CATALOG } from "./gear-catalog.js";
// Generated catalog lives in the focusquest package; import for the pre-flight resolution check.
import { catalogById } from "../../artifacts/focusquest/src/lib/hero/catalog.ts";

async function main() {
  // Pre-flight: every roster spriteId must resolve for BOTH builds, or gear silently won't render.
  const missing = [];
  for (const item of GEAR_CATALOG)
    for (const build of ["male", "female"])
      if (!catalogById.has(`gear:${item.spriteId}:${build}`)) missing.push(`gear:${item.spriteId}:${build} (item "${item.name}")`);
  if (missing.length) throw new Error(`Roster references sprites not in catalog:\n  ${missing.join("\n  ")}`);

  for (const item of GEAR_CATALOG) {
    await db.insert(gearItemsTable).values(item).onConflictDoUpdate({
      target: gearItemsTable.name,
      set: {
        description: item.description, slot: item.slot, rarity: item.rarity,
        statPower: item.statPower, costXp: item.costXp, levelRequired: item.levelRequired,
        icon: item.icon, spriteId: item.spriteId,
      },
    });
  }
  console.log(`✓ seeded ${GEAR_CATALOG.length} gear items (upsert by name)`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: Run the seed.**

Run: `export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)" && pnpm --filter @workspace/scripts seed-gear`
Expected: `✓ seeded 20 gear items (upsert by name)`. If it throws the pre-flight error, a `spriteId` in the roster doesn't match Task 3's output — fix the roster (or re-run the build) so they agree.

- [ ] **Step 7: Verify idempotency + spriteId backfill.**

Run the same seed command again → still `✓ seeded 20 …`, no duplicate-key error (upsert).
Run: `export DATABASE_URL=… && node -e "const {pool}=await import('@workspace/db'); const r=await pool.query('select count(*) c, count(sprite_id) s from gear_items'); console.log(r.rows[0]); await pool.end();"` — Expected `c === s` (every item has a spriteId; count matches roster + any pre-existing).

- [ ] **Step 8: Typecheck + commit.**

Run: `pnpm typecheck` → clean.
```bash
git add lib/db/src/schema/gear.ts scripts/src/gear-catalog.ts scripts/src/seed-gear.ts scripts/package.json pnpm-lock.yaml
git commit -m "feat(hero): gear roster + idempotent seed, backfill gear_items.spriteId"
```

---

### Task 5: Store API `spriteId` + codegen + integrity/attribution tests

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (`GearStoreItem.spriteId`)
- Modify: `artifacts/api-server/src/routes/gear.ts` (return `spriteId`)
- Regenerates: `lib/api-client-react/**`, `lib/api-zod/**`
- Create: `artifacts/focusquest/src/lib/hero/catalog-integrity.test.ts`

**Interfaces:**
- Consumes: `CATALOG` from `./catalog`; `public/lpc/**` + `CREDITS.csv` on disk.
- Produces: `GearStoreItem.spriteId` in the generated client (consumed by Task 6 UI).

- [ ] **Step 1: Add `spriteId` to the OpenAPI store item.** In `lib/api-spec/openapi.yaml`, under `GearStoreItem.properties`, after `icon:` add (mirrors `EquippedGearItem`):

```yaml
        spriteId:
          type: string
          nullable: true
```

- [ ] **Step 2: Regenerate the client.**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: updates `lib/api-client-react/src/generated/*` and `lib/api-zod/src/generated/*` with `spriteId` on the store item type.

- [ ] **Step 3: Return `spriteId` from the store route.** In `artifacts/api-server/src/routes/gear.ts`, in the `/gear/store` `items` map, add `spriteId: item.spriteId ?? null,` (place after `icon: item.icon,`).

- [ ] **Step 4: Write the catalog-integrity + attribution test.** `artifacts/focusquest/src/lib/hero/catalog-integrity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { CATALOG } from "./catalog";

const PUBLIC = path.resolve(__dirname, "../../../public");
const LPC = path.join(PUBLIC, "lpc");
const Z_BANDS: Record<string, number> = { aura: 5, body: 10, face: 20, hair: 30, outfit: 40, boots: 50, armor: 60, helmet: 70, weapon: 80, accessory: 90 };

describe("catalog integrity", () => {
  it("every catalog entry points to a file that exists on disk", () => {
    for (const e of CATALOG) {
      const p = path.join(PUBLIC, e.file); // e.file starts with /lpc/...
      expect(existsSync(p), `missing file for ${e.id}: ${e.file}`).toBe(true);
    }
  });

  it("every entry's zIndex matches its category band", () => {
    for (const e of CATALOG) expect(e.zIndex, `bad z for ${e.id}`).toBe(Z_BANDS[e.category]);
  });

  it("every outfit and gear id exists for both builds", () => {
    const ids = new Set(CATALOG.map((e) => e.id));
    for (const e of CATALOG) {
      const m = e.id.match(/^(outfit:.+|gear:[^:]+):(male|female)$/);
      if (!m) continue;
      const other = e.id.endsWith(":male") ? e.id.replace(/:male$/, ":female") : e.id.replace(/:female$/, ":male");
      expect(ids.has(other), `${e.id} missing its paired build`).toBe(true);
    }
  });
});

describe("attribution coverage", () => {
  it("every entry has non-empty author + license", () => {
    for (const e of CATALOG) {
      expect(e.author.length, `no author for ${e.id}`).toBeGreaterThan(0);
      expect(e.license.length, `no license for ${e.id}`).toBeGreaterThan(0);
    }
  });

  it("every bundled PNG under public/lpc has a catalog entry", () => {
    const files = new Set(CATALOG.map((e) => e.file));
    const walk = (dir: string) => readdirSync(dir, { withFileTypes: true }).forEach((d) => {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) return walk(full);
      if (!d.name.endsWith(".png")) return;
      const rel = "/lpc/" + path.relative(LPC, full).split(path.sep).join("/");
      expect(files.has(rel), `orphan asset with no catalog entry: ${rel}`).toBe(true);
    });
    walk(LPC);
  });

  it("CREDITS.csv exists and is non-trivial", () => {
    const csv = readFileSync(path.join(LPC, "CREDITS.csv"), "utf8");
    expect(csv.split("\n").length).toBeGreaterThan(2);
  });
});
```

- [ ] **Step 5: Run tests + typecheck.**

Run: `pnpm --filter @workspace/focusquest test` → PASS (fix any orphan-asset or z-band failure by regenerating the catalog / correcting `Z`).
Run: `pnpm typecheck` → clean.

- [ ] **Step 6: Verify the store returns `spriteId` in the running app.**

Rebuild/restart the `api` server, load the Hero page store, and inspect a `/api/gear/store` response (network panel) — each item includes `spriteId`.

- [ ] **Step 7: Commit.**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react lib/api-zod artifacts/api-server/src/routes/gear.ts artifacts/focusquest/src/lib/hero/catalog-integrity.test.ts
git commit -m "feat(hero): store API spriteId + catalog-integrity & attribution tests"
```

---

### Task 6: Flip gear-on-body in the UI + credits view

**Files:**
- Modify: `artifacts/focusquest/src/pages/avatar.tsx` (real `equipped`; credits entry point)
- Create: `artifacts/focusquest/src/components/hero-credits.tsx`

**Interfaces:**
- Consumes: `avatarData.equippedGear[].spriteId` (already returned by `/avatar`); `EquippedGearLook` shape `{ slot, spriteId, rarity }`; `CATALOG` for credits.

- [ ] **Step 1: Replace the hardcoded `equipped: []`.** In `artifacts/focusquest/src/pages/avatar.tsx`, change the `heroLook` `equipped` field (currently `equipped: []` at ~line 480) to map the equipped gear, skipping items with no sprite:

```ts
    equipped: (avatarData?.equippedGear ?? [])
      .filter((g) => g.spriteId)
      .map((g) => ({
        slot: g.slot as EquippedGearLook["slot"],
        spriteId: g.spriteId as string,
        rarity: g.rarity as EquippedGearLook["rarity"],
      })),
```

Add `EquippedGearLook` to the existing `import type { … } from "@/lib/hero/types"` line.

- [ ] **Step 2: Write the credits view.** `artifacts/focusquest/src/components/hero-credits.tsx`:

```tsx
import { CATALOG } from "@/lib/hero/catalog";

export function HeroCredits() {
  const seen = new Set<string>();
  const rows = CATALOG.filter((e) => {
    const key = `${e.author}|${e.license}|${e.sourceUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      <p className="font-medium">
        Character art: Universal LPC Spritesheet (art assets only). Licensed per-asset:
      </p>
      <ul className="space-y-1">
        {rows.map((e, i) => (
          <li key={i}>
            <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
              {e.author}
            </a>{" "}— {e.license}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Add a credits entry point** at the bottom of the left character panel in `avatar.tsx` (after the Equipment slots card), e.g. a `<details>` disclosure:

```tsx
          <details className="rounded-xl border border-border bg-card/50 p-4">
            <summary className="text-xs font-bold uppercase tracking-wider text-muted-foreground cursor-pointer">Art credits</summary>
            <div className="mt-3"><HeroCredits /></div>
          </details>
```

Add `import { HeroCredits } from "@/components/hero-credits";` at the top.

- [ ] **Step 4: Typecheck.** `pnpm typecheck` → clean.

- [ ] **Step 5: Verify gear-on-body end-to-end in the running app.**

With `api` + `frontend` running: as a leveled account, buy/equip one item per slot (weapon, helmet, armor, boots, accessory) and confirm each appears layered on the hero in correct z-order, with rare/epic/legendary items showing the rarity tint and common items untinted. Unequip → the layer disappears and the class outfit shows through. Screenshot a fully-geared hero.

- [ ] **Step 6: Commit.**

```bash
git add artifacts/focusquest/src/pages/avatar.tsx artifacts/focusquest/src/components/hero-credits.tsx
git commit -m "feat(hero): render equipped gear on-body + LPC art credits view"
```

---

### Task 7: Final verification & PR

- [ ] **Step 1: Full gate.** Run: `pnpm --filter @workspace/focusquest test` → PASS; `pnpm typecheck` → clean.
- [ ] **Step 2: Attribution sanity.** Confirm `CREDITS.csv` and the in-app credits list include outfit + gear contributors (not just body/hair).
- [ ] **Step 3: Open the PR** with `gh` (full path `C:\Program Files\GitHub CLI\gh.exe`) from `feat/hero-phase2-gear-outfits` → `main`, summarizing: outfits, gear-on-body, roster+seed, store spriteId, credits. Include before/after hero screenshots.
- [ ] **Step 4: Deploy note.** After merge, per deployment gotchas: the seed must be run once against prod (`seed-gear` with prod `DATABASE_URL`) and Render may need a manual "Deploy latest commit"; verify a new-build-only asset (e.g. `/lpc/outfit/fighter_t0_male.png` returns `image/png`).

---

## Self-Review

**Spec coverage:**
- Manifest-driven pipeline reading `sheet_definitions` + auto-attribution → Tasks 1–3. ✓
- Gear = archetype + rarity tint; signature legendaries → Task 3 + roster in Task 4. ✓
- Baked outfits, one per class×tier×build (32) → Task 2. ✓
- Catalog regen + z-bands → Tasks 1–3 + integrity test Task 5. ✓
- Code roster + idempotent seed (upsert by name), greenfield, name-unique constraint → Task 4. ✓
- Store API `spriteId` + codegen → Task 5; `/avatar` already returns it (no change). ✓
- UI flip `equipped: []` + credits view → Task 6. ✓
- Tests: resolveLayers real-catalog (Task 1), catalog-integrity + attribution (Task 5); API `spriteId` verified in-app (no api-server test runner) → covered. ✓
- FX deferred → not in plan (Task 7 note only). ✓ (Non-goal per spec.)

**Placeholder scan:** The only intentional fill-ins are LPC `…verify…` def choices in the manifests (Tasks 2–3), which are *art-curation selections against a live asset repo* resolved by a concrete `curl` listing command + the build script's hard-fail on bad paths — each such step explicitly requires replacing them before the task's build step passes. No logic/test/interface placeholders.

**Type consistency:** `buildOutfit`/`buildGear`/`loadDefFrame`/`perBuild`/`mergeCredits`/`fetchDef`/`defCredit` defined in Task 1, reused in 2–3. `GEAR_CATALOG`/`GearRosterItem` defined in Task 4, consumed by the seed's pre-flight. `EquippedGearLook{slot,spriteId,rarity}` matches `types.ts` and the Task 6 mapping. `catalogById`/`CATALOG` usage matches `catalog.ts` exports. Store `spriteId` type mirrors the existing `EquippedGearItem.spriteId` (nullable string). Consistent.
