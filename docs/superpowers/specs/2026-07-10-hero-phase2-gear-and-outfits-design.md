# Hero Phase 2 — Gear-on-Body & Class Outfits — Design Spec

Refines and executes **Phase 2** of the layered hero system. Supersedes the Phase 2
section of `2026-07-10-hero-layered-character-and-gear-design.md` with concrete decisions
made during brainstorming. Phases 0–1 (compositor, catalog, physical customization) are
already live (PR #3).

## Goal

Equipped gear and class outfits **visibly appear on the hero**. Today the compositor
(`resolveLayers` + `PixelHero`) already supports `outfit:*` and `gear:*` layers plus the
rarity tint pass — it is fully unit-tested against placeholder sprite ids. What's missing is
the **art**, the **catalog entries**, the **gear roster + spriteId data**, one **API field**,
and **flipping the UI** from the hardcoded `equipped: []`. This spec delivers all of that.

Out of scope for this pass: engagement FX (idle bob, equip flash, level aura) — deferred to a
Phase 3 slice. No runtime palette engine (rarity stays a tint pass). No new body builds
(still male/female). No animation beyond the single south standing frame.

## Decisions locked during brainstorming

1. **Manifest-driven build pipeline** (not manual export). The build script reads LPC
   `sheet_definitions/**/*.json` to resolve real spritesheet paths + attribution.
2. **Gear = archetype shape + rarity tint.** `spriteId` identifies the *shape*, not the item.
   Many items share one sprite; rarity is applied at runtime by the existing tint pass.
   Signature legendaries get their own dedicated sprite.
3. **Outfits are baked** — torso+legs+feet composited into one PNG per class×tier×build,
   mirroring the existing body+head+eyes bake.
4. **Code-defined gear catalog + idempotent seed** is the source of truth for the gear roster.
   Greenfield data: no production gear ownership to preserve; seed upserts by `name`.
5. **Bounded roster:** ~3 archetypes per slot (~15 shapes) + ~4 signature legendaries + 16
   class outfits ≈ ~70 new sprites.
6. **FX deferred** to Phase 3.

## Art pipeline (extend `scripts/src/build-lpc-assets.ts`)

### LPC data model (verified)

Each `sheet_definitions/**/*.json` provides:
- `layer_N`: per-body-type path prefixes (`male`, `female`, `teen`, …), e.g. `"torso/chainmail/male/"`.
  The PNG is fetched at `spritesheets/{prefix}walk.png` and the south frame cropped (row y=128),
  identical to the current body/hair flow.
- `zPos`: LPC's intra-scene z-order (informational; we keep our own category z-bands).
- `credits`: authors + license + URL → **attribution is pulled from LPC data, not hand-authored.**
- `recolors`: palette ramps per material (used only where we choose to recolor).

### Curation manifest (new, hand-authored)

A single manifest in the build script enumerates every outfit and gear archetype:

```
OUTFITS: { class, tier } -> [ { def, layerVariant } ... ]   // torso + legs + feet defs to bake
GEAR:    { spriteId, category } -> { def, layerVariant, palette? }
```

For each entry the script: resolves the LPC path(s) from the referenced def, fetches +
crops the south frame per build (male/female), composites multi-part outfits with the existing
`over()` helper into one PNG, writes it under `public/lpc/{outfit|gear}/…`, and pushes a
catalog entry whose author/license/sourceUrl come from the def's `credits`. Gear archetypes
export **one base sprite per build**; rarity is never baked. Signature legendaries are ordinary
manifest entries pointing at a distinct def or palette.

### Output layout

- `public/lpc/outfit/{class}_t{tier}_{build}.png` — 4×4×2 = 32
- `public/lpc/gear/{spriteId}_{build}.png` — ~15 archetypes + ~4 legendaries, ×2 builds ≈ ~40
- Regenerated `catalog.ts` (adds `outfit:*`, `gear:*` entries)
- Regenerated `CREDITS.csv` (adds outfit + gear rows)

### Z-order bands (catalog `zIndex`)

Extends the existing convention (body=10, hair=30) and matches `resolve-layers.test.ts`
(outfit=40, boots=50, helmet=70):

| Category | z | Category | z |
|----------|---|----------|---|
| aura*    | 5 | armor    | 60 |
| body     | 10 | helmet   | 70 |
| hair     | 30 | weapon   | 80 |
| outfit   | 40 | accessory | 90 |
| boots    | 50 | | |

`aura` reserved for the deferred level-aura FX; no aura assets built this pass.

## Data model

### Gear catalog — `scripts/src/gear-catalog.ts` (new, source of truth)

An array of `{ name, description, slot, rarity, statPower, costXp, levelRequired, icon, spriteId }`.
`spriteId` references a `gear:{spriteId}:{build}` catalog shape. Multiple items may share a
`spriteId` (rarity differentiates them visually via tint). Every `spriteId` here must resolve in
`catalog.ts` (enforced by the integrity test). Colocated with the seed in `scripts/` because
nothing at runtime consumes it — the store and reward logic read `gear_items` from the DB; the
roster-in-code exists only to author/seed that table.

### Idempotent seed — `scripts/src/seed-gear.ts` (new)

Upserts each catalog row into `gear_items` keyed on `name`
(`onConflict(name) do update set …`). Adds a `unique` constraint on `gear_items.name` to make the
upsert well-defined. Safe to re-run; does not touch `user_gear`. Runnable via a `package.json`
script (mirrors `build-lpc`), documented alongside the drizzle-push `.env` gotcha. Requires adding
`@workspace/db` as a `scripts` dependency (the build-lpc script doesn't use the DB today).

### Schema — `lib/db/src/schema/gear.ts`

`spriteId` column already exists. Add `unique("gear_items_name_unique").on(name)` to support the
seed upsert. Applied via `drizzle push` (existing workflow).

## API

- **`GET /api/gear/store`** (`routes/gear.ts`) — add `spriteId: item.spriteId ?? null` to each
  returned item. (`GET /api/avatar` already returns `spriteId` on `equippedGear`.)
- Update `lib/api-spec/openapi.yaml` (`GearStoreItem.spriteId`), regenerate the Orval client
  (`lib/api-client-react`) and Zod types (`lib/api-zod`) via the existing codegen command.
- No new endpoints; equip/unequip/buy unchanged.

## UI — `artifacts/focusquest/src/pages/avatar.tsx`

- Replace the hardcoded `equipped: []` (line ~480) with the real equipped gear mapped from
  `avatarData.equippedGear`:
  `equipped: equippedGear.filter(g => g.spriteId).map(g => ({ slot, spriteId, rarity }))`.
  Items whose `spriteId` is null (none, after seeding) are simply skipped by `resolveLayers`.
- The center `PixelHero` now shows the class outfit (via `look.avatarClass` + derived `tier`)
  with equipped gear layered over it. Equipment slot list, store, and battle panel unchanged.
- **Credits view** — build the deferred `hero-credits.tsx`: a modal/section listing distinct
  `{ author, license, sourceUrl }` from `CATALOG`, with a small "Art credits" entry point on the
  Hero page. Satisfies the LPC attribution obligation in-app.

## Testing

- **`resolve-layers.test.ts`** — keep existing placeholder-catalog tests; add a case that runs
  against the real generated `catalog.ts` for a representative geared look (fighter t2 + a couple
  archetypes + a legendary), asserting z-order and tints.
- **Catalog-integrity test** (new) — for every gear-catalog `spriteId` and both builds, and for
  every `outfit:{class}:t{tier}:{build}` and physical-attribute variant, assert a matching
  `catalog.ts` entry exists and its `file` is present on disk; assert z-indices are within band.
- **Attribution-coverage test** (new) — every bundled `public/lpc/**` PNG has a `catalog.ts`
  entry with non-empty author/license, and a `CREDITS.csv` row exists.
- **API** — assert `/api/gear/store` items include `spriteId`.

## Build order (all ships in this effort; sequenced to de-risk)

1. **Pipeline spike** — extend the build script for ONE outfit (fighter t0) + ONE gear archetype
   (e.g. `helm`), regenerate catalog, flip the UI, confirm both render on-body in the running app.
   Validates LPC paths/compositing before volume.
2. **Outfits** — author the full outfit manifest; export all 32; regenerate catalog + credits.
3. **Gear archetypes + signature legendaries** — author the gear manifest; export ~40 sprites.
4. **Gear catalog + seed** — `gear-catalog.ts`, `seed-gear.ts`, name-unique constraint, drizzle
   push, run seed.
5. **API + catalog regen + tests** — store `spriteId`; codegen; catalog-integrity + attribution +
   API tests.
6. **UI** — final `equipped` wiring + `hero-credits.tsx`.
7. (**Phase 3, deferred**) idle bob, equip flash, level aura.

## Files

### New
- `scripts/src/gear-catalog.ts` — gear roster source of truth
- `scripts/src/seed-gear.ts` — idempotent gear seed
- `artifacts/focusquest/src/components/hero-credits.tsx` — attribution view
- `artifacts/focusquest/src/lib/hero/catalog-integrity.test.ts` — integrity + attribution tests

### Modified
- `scripts/src/build-lpc-assets.ts` — outfit + gear manifest, export, catalog/credits emit
- `scripts/package.json` — `seed-gear` script + `@workspace/db` dependency
- `artifacts/focusquest/src/lib/hero/catalog.ts` — regenerated (outfit + gear entries)
- `artifacts/focusquest/public/lpc/**` + `CREDITS.csv` — new PNGs + credits (regenerated)
- `lib/db/src/schema/gear.ts` — `gear_items.name` unique constraint
- `artifacts/api-server/src/routes/gear.ts` — return `spriteId`
- `lib/api-spec/openapi.yaml`, `lib/api-client-react/**`, `lib/api-zod/**` — `spriteId` on store item
- `artifacts/focusquest/src/pages/avatar.tsx` — flip `equipped`, add credits entry point
- `artifacts/focusquest/src/lib/hero/resolve-layers.test.ts` — real-catalog case

## Non-goals (this pass)
- FX (idle bob / equip flash / level aura) — Phase 3.
- Runtime palette-swap engine — rarity stays a tint pass.
- New body builds or animation frames.
- Reworking battle mechanics, gear economy, or reward logic.
