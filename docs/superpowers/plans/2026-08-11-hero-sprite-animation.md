# Hero Sprite Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Animate the hero paper-doll (idle motion loop + a task-completion flourish) by replacing its static-canvas renderer with PixiJS, sourced from LPC walk-cycle frames the build pipeline already downloads but currently discards.

**Architecture:** `build-lpc-assets.ts` is changed to crop the *entire* south-facing walk row (9 frames, verified empirically — see Global Constraints) instead of just its first frame, for every layer it already bakes. `pixel-hero.tsx` is rewritten from a plain `CanvasRenderingContext2D` compositor to a mounted PixiJS `Application`, where each resolved layer becomes an `AnimatedSprite` driven in lockstep by one shared frame-index clock (a new pure, unit-tested module). A procedural scale-pop + particle burst (no new art) plays on the dashboard hero when the existing global `quest-completed` window event fires.

**Tech Stack:** PixiJS v8 (`pixi.js`), existing Vite + React 19 SPA, pngjs (build-time), vitest.

## Global Constraints

- Spec: [`docs/superpowers/specs/2026-08-11-hero-sprite-animation-design.md`](../specs/2026-08-11-hero-sprite-animation-design.md) — read it for the "why," this plan covers the "how."
- **Frame count is a hard constant: `FRAMES = 9`.** Verified empirically during planning (2026-08-11) by fetching 10 representative LPC `walk.png` sheets spanning body, head, eyes, hair, beard, glasses, earrings, outfit (shirt), weapon (sword), and armor (leather torso) — every one is exactly 576×256px (9 frames × 64px, 4 direction-rows × 64px). This closes the spec's "frame-count consistency" open question: no per-asset `frameCount` field is needed anywhere (not in `catalog.ts`, not at runtime) — one shared constant plus a build-time assertion (Task 1) is sufficient, and the assertion fails loudly if a future upstream asset ever violates it.
- `pixi.js` pinned as `^8.19.0` (latest at plan time) in `artifacts/focusquest/package.json`, following the existing convention there of direct (non-`catalog:`) versions for app-only deps (see `sharp`, `wouter`, `cmdk`).
- No new automated-testing infrastructure for `scripts/src/build-lpc-assets.ts` — that package has no test runner today (only a `typecheck` script; the file itself is `// @ts-nocheck`) and this plan doesn't introduce one. Its correctness is verified by actually running it (Task 1/3), matching how every prior change to this file was verified (see its own inline comments referencing "Task N report" — always a live-run verification, never a unit test).
- `artifacts/focusquest/vitest.config.ts` runs with `environment: "node"` — no DOM/canvas available in tests. New pure logic goes in DOM-free modules (Task 2) so it can be unit tested; the PixiJS-mounting component itself is verified by running the app in a browser (Task 5), matching the existing untested convention for `pixel-hero.tsx` and `kingdom-scene.tsx`.
- Every catalog-entry `.file` path stays the same — only the PNG behind it grows from 64×64 to 576×64. `catalog.ts`'s generated content is expected to be **byte-identical** after Task 3's regeneration (used as a regression check).

---

### Task 1: Build pipeline — crop the full animation row, not just frame 0

**Files:**
- Modify: `scripts/src/build-lpc-assets.ts:82-127` (crop function + `writePng`/pixel helpers area), `scripts/src/build-lpc-assets.ts:108-112` (`over`), `scripts/src/build-lpc-assets.ts:139-209` (`loadDefFrame` + `buildCosmetic` call sites), `scripts/src/build-lpc-assets.ts:165-180` (`buildOutfit`), `scripts/src/build-lpc-assets.ts:245-297` (body/hair/beard loops)

**Interfaces:**
- Produces: `cropSouthStrip(png)` — replaces `cropSouth(png)`. Same signature (one pngjs `PNG` in, one out); output is now `FRAMES*64` wide × 64 tall instead of 64×64, throws if the source row isn't exactly `FRAMES*64` wide. Every later task (2-5) treats every file under `public/lpc/**/*.png` as a `FRAMES`-frame horizontal strip because of this change.

