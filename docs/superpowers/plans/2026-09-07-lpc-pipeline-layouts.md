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

## Phase 2 — Oversize `walk_128` support (REFINED: build-tool-only, no renderer changes)

**This section was rewritten after empirically probing a real oversize asset (see "Phase 2 findings" below). The renderer work the original draft feared is NOT needed for the frame the hero actually shows.**

### What the probe found (bow `weapon_ranged_bow_normal`)

- The def has four layers: `layer_1/2` = a `universal` (64px) pair that ships **only** `shoot`/`hurt` sheets (no `walk` — so Phase 1's "skip a layer with no sheet" already handles them), and `layer_3/4` = a `walk`/`background`+`foreground` pair marked `custom_animation: "walk_128"`.
- The walk_128 sheet is `1664×512` = **13 cols × 4 rows of 128px frames**; **south is row 2 (y 256–383)**; sheets are per-color variants named `{prefix}{variant}.png` (e.g. `.../walk/foreground/brass.png`) — a different leaf convention from the standard `{prefix}walk/{variant}.png`.
- **Crucially:** every south walk frame's art sits at ~x51–75, y67–84 *within* the 128 cell — i.e. **entirely inside the body-centered 64×64 box** (x32–96, y288–352). Cropping that box is **lossless** (`opaque(center64) === opaque(full128)` on frames 0–2). Oversize only ever mattered for action poses (shoot) the hero never renders.

### The approach

Extend `loadLayerStrip` to handle a `custom_animation: "walk_128"` layer entirely in the build tool — no `CatalogEntry` field, no `hero-renderer.ts`, no iOS change:

1. **Detect** `layer.custom_animation === "walk_128"`.
2. **Fetch** at the walk_128 leaf convention: `{prefix}{variant}.png` (prefix already ends in the animation dir). Assert the sheet is a 128px-grid (`width % 128 === 0`, `height === 512`).
3. **Crop** the south row (y=256) and **anchor-crop the center 64×64** of each frame (x = f*128+32 .. +96, y = 288..352) into a standard 64px strip.
4. **Frame count:** the sheet has 13 columns, not 9. Sidestep reconciliation: **take frame 0 (the neutral standing pose) and replicate it across all 9 frames** → a static held weapon. Correct for a standing/idle hero; avoids mapping 13→9 cadence. (Animated oversize gear is a possible later enhancement requiring frame-semantic mapping — not needed now.)
5. **Lossless guard:** assert `opaque(center64 crop) === opaque(full 128 south frame 0)`. If an item's standing art genuinely overflows 64 (a tall drawn longbow, a raised staff), the build **fails loudly** for that item — the signal that it, and only it, needs the heavy path.

Phase 1's multi-layer composite already stacks the walk_128 bg+fg layers; Phase 1's skip-missing-layer already drops the content-less `universal` layers. So Phase 2 is a focused addition to the single-layer loader plus one geometry helper.

### Tasks

- **2a:** add `walk_128` detection + 128px south-crop + center-64 anchor + static-strip replication + lossless assert to `loadLayerStrip`; helper `cropSouth128Center(sheet, frame)`.
- **2b:** wire one bow into the `GEAR` array as proof; rerun `build-lpc`; confirm a non-blank, un-clipped 64px bow strip + attribution.
- **2c:** wire the remaining compatible oversize archetypes (other bows, wands, katana, boomerang) — each gated by the lossless assert; anything that fails is set aside for a possible future true-oversize renderer path (**2d, deferred, only-if-needed**: `frameSize`/`offset` on `CatalogEntry` + both renderers — kept in reserve, not built speculatively).

## Sequencing & rollout

- **Phase 1 — DONE** (multi-layer compositing + fetch hardening + neck-def drift fix; crossbow proven). Committed on `claude/dnd-lpc-pipeline`.
- **Phase 2 — refined above**, build-tool-only, prototype-first on one bow. Lands on `main`, flows to iOS via back-merge with **no iOS/renderer change** (the whole point of the refinement).
- Art regeneration is a manual step (`pnpm --filter @workspace/scripts build-lpc`), committing the regenerated PNGs, `catalog.ts`, and `CREDITS.csv`. New defs carry their LPC attribution automatically; keep `CREDITS.csv` in the commit. The build is now retry-hardened and fails loudly on a genuine 404, so upstream drift can't silently blank an asset again.
- Feeds the catalog expansion ([2026-09-07-gear-catalog-expansion.md](docs/superpowers/plans/2026-09-07-gear-catalog-expansion.md)): each newly-bakeable archetype becomes a real distinct sprite instead of a reused one.

## Risks / notes

- **Static vs animated oversize gear:** the refined approach holds oversize weapons still during the hero's idle (existing 64px weapons sway with the walk strip). Acceptable for held weapons on a standing hero; revisit only if it reads oddly.
- **Per-item lossless assert** is the safety net: if a standing pose overflows 64, that item errors rather than silently clipping — then it either gets set aside or motivates the deferred true-oversize path (2d).
- Licensing: every unlocked def stays under its LPC license; attribution is emitted automatically into `CREDITS.csv` — no manual license work, but the file must ship with the art.
- No DB/schema/API changes — art tooling only.
