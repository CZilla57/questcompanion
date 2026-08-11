# Hero Sprite Animation — Design

## Context

The hero is currently a static, single-pose paper-doll: `pixel-hero.tsx` composites
independently-chosen layer PNGs (body, hair, beard, glasses, earrings, outfit, gear)
onto one `<canvas>` with a single `drawImage` per layer, redrawn only when the hero's
`look` changes. There is no animation anywhere in the hero-rendering path.

This is the first step toward a longer-term "more of a real game" arc (interactive
overworld exploration, combat-style feedback, a D&D-style campaign layer). That full
arc is out of scope here — see Non-Goals. This spec covers only the rendering/animation
foundation and its first two applications: an idle motion loop and a task-completion
flourish, wherever the hero portrait already appears today.

`kingdom-scene.tsx` (Life Kingdoms map rendering) already contains a `// THE RENDERER
SEAM` comment anticipating a swap from static-image canvas to PixiJS "later." This spec
is that swap, applied first to the hero (the higher-value, more frequently seen surface),
with the kingdom scene left untouched for now.

## Goals

- Give the hero sprite a continuous idle animation instead of a static pose.
- Give the hero sprite a one-shot celebratory flourish when the user completes a task,
  on the dashboard hero display.
- Establish a sprite-rendering foundation (PixiJS + multi-frame LPC art) that the later
  interactive-exploration and combat-feedback phases can build on without redoing this
  work.

## Non-Goals

- Interactive/movable hero (clicking, walking around a scene) — future spec.
- Combat/boss encounter animation — future spec.
- The D&D-style campaign layer (narrative overworld + encounters + AI narration) —
  future spec(s), informed by this foundation but not designed here.
- Changes to `kingdom-scene.tsx` — the renderer seam stays static-image for now; it can
  adopt the same PixiJS approach later using the pattern this spec establishes.

## Approach

**Renderer: PixiJS.** Chosen over hand-rolled canvas `requestAnimationFrame` because the
long-term roadmap (movement, combat effects, eventually a real scene) will keep needing
sprite-renderer primitives (textures, tickers, filters) that would otherwise be
reinvented piecemeal. It's also the renderer the existing seam comment already
anticipates. Adds one new dependency (`pixi.js`) to `artifacts/focusquest`.

**Animation source: the LPC walk cycle, not new art.** `build-lpc-assets.ts` already
fetches a `walk.png` sheet for every single layer it bakes (body, hair, beard, outfit,
gear, glasses, earrings) and crops out only frame 0 of the south-facing row
(`cropSouth`, y=128, x=0..63) as today's static pose. The rest of that row — a full
south-facing walk cycle, already downloaded, already licensed, already covering every
`hero-options` combination the build's `assertCoverage()` check verifies — is discarded.
Cropping the *entire* south row instead of just its first frame turns every existing
layer into an animated strip for free: no new network fetches, no new art, no new
per-item coverage risk.

This strip is used for **idle motion** (looped continuously). It's a walk cycle, so the
idle look is "gentle in-place motion," not a breathing loop — that's an accepted
trade-off for guaranteed full-roster coverage with zero new art.

**Completion flourish: procedural, not new frames.** A scale-pop + small particle-burst
effect built from PixiJS primitives (tween + `Graphics`), not sourced from any
animation row. This guarantees it works identically for every hero regardless of which
gear/hair/outfit item's source sheet has full animation coverage.

## Data pipeline changes (`scripts/src/build-lpc-assets.ts`)

- `cropSouth(png)` (crops one 64×64 frame) becomes a row-width crop: output width =
  `png.width` (source sheet width), height 64, still starting at y=128. Every call site
  that currently assumes a 64×64 frame (`over`, `recolor`, `detectSource`,
  `countOpaquePixels`, `writePng`) already operates generically on `png.data.length`, so
  they carry over unchanged — the only real work is updating call sites that hardcode
  `64` for width and propagating actual per-asset frame width through to `catalog.ts`.
- `catalog.ts` entries (`CatalogEntry`) gain a `frameCount` field per asset, computed as
  `png.width / 64` at bake time.
- **Frame-count consistency check**: not every source `walk.png` is guaranteed to have
  the same frame count as every other. Add a build-time assertion (alongside the
  existing `assertCoverage()`) that every baked layer for a given hero combination
  shares one frame count, or — if that turns out to be false in practice — compute and
  export the minimum frame count across a hero's active layers so playback stays in
  lockstep. This needs to be checked empirically against the real upstream sheets during
  implementation; the plan should budget time for it.