- [ ] **Step 1: Add the `FRAMES` constant and `cropSouthStrip`, replacing `cropSouth`**

In `scripts/src/build-lpc-assets.ts`, replace the existing `cropSouth` function (currently around line 84-91):

```js
function cropSouth(png) {
  const out = new PNG({ width: 64, height: 64 });
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const si = ((128 + y) * png.width + x) * 4, di = (y * 64 + x) * 4;
    out.data[di] = png.data[si]; out.data[di + 1] = png.data[si + 1]; out.data[di + 2] = png.data[si + 2]; out.data[di + 3] = png.data[si + 3];
  }
  return out;
}
```

with:

```js
// FRAMES verified empirically (2026-08-11) against 10 representative LPC walk sheets spanning
// body/head/eyes/hair/beard/glasses/earrings/outfit/weapon/armor — every one is a 576x256
// (9-frame) walk sheet. Asserted, not assumed: a future upstream asset with a different frame
// count must fail the build loudly rather than silently desyncing that layer's animation from
// every other layer's (see cropSouthStrip below).
const FRAMES = 9;

// Crop the FULL south-facing row (not just its first frame, as the old cropSouth did) so every
// baked layer becomes an animated strip: width = FRAMES*64, height = 64.
function cropSouthStrip(png) {
  const width = png.width;
  if (width % 64 !== 0) {
    throw new Error(`malformed sheet: width ${width} is not a multiple of 64`);
  }
  if (width / 64 !== FRAMES) {
    throw new Error(`frame-count mismatch: expected ${FRAMES} frames (${FRAMES * 64}px wide), got ${width / 64} (${width}px wide)`);
  }
  const out = new PNG({ width, height: 64 });
  for (let y = 0; y < 64; y++) for (let x = 0; x < width; x++) {
    const si = ((128 + y) * png.width + x) * 4, di = (y * width + x) * 4;
    out.data[di] = png.data[si]; out.data[di + 1] = png.data[si + 1]; out.data[di + 2] = png.data[si + 2]; out.data[di + 3] = png.data[si + 3];
  }
  return out;
}
```

- [ ] **Step 2: Rename every call site from `cropSouth` to `cropSouthStrip`**

Six call sites, each a one-word rename (`cropSouth(` → `cropSouthStrip(`):

1. `loadDefFrame` (~line 147): `return { frame: cropSouth(sheet), credit: defCredit(def), zPos: layer.zPos };`
2. `buildCosmetic` (~line 202): `const frame = cropSouth(sheet);`
3. Eyes, in `main()` (~line 247): `const eyeLayer = eyes ? cropSouth(eyes) : null;`
4. Body loop, in `main()` (~line 255): `const bodyBase = cropSouth(bodySheet), headBase = cropSouth(headSheet);` (two occurrences on this line)
5. Hair loop, in `main()` (~line 273): `const base = cropSouth(sheet), src = detectSource(base, hairPal);`
6. Beard loop, in `main()` (~line 290): `const base = cropSouth(sheet), src = detectSource(base, hairPal);`

- [ ] **Step 3: Generalize `over()` to the strip's actual width**

Replace (currently ~line 108-112):

```js
function over(base, top) {
  const out = new PNG({ width: 64, height: 64 }); base.data.copy(out.data);
  for (let i = 0; i < out.data.length; i += 4) { const ta = top.data[i + 3] / 255; if (ta === 0) continue; for (let c = 0; c < 3; c++) out.data[i + c] = Math.round(top.data[i + c] * ta + out.data[i + c] * (1 - ta)); out.data[i + 3] = Math.max(out.data[i + 3], top.data[i + 3]); }
  return out;
}
```

with:

```js
function over(base, top) {
  const out = new PNG({ width: base.width, height: base.height }); base.data.copy(out.data);
  for (let i = 0; i < out.data.length; i += 4) { const ta = top.data[i + 3] / 255; if (ta === 0) continue; for (let c = 0; c < 3; c++) out.data[i + c] = Math.round(top.data[i + c] * ta + out.data[i + c] * (1 - ta)); out.data[i + 3] = Math.max(out.data[i + 3], top.data[i + 3]); }
  return out;
}
```

