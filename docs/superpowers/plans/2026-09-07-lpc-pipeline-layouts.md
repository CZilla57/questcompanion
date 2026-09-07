# Plan — Extend the LPC art pipeline to unlock more layouts

**Date:** 2026-09-07
**Branches:** build-tool + web `claude/dnd-lpc-pipeline` (off `main`); iOS renderer (Phase 2 only) off `swift-mobile-app-a70k2k`.

## Why

The gear sprite build tool ([scripts/src/build-lpc-assets.ts](scripts/src/build-lpc-assets.ts)) can only consume a narrow slice of LPC assets, which is why only 18 gear sprites exist. Two upstream layouts are unreachable today, documented as rejects in the file:

1. **Multi-layer defs** — a def whose visible south-frame art lives in `layer_2`/`layer_3` (foreground), not `layer_1`. `loadDefFrame` only ever reads `def.layer_1`, so these bake blank (the crossbow defect → swapped to a slingshot).
2. **`custom_animation: "walk_128"` oversize defs** — big weapons (bows, katana, magic wand, boomerang) ship on 128px-tall frame sheets instead of the standard 576×256 / 64px walk sheet. `cropSouthStrip` assumes a fixed 64px row at y=128 and a 9×64 geometry, so these can't be read at all.

Unlocking both opens most of the LPC weapon/armor/shield library (daggers, axes, maces, spears, bows, wands, shields, more hats/capes) for the catalog expansion, with distinct real art instead of sprite reuse.

## Background — the constraints any change must respect

- Sprites are **9-frame walk strips** (`FRAMES = 9`, 576×256), cropped to the **south row (y=128..191)** into a `9×64` strip. Gear is **un-tinted**; rarity is a runtime tint.
- **Both renderers assume a uniform 64px frame** and animate the 9-frame strip in lockstep:
  - Web `hero-renderer.ts` (PixiJS) slices every layer into `FRAME_SIZE`(64)-square frames `Rectangle(i*64,0,64,64)` on a 64×64 stage.
  - iOS `PixelHeroView` composites the same 64px layers (on the `swift-mobile-app` line — `ios/` is not on `main`).
- The build fails loudly on a blank sprite (`countOpaquePixels`) and on a frame-count/width mismatch — these guards stay.

## Phase 1 — Multi-layer 64px compositing (build tool only, low risk)

Generalize `loadDefFrame` into a loader that reads **every** `layer_N` on the def (not just `layer_1`), loads each layer's south strip for the build (applying the existing variant/cloth-recolor logic per layer), and composites them in ascending `zPos` order with the existing `over()`. The result is still a `9×64` strip at 64px — **no renderer change, no catalog change.**

- Handles a layer that is absent for a build (skip), a transparent background layer (no-op), and the crossbow case (art in `layer_2`).
- Keep the frame-count and blank-sprite guards on the **final composite** (a def whose only content is in `layer_2` now passes).
- The gear sprite's overall `zIndex` in the hero stack stays `GEAR_Z[category]`; intra-def `zPos` only orders that def's own layers.
- **Unlocks:** crossbow and any multi-layer melee/armor/shield def that stays on 64px sheets.
- **Task 1a:** refactor `loadDefFrame` → `loadDefStrip(def, build, variant)` iterating `layer_1..layer_N`.
- **Task 1b:** wire ~1 new multi-layer def into the `GEAR` array as a proof (e.g. restore a real crossbow), rerun `build-lpc`, confirm a non-blank distinct sprite + attribution rows.

## Phase 2 — Oversize `walk_128` support (build tool + BOTH renderers)

Big weapons render on 128px frames; a 128px weapon cannot fit a 64px frame, so this needs real geometry + renderer support. Do it **prototype-first** on one def (a normal bow) to pin the exact numbers before wiring many.

**Geometry (build tool):**
- Detect the layout from the def's `custom_animation` field and the fetched sheet's dimensions (assert, never assume): 128px frames → 4 direction rows × 128, **south row at y=256..383**; frame width 128.
- **Frame-count reconciliation:** the oversize walk sheet's column count may differ from the hero's 9-frame idle cadence (the rejected bow sheet is 1664×512 → 13 columns). The tool must map the walk animation's frames onto the hero's 9-frame strip (read the def's animation frame offsets, or resample), or the gear layer desyncs from the body during the idle animation. Pin this on the prototype.
- Emit an oversize strip as `9 × 128` (128-square frames) to a parallel path, and record geometry on the catalog entry.

**Catalog (`CatalogEntry` + `catalog.ts` generator):**
- Add optional `frameSize?: number` (default 64) and `offset?: {x,y}` (default centered, i.e. `-32,-32` for a 128 frame over a 64 body). Regenerate `catalog.ts`; update `catalog-integrity.test.ts`.

**Web renderer (`hero-renderer.ts`):**
- `sliceFrames` and `buildLayerSprite` honor per-layer `frameSize`; an oversize gear sprite is sliced at 128, positioned at the layer offset so its body-center aligns with the 64 stage center. The 64×64 `RenderTexture`/stage must allow the overflow to draw (enlarge the working canvas and re-center, keeping the *exported* hero visual box consistent), so a bow's tips aren't clipped.

**iOS renderer (`PixelHeroView`, `swift-mobile-app` line):**
- Mirror: draw an oversize gear layer at 2× frame size, centered on the same anchor. Lands on a branch off `swift-mobile-app`; reaches users via the normal back-merge.

**Tasks:** 2a geometry + detection + reconciliation (prototype on one bow); 2b catalog fields + generator + integrity test; 2c web renderer; 2d iOS renderer; 2e wire a batch of oversize defs (bows, wand, katana) once 2a–2d validate.

**Cheaper fallback (2-alt), if the renderer work isn't worth it yet:** bake-time **anchor-crop** the center 64×64 of each 128px south frame — no renderer/catalog change, but it **clips** overhang (bow tips, tall staves). Ship this only as an interim; it undercuts the point of oversize art.

## Sequencing & rollout

- **Phase 1 first** — pure build-tool win, unlocks multi-layer 64px art immediately, lands on `main`, flows to iOS with no iOS change.
- **Phase 2 after**, prototype-first; it is the actual "unlock oversize layouts" work and touches both renderers, so it is the larger, riskier half — validate geometry on one bow before committing to the batch.
- Art regeneration is a manual step (`pnpm --filter @workspace/scripts build-lpc`), committing the regenerated PNGs, `catalog.ts`, and `CREDITS.csv`. New defs carry their LPC attribution automatically; keep `CREDITS.csv` in the commit.
- Feeds the catalog expansion ([2026-09-07-gear-catalog-expansion.md](docs/superpowers/plans/2026-09-07-gear-catalog-expansion.md)): each newly-bakeable archetype becomes a real distinct sprite instead of a reused one.

## Risks / notes

- Phase 2 frame-count reconciliation is the main unknown — resolve empirically on the prototype (the original author vetted every current def by counting opaque south-row pixels; same discipline applies).
- Enlarging the render canvas for overflow must not shift the hero's visual centering elsewhere (avatar page, leaderboard, completion sheet) — verify the exported box stays consistent across all hero surfaces.
- Licensing: every unlocked def stays under its LPC license; attribution is emitted automatically into `CREDITS.csv` — no manual license work, but the file must ship with the art.
- No DB/schema/API changes — this is art tooling + rendering only.