- Output size grows roughly in proportion to frame count (previously 1 frame → ~9
  frames per layer, typical ULPC walk row). Still small in absolute terms (each frame is
  64×64); not a concern at this scale but worth a sanity check on total `public/lpc`
  size after regeneration.

## Component architecture

- `resolve-layers.ts` and `catalog.ts` stay pure/unchanged in shape (just carry more
  data per entry). Follows the existing split already used for kingdoms
  (`kingdom-scene.ts` pure resolver vs. `kingdom-scene.tsx` renderer).
- New pure module, e.g. `hero-sprite-animation.ts`: frame-index/timing math (what frame
  is "now" given elapsed time and fps), independent of Pixi or React — testable without
  a canvas.
- `pixel-hero.tsx` is rewritten to mount a PixiJS `Application` (sized to the existing
  64px logical frame, scaled via CSS as today) instead of drawing to a plain
  `CanvasRenderingContext2D`. Each resolved layer becomes one `AnimatedSprite` (or
  static `Sprite` if `frameCount === 1`, e.g. a layer that genuinely only has one
  frame), stacked in the existing z-order. All layer sprites read their current frame
  from the single shared frame-index module above (not each sprite's own independent
  `play()`) so they can never visually drift out of sync with each other.
- **Tint (gear rarity)** is currently baked via `drawTinted`: draw the layer to an
  offscreen canvas, `source-atop` composite a tint color at 55% alpha, preserving the
  original alpha/shading. This is kept as-is, applied once per frame of a layer's strip
  at load time (not per-render), producing a small set of pre-tinted canvases that
  become the `AnimatedSprite`'s textures. This exactly preserves current tint visuals
  and avoids needing a Pixi filter equivalent.
- Per-layer image load failures keep today's resilience: `Promise.allSettled`, skip a
  failed layer, render the rest. If `pixi.js` itself can't acquire a renderer context,
  Pixi v8 auto-falls-back across WebGL/WebGPU/canvas, so no explicit fallback path is
  needed here.
- `PixelHero` gains an opt-in flourish trigger — see below — but idle motion is
  unconditional (every usage site gets it automatically; no prop needed to turn on the
  baseline animation).

## Completion flourish wiring

Task completion already dispatches a global signal for exactly this kind of reaction:
`dispatchQuestCompleted()` fires a `window` `CustomEvent("quest-completed")`, currently
consumed by `dopamine-overlay.tsx`. The flourish reuses this event rather than inventing
a second notification path.

Because the event carries no hero identity (it just means "the current user completed
something, somewhere"), only the hero display the user is actually looking at right
after completing a task should react — not every `PixelHero` instance on screen. Concretely:

- `hero-summary.tsx` (dashboard) opts in via a new `celebrateOn="questCompleted"` prop.
- `avatar.tsx` (customization screen) — left non-reactive for now; not the natural
  moment for a completion flourish and out of scope to reconsider here.
- `partner-detail.tsx` / `body-double-room.tsx` (viewing *other* users' heroes) — must
  never react to the viewer's own completions; stays idle-only by default (no prop
  passed).

## Testing

- Pure frame-timing module (`hero-sprite-animation.ts`): unit tests, no canvas/DOM
  needed.
- `build-lpc-assets.ts` crop/frame-count logic: extend existing coverage in whatever
  test harness the build script already has (check during planning — the script is
  `// @ts-nocheck` and run standalone via `pnpm --filter @workspace/scripts build-lpc`,
  so verify current test coverage before assuming a pattern to extend).
- Component-level: PixiJS `Application` mounting/unmounting in a React `useEffect` needs
  a real cleanup check (destroy on unmount) to avoid leaking WebGL contexts across the 5
  existing `PixelHero` usage sites, especially `body-double-room.tsx` which may render
  several heroes concurrently.

## Risks / open questions for the implementation plan

1. Whether every layer type's source `walk.png` truly shares one frame count — needs
   empirical verification against the live LPC repo (same kind of check the existing
   pipeline already does for coverage/blank-sprite defects).
2. Whether one PixiJS `Application` per `PixelHero` instance is cheap enough for
   `body-double-room.tsx` (potentially several heroes rendered at once), or whether a
   shared renderer/application is needed. Worth a quick perf check early in
   implementation rather than deciding upfront here.