(`recolor` and `detectSource` already operate generically on `png.width`/`png.data.length` — confirmed by inspection, no change needed there.)

- [ ] **Step 4: Fix `buildOutfit`'s hardcoded 64×64 transparent base**

This is a real bug if left as-is: `buildOutfit` starts each outfit composite from a hardcoded 64×64 blank canvas, then `over()`s each part's now-576-wide frame onto it. Since Step 3 makes `over()` size its output from `base` (not `top`), a 64-wide base would silently truncate every outfit to a single garbled frame instead of throwing — the one place in this file where the width change needs a matching fix, not just a rename.

Replace (currently ~line 167, inside `buildOutfit`):

```js
    let img = new PNG({ width: 64, height: 64 }); // transparent base
```

with:

```js
    let img = new PNG({ width: FRAMES * 64, height: 64 }); // transparent base, one row per frame
```

- [ ] **Step 5: Verify against real sheets (no permanent test — this package has no test runner)**

Run this throwaway check from the repo root (uses the already-installed `pngjs` package via `scripts/node_modules`):

```bash
node --experimental-vm-modules -e "
import('C:/Users/Chadr/OneDrive/Documents/Quest-Companion/scripts/node_modules/pngjs/lib/png-sync.js').then(async ({ default: PNGSync }) => {
  const res = await fetch('https://raw.githubusercontent.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/master/spritesheets/body/bodies/male/walk.png');
  const buf = Buffer.from(await res.arrayBuffer());
  const png = PNGSync.read(buf);
  console.log('source:', png.width, 'x', png.height);
  if (png.width !== 576 || png.height !== 256) throw new Error('unexpected source size');
  console.log('OK: 9-frame assertion holds for a live sample sheet');
});
"
```

Expected output:
```
source: 576 x 256
OK: 9-frame assertion holds for a live sample sheet
```

This confirms the `width / 64 !== FRAMES` assertion added in Step 1 won't immediately throw against real data. The full pipeline (which exercises `cropSouthStrip`/`over`/`buildOutfit` end-to-end against every asset) is run and verified in Task 3, together with the renderer that consumes its output — regenerating assets now, before `pixel-hero.tsx` is updated, would leave the app visibly broken (a 576-wide strip drawn into a 64×64 box looks like 9 squashed frames) until Task 3 lands.

- [ ] **Step 6: Commit**

```bash
git add scripts/src/build-lpc-assets.ts
git commit -m "feat(hero): crop full LPC walk-cycle row instead of a single static frame"
```

This commit is safe standalone: nothing runs `build-lpc-assets.ts` automatically, and no committed asset changes yet, so the running app is unaffected until Task 3.

---

### Task 2: Pure frame-timing module

**Files:**
- Create: `artifacts/focusquest/src/lib/hero/sprite-animation.ts`
- Test: `artifacts/focusquest/src/lib/hero/sprite-animation.test.ts`

**Interfaces:**
- Consumes: nothing (pure math, no dependencies).
- Produces: `FRAME_SIZE = 64`, `FRAME_COUNT = 9`, `IDLE_FPS = 8`, and `idleFrameIndex(elapsedMs: number, fps?: number, frameCount?: number): number`. Task 3's `pixel-hero.tsx` imports all four.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/focusquest/src/lib/hero/sprite-animation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FRAME_COUNT, IDLE_FPS, idleFrameIndex } from "./sprite-animation";

describe("idleFrameIndex", () => {
  it("starts at frame 0", () => {
    expect(idleFrameIndex(0)).toBe(0);
  });

  it("holds frame 0 for the full duration of one frame", () => {
    const msPerFrame = 1000 / IDLE_FPS;
    expect(idleFrameIndex(msPerFrame - 1)).toBe(0);
  });

  it("advances to frame 1 exactly one frame-duration in", () => {
    const msPerFrame = 1000 / IDLE_FPS;
    expect(idleFrameIndex(msPerFrame)).toBe(1);
  });

  it("wraps back to frame 0 after a full cycle", () => {
    const msPerFrame = 1000 / IDLE_FPS;
    expect(idleFrameIndex(msPerFrame * FRAME_COUNT)).toBe(0);
  });

  it("respects a custom fps", () => {
    expect(idleFrameIndex(500, 2)).toBe(1); // 2fps -> 500ms/frame
    expect(idleFrameIndex(999, 2)).toBe(1);
    expect(idleFrameIndex(1000, 2)).toBe(0); // wraps (frameCount defaults to 9, but 2 cycles isn't a multiple check here — this just re-enters frame 0 momentarily before frame 1 at 1500ms)
  });

  it("respects a custom frameCount", () => {
    expect(idleFrameIndex(1000 / IDLE_FPS * 3, IDLE_FPS, 3)).toBe(0); // wraps at 3 frames
  });

  it("never returns a negative or out-of-range index", () => {
    for (let ms = 0; ms < 5000; ms += 37) {
      const idx = idleFrameIndex(ms);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(FRAME_COUNT);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/focusquest test -- sprite-animation`
Expected: FAIL — `Cannot find module './sprite-animation'` (or similar resolution error), since the module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `artifacts/focusquest/src/lib/hero/sprite-animation.ts`:

```ts
// Shared timing/geometry constants for the hero's animated LPC sprite strips. FRAME_COUNT is
// duplicated here (not imported from scripts/) rather than shared via a workspace package,
// matching this codebase's existing convention of small local geometry constants (see the
// standalone `FRAME = 64` in pixel-hero.tsx) — this is a single verified number, not a policy
// that needs one owner. See scripts/src/build-lpc-assets.ts's FRAMES constant and
// cropSouthStrip's build-time assertion for where that verification is enforced.
export const FRAME_SIZE = 64; // native LPC frame size, px
export const FRAME_COUNT = 9; // frames in the LPC south-facing walk row
export const IDLE_FPS = 8;

/**
 * Which frame of a looping FRAME_COUNT-frame strip should be showing right now, given how long
 * the animation has been running. Pure function so every layer sprite can be driven from the
 * same clock and stay in lockstep — see pixel-hero.tsx, which calls this once per tick and
 * applies the result to every layer's AnimatedSprite via gotoAndStop(), rather than letting each
 * sprite play independently (which could drift out of sync frame-to-frame).
 */
export function idleFrameIndex(
  elapsedMs: number,
  fps: number = IDLE_FPS,
  frameCount: number = FRAME_COUNT,
): number {
  const msPerFrame = 1000 / fps;
  return Math.floor(elapsedMs / msPerFrame) % frameCount;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/focusquest test -- sprite-animation`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/lib/hero/sprite-animation.ts artifacts/focusquest/src/lib/hero/sprite-animation.test.ts
git commit -m "feat(hero): add pure frame-timing module for sprite animation"
```

---

### Task 3: Regenerate LPC assets + rewrite `pixel-hero.tsx` for idle animation

This task lands the asset regeneration and the renderer rewrite **together in one commit** — regenerating alone would leave the app visibly broken (see Task 1, Step 5), and the renderer rewrite alone has nothing new to render. A reviewer accepts or rejects this pairing as one unit.

**Files:**
- Modify: `artifacts/focusquest/package.json` (add `pixi.js` dependency)
- Regenerate (via script, not hand-edited): `artifacts/focusquest/public/lpc/**/*.png`, `artifacts/focusquest/src/lib/hero/catalog.ts`, `artifacts/focusquest/public/lpc/CREDITS.csv`
- Modify: `artifacts/focusquest/src/components/pixel-hero.tsx` (full rewrite)

**Interfaces:**
- Consumes: `FRAME_SIZE`, `FRAME_COUNT`, `idleFrameIndex` from `@/lib/hero/sprite-animation` (Task 2); `resolveLayers`, `catalogById` from existing `@/lib/hero/resolve-layers` and `@/lib/hero/catalog` (unchanged); `HeroLook`, `ResolvedLayer` from `@/lib/hero/types` (unchanged).
- Produces: `PixelHero({ look, size?, className?, celebrateOn? })` — same public props as today plus a new optional `celebrateOn?: "questCompleted"` (wired in Task 4; this task adds the prop to the signature but the celebration effect itself is Task 4's job — accept the prop and no-op on it here, so Task 4 is a pure addition rather than a re-edit of the signature). Also exposes no new exports; `PixelHero` remains the sole export.

- [ ] **Step 1: Add the `pixi.js` dependency**

In `artifacts/focusquest/package.json`, add to `devDependencies` (alphabetical, matching the existing list's ordering):

```json
    "pixi.js": "^8.19.0",
```

(Insert it alphabetically between `"next-themes"` and `"react"`.)

Run: `pnpm install`
Expected: lockfile updates, install succeeds.

- [ ] **Step 2: Regenerate LPC assets**

Run: `pnpm --filter @workspace/scripts build-lpc`
Expected: ends with `DONE: <N> assets → public/lpc; catalog.ts + CREDITS.csv written.` (same `<N>` as before this change — the asset *count* doesn't change, only each asset's pixel width).

Verify the regenerated `catalog.ts` is unchanged in content (only `public/lpc/**/*.png` binaries should differ — `CatalogEntry` has no width/frame field, so nothing about the generated TypeScript should move):

```bash
git diff --stat artifacts/focusquest/src/lib/hero/catalog.ts
```

Expected: no output (zero-line diff). If this shows a diff, stop and investigate before continuing — it means something in Step 1-4 of Task 1 changed catalog shape unexpectedly.

Spot-check one regenerated file's real dimensions:

```bash
node -e "
const fs = require('fs');
const buf = fs.readFileSync('artifacts/focusquest/public/lpc/body/male_light.png');
console.log(buf.readUInt32BE(16), 'x', buf.readUInt32BE(20));
"
```

Expected: `576 x 64`.

- [ ] **Step 3: Rewrite `pixel-hero.tsx`**

Replace the full contents of `artifacts/focusquest/src/components/pixel-hero.tsx`:

```tsx
import { useEffect, useMemo, useRef } from "react";
import {
  Application, AnimatedSprite, Container, Texture, Rectangle,
} from "pixi.js";
import { resolveLayers } from "@/lib/hero/resolve-layers";
import { catalogById } from "@/lib/hero/catalog";
import { FRAME_SIZE, FRAME_COUNT, idleFrameIndex } from "@/lib/hero/sprite-animation";
import type { HeroLook, ResolvedLayer } from "@/lib/hero/types";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Tint a whole frame-strip image toward `tint` while preserving its alpha + shading (gear
 *  rarity) — same source-atop technique the old single-frame drawTinted used, just applied to
 *  the full strip at once (each of its FRAME_COUNT frames gets tinted identically in one pass,
 *  since it's one continuous image). */
function tintStrip(img: HTMLImageElement, tint: string): HTMLCanvasElement {
  const off = document.createElement("canvas");
  off.width = img.width;
  off.height = img.height;
  const ctx = off.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = "source-atop";
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, off.width, off.height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  return off;
}

/** Slice a loaded FRAME_COUNT-wide strip texture into FRAME_SIZE-square per-frame textures. */
function sliceFrames(strip: Texture): Texture[] {
  const frames: Texture[] = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    frames.push(new Texture({
      source: strip.source,
      frame: new Rectangle(i * FRAME_SIZE, 0, FRAME_SIZE, FRAME_SIZE),
    }));
  }
  return frames;
}

async function buildLayerSprite(layer: ResolvedLayer): Promise<AnimatedSprite | null> {
  let img: HTMLImageElement;
  try {
    img = await loadImage(layer.file);
  } catch {
    return null; // a missing/failed layer is skipped; the rest still render
  }
  const source = layer.tint ? tintStrip(img, layer.tint) : img;
  const strip = Texture.from(source);
  return new AnimatedSprite({ textures: sliceFrames(strip), autoPlay: false, loop: true });
}

export function PixelHero({
  look,
  size = 160,
  className,
  celebrateOn: _celebrateOn,
}: {
  look: HeroLook;
  size?: number;
  className?: string;
  /** Wired up in a follow-up change; accepted here so the prop lands once. */
  celebrateOn?: "questCompleted";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const stageRef = useRef<Container | null>(null);

  const lookKey = JSON.stringify(look);
  const layers: ResolvedLayer[] = useMemo(
    () => resolveLayers(look, catalogById),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lookKey],
  );

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    let cancelled = false;
    let initialized = false;
    const app = new Application();
    let tickHandler: (() => void) | null = null;

    (async () => {
      await app.init({
        width: FRAME_SIZE, height: FRAME_SIZE, backgroundAlpha: 0, antialias: false,
      });
      if (cancelled) {
        app.destroy(true, { children: true, texture: true, textureSource: true });
        return;
      }
      initialized = true;
      appRef.current = app;
      host.appendChild(app.canvas);

      // Pivot + position at the visual center so a future scale (the completion flourish) pops
      // from the center rather than the top-left corner. At scale=1 (idle) this is a no-op:
      // absolute position = (position - pivot) + local = local, identical to no pivot at all.
      const stage = new Container();
      stage.pivot.set(FRAME_SIZE / 2, FRAME_SIZE / 2);
      stage.position.set(FRAME_SIZE / 2, FRAME_SIZE / 2);
      app.stage.addChild(stage);
      stageRef.current = stage;

      const sprites = await Promise.all(layers.map(buildLayerSprite));
      if (cancelled) return; // torn down by the cleanup below once `initialized` is observed
      for (const s of sprites) if (s) stage.addChild(s);

      const start = performance.now();
      tickHandler = () => {
        const idx = idleFrameIndex(performance.now() - start);
        for (const s of sprites) s?.gotoAndStop(idx);
      };
      app.ticker.add(tickHandler);
    })();

    return () => {
      cancelled = true;
      if (!initialized) return; // init() hasn't resolved yet; the async block above tears itself down
      if (tickHandler) app.ticker.remove(tickHandler);
      appRef.current = null;
      stageRef.current = null;
      app.destroy(true, { children: true, texture: true, textureSource: true });
    };
  }, [layers]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: size, height: size, imageRendering: "pixelated" }}
      role="img"
      aria-label={`${look.build} ${look.avatarClass} hero`}
    />
  );
}
```

Note on the `initialized` guard: React 18 (including StrictMode's dev-only double-invoke) can unmount a component before an in-flight `app.init()` promise resolves. Destroying a `pixi.Application` before it's finished initializing is unsafe; destroying it twice throws ("After calling destroy... further operations will throw errors" per Pixi's own docs). The guard ensures exactly one `destroy()` call, and only after `init()` has actually completed — either from the cleanup function (if unmount happens after init) or from inside the async block itself (if unmount happens before init resolves, caught by the `cancelled` check right after `await app.init(...)`).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: no errors.

- [ ] **Step 5: Manual browser check (no automated test — matches this component's existing untested convention)**

Start the dev server and confirm the hero portrait on `/avatar` shows a looping in-place animation instead of a static pose (see Task 5 for the full cross-surface pass — this step is just "does it render at all" before moving on).

- [ ] **Step 6: Commit**

```bash
git add artifacts/focusquest/package.json pnpm-lock.yaml artifacts/focusquest/public/lpc artifacts/focusquest/src/lib/hero/catalog.ts artifacts/focusquest/src/components/pixel-hero.tsx
git commit -m "feat(hero): animate the hero sprite via PixiJS (idle motion loop)"
```

---

### Task 4: Task-completion flourish

**Files:**
- Modify: `artifacts/focusquest/src/components/pixel-hero.tsx` (add the flourish + wire up `celebrateOn`)
- Modify: `artifacts/focusquest/src/components/hero-summary.tsx:65` (pass `celebrateOn="questCompleted"`)

**Interfaces:**
- Consumes: the existing `QUEST_COMPLETED_EVENT` (`"quest-completed"`) window `CustomEvent`, already dispatched today by `dispatchQuestCompleted()` in `dopamine-overlay.tsx` from `task-item.tsx`, `use-micro-step.ts`, and `questline-detail.tsx`. This task only adds a second listener for the same event — it does not touch the dispatch side.
- Produces: `PixelHero`'s `celebrateOn` prop becomes live (was accepted-but-unused after Task 3).

- [ ] **Step 1: Add the flourish effect and event wiring to `pixel-hero.tsx`**

In `artifacts/focusquest/src/components/pixel-hero.tsx`, add these imports (extend the existing `pixi.js` import line):

```tsx
import {
  Application, AnimatedSprite, Container, Graphics, Texture, Rectangle,
} from "pixi.js";
```

and add `useRef`'s sibling import if not already present — `useEffect, useMemo, useRef` is already imported from `"react"`, no change needed there.

Add this constant and function above the `PixelHero` component (after `buildLayerSprite`):

```tsx
const QUEST_COMPLETED_EVENT = "quest-completed";

type ActiveFlourish = { tick: () => void; burst: Container };

/** A brief scale-pop + sparkle burst layered over the hero on task completion. Pure Pixi
 *  primitives, no new sprite frames — works identically for every hero regardless of which
 *  gear/hair/outfit item's source art has animation coverage (some third-party LPC add-on packs
 *  only ship a single static frame, not a full row — see the design doc). Self-removes when
 *  finished; `activeRef` lets a re-trigger mid-flourish cancel the old one instead of stacking
 *  two competing scale tweens on the same stage. */
function playCompletionFlourish(
  app: Application,
  stage: Container,
  activeRef: { current: ActiveFlourish | null },
) {
  const prev = activeRef.current;
  if (prev) {
    app.ticker.remove(prev.tick);
    prev.burst.destroy({ children: true });
    stage.scale.set(1);
  }

  const burst = new Container();
  stage.addChild(burst);

  const sparkleColors = [0xffd76a, 0xffe9a8, 0xffffff];
  const sparkles = Array.from({ length: 6 }, (_, i) => {
    const g = new Graphics().circle(0, 0, 2 + (i % 2)).fill(sparkleColors[i % sparkleColors.length]);
    burst.addChild(g);
    return { g, angle: (i / 6) * Math.PI * 2 };
  });

  const DURATION_MS = 550;
  const start = performance.now();
  const tick = () => {
    const t = Math.min(1, (performance.now() - start) / DURATION_MS);
    const eased = 1 - (1 - t) * (1 - t); // ease-out
    stage.scale.set(1 + Math.sin(eased * Math.PI) * 0.18);
    for (const { g, angle } of sparkles) {
      const dist = eased * 22;
      g.position.set(Math.cos(angle) * dist, Math.sin(angle) * dist);
      g.alpha = 1 - eased;
    }
    if (t >= 1) {
      app.ticker.remove(tick);
      stage.scale.set(1);
      burst.destroy({ children: true });
      if (activeRef.current?.tick === tick) activeRef.current = null;
    }
  };
  app.ticker.add(tick);
  activeRef.current = { tick, burst };
}
```

Change the component signature to actually use `celebrateOn` (remove the `_celebrateOn` placeholder from Task 3):

```tsx
export function PixelHero({
  look,
  size = 160,
  className,
  celebrateOn,
}: {
  look: HeroLook;
  size?: number;
  className?: string;
  /** Opt in to a completion flourish on the existing global "quest-completed" event (see
   *  dopamine-overlay.tsx). Only pass this on a hero display the user is actually looking at
   *  right after completing something — e.g. the dashboard hero, not an ally's or a body-double
   *  room participant's, since the event carries no hero identity and fires for the *viewer's*
   *  own completions regardless of whose hero is on screen. */
  celebrateOn?: "questCompleted";
}) {
```

Add a new ref alongside the existing `appRef`/`stageRef`:

```tsx
  const activeFlourishRef = useRef<ActiveFlourish | null>(null);
```

In the main mount `useEffect`'s cleanup function, clear any in-flight flourish before destroying the app (add this as the first line inside the `if (!initialized) return;` guard's following block, i.e. right after that guard):

```tsx
      if (!initialized) return;
      if (activeFlourishRef.current) {
        app.ticker.remove(activeFlourishRef.current.tick);
        activeFlourishRef.current = null;
      }
      if (tickHandler) app.ticker.remove(tickHandler);
```

Add a second `useEffect`, after the existing mount effect, that subscribes to the completion event:

```tsx
  useEffect(() => {
    if (!celebrateOn) return;
    const handler = () => {
      const app = appRef.current;
      const stage = stageRef.current;
      if (app && stage) playCompletionFlourish(app, stage, activeFlourishRef);
    };
    window.addEventListener(QUEST_COMPLETED_EVENT, handler);
    return () => window.removeEventListener(QUEST_COMPLETED_EVENT, handler);
  }, [celebrateOn]);
```

- [ ] **Step 2: Wire up the dashboard hero**

In `artifacts/focusquest/src/components/hero-summary.tsx:65`, change:

```tsx
            <PixelHero look={look} size={128} />
```

to:

```tsx
            <PixelHero look={look} size={128} celebrateOn="questCompleted" />
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: no errors.

- [ ] **Step 4: Manual browser check**

Covered as part of Task 5's full pass (triggering a real task completion while viewing the hero on `/progress`).

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/components/pixel-hero.tsx artifacts/focusquest/src/components/hero-summary.tsx
git commit -m "feat(hero): add task-completion flourish to the dashboard hero sprite"
```

---

### Task 5: Cross-surface verification

No new code — this task is a manual pass confirming the previous four tasks work together in the real app, and specifically checks the WebGL-context-leak risk the design doc flagged for `body-double-room.tsx` (multiple `PixelHero` instances mounted/unmounted concurrently).

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server and confirm the pipeline change didn't break anything else that reads `public/lpc/`**

Use the `run` skill (or `preview_start`) to launch the app, then visit `/avatar` (the hero customization screen). Confirm:
- The hero portrait shows a continuous looping in-place motion (not a static pose, not a squashed/garbled image).
- Changing any customization option (hair, outfit, gear, etc.) still updates the hero correctly and keeps animating.
- No console errors (check via `read_console_messages`), particularly no WebGL context-creation warnings.

- [ ] **Step 2: Confirm the completion flourish on `/progress`**

`hero-summary.tsx` (the dashboard hero with `celebrateOn`) is rendered on the `/progress` page, not the app's home screen (`/`, `NowScreen`) — this matches the spec's scope ("wherever the hero portrait already appears today"), but means the flourish is only visible while actually viewing `/progress`, not immediately after completing a task elsewhere in the app. This is expected, not a bug to fix in this plan.

Navigate to `/progress`, then complete a task (either from `/tasks`/`/` in another tab/session, or via any in-page completion control that also lives on `/progress`, if one exists). Confirm:
- The hero sprite pops (scale bounce) and shows a brief radiating sparkle burst.
- The animation ends cleanly (hero returns to normal idle scale, no leftover sparkles).
- Triggering a second completion while the flourish is still playing restarts it cleanly (no visual glitching, no stacked/competing scale animations) — this exercises the `activeFlourishRef` guard from Task 4.

- [ ] **Step 3: Confirm non-reactive surfaces stay idle-only**

Visit `/partners/:id` for an existing ally (skip if no test ally is available in your dev account) and open a body-double room with at least one other participant (skip if unavailable). Confirm both show idle animation only — no flourish reaction to your own task completions, matching the design's explicit scope (the event carries no hero identity, so only the dashboard hero opts in).

- [ ] **Step 4: WebGL context leak check on `body-double-room.tsx`**

This is the scenario the design doc explicitly flagged as an open risk (multiple `PixelHero` instances — one per room participant — mounting/unmounting a `pixi.Application` each).

- Open a body-double room with 2+ participants.
- Navigate away from the room and back at least 5 times in a row.
- Check `read_console_messages` for any WebGL warnings like "Too many active WebGL contexts" or similar browser-level resource warnings.

Expected: none. If warnings appear, the `initialized`/`cancelled` destroy-guard logic in Task 3's `pixel-hero.tsx` needs revisiting before this ships — do not treat that as this task's job to fix silently; surface it.

- [ ] **Step 5: Full test suite + typecheck**

Run: `pnpm --filter @workspace/focusquest test`
Expected: all pass, including the new `sprite-animation.test.ts` from Task 2.

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: no errors.

No commit for this task (verification only, no file changes). If any step surfaces a real bug, fix it as a new small commit on top of the relevant earlier task before considering the plan complete.
