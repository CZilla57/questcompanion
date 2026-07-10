# Layered Pixel Hero — Implementation Plan (Phase 0 + 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the baked-PNG avatar with a composable, LPC-based layered pixel character that supports physical customization (skin tone, hair style + color, body build, face), rendered on a canvas — built gear-ready so Phase 2 only adds gear data + tint.

**Architecture:** A pure `resolveLayers(look, catalog)` function turns a `HeroLook` descriptor into an ordered list of layer files (by catalog z-index). A `PixelHero` React component draws those layer PNGs onto a 64×64 canvas scaled up with `image-rendering: pixelated`. Assets are LPC exports committed under `public/lpc/**`, described by a typed `catalog.ts`. New `users` columns + an extended `/avatar` API carry the physical attributes.

**Tech Stack:** React 19 + Vite 7, wouter, @tanstack/react-query, Tailwind 4, Express 5, Drizzle ORM (Neon, `drizzle-kit push`), Orval (OpenAPI → react-query + zod), vitest (new, focusquest only).

## Global Constraints

- Package manager is **pnpm** only (root `preinstall` rejects npm/yarn). Run workspace scripts with `pnpm --filter <pkg> <script>`.
- New dependencies must satisfy `minimumReleaseAge: 1440` (≥1 day old) and `autoInstallPeers: false` — pin known-stable versions.
- Shared dep versions come from the `catalog:` in `pnpm-workspace.yaml`; reuse catalog entries where one exists.
- **LPC art assets only — never import or vendor the LPC generator's code** (it is GPL; assets stay confined to `public/`).
- Every bundled asset must have an attribution entry (author + license + source URL) in the catalog; a test enforces this.
- Schema changes are applied with `pnpm --filter @workspace/db push` (there are **no** migration files in this repo).
- API contract changes go through `lib/api-spec/openapi.yaml` then `pnpm --filter @workspace/api-spec codegen` (never hand-edit generated files under `lib/api-client-react/src/generated` or `lib/api-zod/src/generated`).
- `avatarSkin` allowed values already exist in the DB/route: `light, tan, brown, dark, green, blue`. Reuse them verbatim.
- Work happens on branch `feat/layered-hero-character` (already checked out).
- Server-side API changes are verified via `codegen` + `pnpm typecheck` + preview (this repo has no server test runner; do **not** stand one up in this plan).

## File Structure

**New (focusquest client):**
- `artifacts/focusquest/vitest.config.ts` — vitest config (node environment).
- `artifacts/focusquest/src/lib/hero/types.ts` — shared hero/catalog types.
- `artifacts/focusquest/src/lib/hero/resolve-layers.ts` — pure layer resolver.
- `artifacts/focusquest/src/lib/hero/resolve-layers.test.ts` — resolver tests.
- `artifacts/focusquest/src/lib/hero/catalog.ts` — asset catalog (entries + `catalogById` map).
- `artifacts/focusquest/src/lib/hero/catalog.test.ts` — catalog integrity + attribution tests.
- `artifacts/focusquest/src/components/pixel-hero.tsx` — canvas compositor component.
- `artifacts/focusquest/src/components/hero-credits.tsx` — attribution list view.
- `artifacts/focusquest/public/lpc/**` — exported LPC layer PNGs + `CREDITS.csv`.

**Modified:**
- `artifacts/focusquest/package.json` — add vitest + `test` script.
- `lib/db/src/schema/users.ts` — new avatar columns.
- `lib/db/src/schema/gear.ts` — `spriteId` column.
- `artifacts/api-server/src/routes/avatar.ts` — read/validate/return new fields.
- `lib/api-spec/openapi.yaml` — extend Avatar schemas.
- `artifacts/focusquest/src/pages/avatar.tsx` — new customization controls + `PixelHero`.
- `artifacts/focusquest/src/components/avatar-renderer.tsx` — removed after call sites migrate.

**Naming conventions (locked here so every task is deterministic):**
- Catalog id scheme: `body:{build}:{skin}`, `hair:{style}:{color}`, `face:{face}`, `outfit:{class}:t{tier}:{build}`, `gear:{spriteId}:{build}`.
- File path scheme under `public/lpc/`: `body/{build}_{skin}.png`, `hair/{style}_{color}.png`, `face/{face}.png`, `outfit/{class}_t{tier}_{build}.png`, `gear/{spriteId}_{build}.png`.
- Enum values: `build ∈ {slim, average, broad}`; `skin ∈ {light, tan, brown, dark, green, blue}`; `hairStyle ∈ {bald, short, long, ponytail, mohawk}`; `hairColor ∈ {brown, black, blonde, red, white, blue}`; `face ∈ {neutral, stern, smile}`; `class ∈ {fighter, mage, ranger, healer}`; `tier ∈ {0,1,2,3}`.
- z-index (back→front): aura 0, body 10, face 20, hair 30, outfit 40, boots 50, armor 60, helmet 70, weapon 80, accessory 90.

---

### Task 1: Vitest setup in focusquest

**Files:**
- Modify: `artifacts/focusquest/package.json`
- Create: `artifacts/focusquest/vitest.config.ts`
- Test: `artifacts/focusquest/src/lib/hero/sanity.test.ts` (temporary)

**Interfaces:**
- Consumes: nothing.
- Produces: a working `pnpm --filter @workspace/focusquest test` command running vitest.

- [ ] **Step 1: Add vitest devDependency and test script**

In `artifacts/focusquest/package.json`, add to `devDependencies`:

```json
"vitest": "^2.1.9"
```

Add to `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: completes; `vitest` resolved into `node_modules/.bin`.

- [ ] **Step 3: Create vitest config**

Create `artifacts/focusquest/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
```

- [ ] **Step 4: Add a temporary sanity test**

Create `artifacts/focusquest/src/lib/hero/sanity.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("vitest wiring", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the test to verify the runner works**

Run: `pnpm --filter @workspace/focusquest test`
Expected: PASS — 1 passed.

- [ ] **Step 6: Delete the sanity test and commit**

Delete `artifacts/focusquest/src/lib/hero/sanity.test.ts`.

```bash
git add artifacts/focusquest/package.json artifacts/focusquest/vitest.config.ts pnpm-lock.yaml
git commit -m "chore(focusquest): add vitest test runner"
```

---

### Task 2: Hero types + `resolveLayers` (TDD)

**Files:**
- Create: `artifacts/focusquest/src/lib/hero/types.ts`
- Create: `artifacts/focusquest/src/lib/hero/resolve-layers.ts`
- Test: `artifacts/focusquest/src/lib/hero/resolve-layers.test.ts`

**Interfaces:**
- Consumes: nothing (types are self-contained).
- Produces:
  - Types `Build, Skin, HairStyle, HairColor, FaceId, AvatarClass, Rarity, GearSlot, LayerCategory, CatalogEntry, EquippedGearLook, HeroLook, ResolvedLayer` (see code).
  - `resolveLayers(look: HeroLook, catalogById: Map<string, CatalogEntry>): ResolvedLayer[]` — ordered back→front by `zIndex`, gear layers carry a rarity `tint`, missing ids are skipped.

- [ ] **Step 1: Write the types file** (needed by the test; not itself a test step)

Create `artifacts/focusquest/src/lib/hero/types.ts`:

```typescript
export type Build = "slim" | "average" | "broad";
export type Skin = "light" | "tan" | "brown" | "dark" | "green" | "blue";
export type HairStyle = "bald" | "short" | "long" | "ponytail" | "mohawk";
export type HairColor = "brown" | "black" | "blonde" | "red" | "white" | "blue";
export type FaceId = "neutral" | "stern" | "smile";
export type AvatarClass = "fighter" | "mage" | "ranger" | "healer";
export type Rarity = "common" | "rare" | "epic" | "legendary";
export type GearSlot = "weapon" | "helmet" | "armor" | "boots" | "accessory";

export type LayerCategory =
  | "aura" | "body" | "face" | "hair" | "outfit"
  | "boots" | "armor" | "helmet" | "weapon" | "accessory";

export interface CatalogEntry {
  id: string;
  category: LayerCategory;
  zIndex: number;
  file: string;        // absolute public path, e.g. "/lpc/body/average_light.png"
  author: string;
  license: string;
  sourceUrl: string;
}

export interface EquippedGearLook {
  slot: GearSlot;
  spriteId: string;    // resolves to catalog id `gear:{spriteId}:{build}`
  rarity: Rarity;
}

export interface HeroLook {
  skin: Skin;
  build: Build;
  hairStyle: HairStyle;
  hairColor: HairColor;
  face: FaceId;
  avatarClass: AvatarClass;
  tier: 0 | 1 | 2 | 3;
  equipped: EquippedGearLook[];
}

export interface ResolvedLayer {
  file: string;
  zIndex: number;
  tint?: string;       // hex, gear layers only
}

export const RARITY_TINT: Record<Rarity, string | undefined> = {
  common: undefined,
  rare: "#3b82f6",
  epic: "#a855f7",
  legendary: "#f59e0b",
};

const GEAR_CATEGORIES: ReadonlySet<LayerCategory> = new Set([
  "weapon", "helmet", "armor", "boots", "accessory",
]);

export function isGearCategory(c: LayerCategory): boolean {
  return GEAR_CATEGORIES.has(c);
}
```

- [ ] **Step 2: Write the failing test**

Create `artifacts/focusquest/src/lib/hero/resolve-layers.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { resolveLayers } from "./resolve-layers";
import type { CatalogEntry, HeroLook } from "./types";

function cat(entries: CatalogEntry[]): Map<string, CatalogEntry> {
  return new Map(entries.map((e) => [e.id, e]));
}

const base = (id: string, category: CatalogEntry["category"], zIndex: number): CatalogEntry => ({
  id, category, zIndex, file: `/lpc/${id}.png`, author: "a", license: "CC0", sourceUrl: "u",
});

const look: HeroLook = {
  skin: "light", build: "average", hairStyle: "short", hairColor: "brown",
  face: "neutral", avatarClass: "fighter", tier: 0, equipped: [],
};

const fullCatalog = cat([
  base("body:average:light", "body", 10),
  base("face:neutral", "face", 20),
  base("hair:short:brown", "hair", 30),
  base("outfit:fighter:t0:average", "outfit", 40),
  base("gear:iron-helm:average", "helmet", 70),
]);

describe("resolveLayers", () => {
  it("returns body, face, hair, outfit ordered by zIndex for an ungeared hero", () => {
    const layers = resolveLayers(look, fullCatalog);
    expect(layers.map((l) => l.file)).toEqual([
      "/lpc/body:average:light.png",
      "/lpc/face:neutral.png",
      "/lpc/hair:short:brown.png",
      "/lpc/outfit:fighter:t0:average.png",
    ]);
  });

  it("omits hair when style is bald", () => {
    const layers = resolveLayers({ ...look, hairStyle: "bald" }, fullCatalog);
    expect(layers.some((l) => l.file.includes("hair"))).toBe(false);
  });

  it("includes equipped gear resolved by (spriteId, build) with a rarity tint, sorted by zIndex", () => {
    const geared: HeroLook = {
      ...look,
      equipped: [{ slot: "helmet", spriteId: "iron-helm", rarity: "epic" }],
    };
    const layers = resolveLayers(geared, fullCatalog);
    const helm = layers.find((l) => l.file.includes("iron-helm"));
    expect(helm).toBeDefined();
    expect(helm!.tint).toBe("#a855f7");
    // helmet zIndex 70 is last (after outfit 40)
    expect(layers[layers.length - 1].file).toContain("iron-helm");
  });

  it("common rarity gear has no tint", () => {
    const geared: HeroLook = {
      ...look,
      equipped: [{ slot: "helmet", spriteId: "iron-helm", rarity: "common" }],
    };
    const helm = resolveLayers(geared, fullCatalog).find((l) => l.file.includes("iron-helm"));
    expect(helm!.tint).toBeUndefined();
  });

  it("skips missing catalog ids and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sparse = cat([base("body:average:light", "body", 10)]);
    const layers = resolveLayers(look, sparse);
    expect(layers.map((l) => l.file)).toEqual(["/lpc/body:average:light.png"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @workspace/focusquest test -- resolve-layers`
Expected: FAIL — cannot find module `./resolve-layers` / `resolveLayers is not a function`.

- [ ] **Step 4: Implement `resolveLayers`**

Create `artifacts/focusquest/src/lib/hero/resolve-layers.ts`:

```typescript
import type {
  CatalogEntry, HeroLook, ResolvedLayer, LayerCategory,
} from "./types";
import { RARITY_TINT, isGearCategory } from "./types";

function collectIds(look: HeroLook): string[] {
  const ids: string[] = [
    `body:${look.build}:${look.skin}`,
    `face:${look.face}`,
  ];
  if (look.hairStyle !== "bald") {
    ids.push(`hair:${look.hairStyle}:${look.hairColor}`);
  }
  ids.push(`outfit:${look.avatarClass}:t${look.tier}:${look.build}`);
  for (const g of look.equipped) {
    ids.push(`gear:${g.spriteId}:${look.build}`);
  }
  return ids;
}

/** Map each gear catalog category to the rarity of the item occupying it. */
function tintByCategory(
  look: HeroLook,
  catalogById: Map<string, CatalogEntry>,
): Map<LayerCategory, string | undefined> {
  const out = new Map<LayerCategory, string | undefined>();
  for (const g of look.equipped) {
    const entry = catalogById.get(`gear:${g.spriteId}:${look.build}`);
    if (entry) out.set(entry.category, RARITY_TINT[g.rarity]);
  }
  return out;
}

export function resolveLayers(
  look: HeroLook,
  catalogById: Map<string, CatalogEntry>,
): ResolvedLayer[] {
  const tints = tintByCategory(look, catalogById);
  const layers: ResolvedLayer[] = [];

  for (const id of collectIds(look)) {
    const entry = catalogById.get(id);
    if (!entry) {
      console.warn(`[hero] missing catalog asset: ${id}`);
      continue;
    }
    const layer: ResolvedLayer = { file: entry.file, zIndex: entry.zIndex };
    if (isGearCategory(entry.category)) {
      const tint = tints.get(entry.category);
      if (tint) layer.tint = tint;
    }
    layers.push(layer);
  }

  return layers.sort((a, b) => a.zIndex - b.zIndex);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @workspace/focusquest test -- resolve-layers`
Expected: PASS — 5 passed.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: no errors.

```bash
git add artifacts/focusquest/src/lib/hero/types.ts artifacts/focusquest/src/lib/hero/resolve-layers.ts artifacts/focusquest/src/lib/hero/resolve-layers.test.ts
git commit -m "feat(hero): add HeroLook types and pure resolveLayers"
```

---

### Task 3: Export starter LPC assets + typed catalog

**Files:**
- Create: `artifacts/focusquest/public/lpc/**` (PNGs + `CREDITS.csv`)
- Create: `artifacts/focusquest/src/lib/hero/catalog.ts`

**Interfaces:**
- Consumes: `CatalogEntry` from `types.ts`, `resolveLayers` id/file conventions.
- Produces: `CATALOG: CatalogEntry[]` and `catalogById: Map<string, CatalogEntry>` (default export path used by `PixelHero` and tests).

- [ ] **Step 1: Export the starter asset matrix from the LPC generator**

Using the LPC generator (https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/ or the local repo), export the **single south-facing standing frame** (row/col of the walk/idle "down" pose), cropped to 64×64, as PNGs. **Prefer CC0 / CC-BY / OGA-BY assets.** Save with the exact file-path scheme (`public/lpc/{category}/{...}.png`). Starter matrix:

- **Bodies** — `body/{build}_{skin}.png` for `build ∈ {slim, average, broad}` × `skin ∈ {light, tan, brown, dark, green, blue}` = 18 files. (Map `slim/average/broad` to the closest LPC body bases you selected; record the mapping in a comment in `catalog.ts`.)
- **Hair** — `hair/{style}_{color}.png` for `style ∈ {short, long, ponytail, mohawk}` × `color ∈ {brown, black, blonde, red, white, blue}` = 24 files. (`bald` needs no file.)
- **Face** — `face/{face}.png` for `face ∈ {neutral, stern, smile}` = 3 files.
- **Outfits** — `outfit/{class}_t{tier}_{build}.png` for `class ∈ {fighter, mage, ranger, healer}` × `tier ∈ {0,1,2,3}` × `build ∈ {slim, average, broad}` = 48 files. Pick LPC clothing that reads as each class, escalating in fanciness per tier.

Also download the generator's **credits** for exactly these assets and save as `public/lpc/CREDITS.csv`.

- [ ] **Step 2: Verify the files exist and are 64×64**

Run:
```bash
find artifacts/focusquest/public/lpc -name '*.png' | wc -l
```
Expected: `93` (18 + 24 + 3 + 48). If some LPC combinations are unavailable, adjust the catalog in Step 3 to match what was actually exported — the integrity test (Task 4) is the source of truth.

- [ ] **Step 3: Write the catalog module**

Create `artifacts/focusquest/src/lib/hero/catalog.ts`. Generate one `CatalogEntry` per exported file, filling `author/license/sourceUrl` from `CREDITS.csv`. Structure (abbreviated — include an entry for **every** exported PNG):

```typescript
import type { CatalogEntry } from "./types";

// build mapping (LPC base → our build): slim=teen, average=male, broad=muscular (adjust to your export)
const Z = {
  body: 10, face: 20, hair: 30, outfit: 40,
  boots: 50, armor: 60, helmet: 70, weapon: 80, accessory: 90,
} as const;

export const CATALOG: CatalogEntry[] = [
  // ── bodies ──
  { id: "body:average:light", category: "body", zIndex: Z.body,
    file: "/lpc/body/average_light.png",
    author: "Benjamin K. Smith (BenCreating)", license: "CC-BY-SA 4.0",
    sourceUrl: "https://opengameart.org/content/lpc-character-bases" },
  // ...one entry per body file (18 total)...

  // ── hair (24) ──
  { id: "hair:short:brown", category: "hair", zIndex: Z.hair,
    file: "/lpc/hair/short_brown.png",
    author: "bluecarrot16", license: "CC-BY-SA 4.0",
    sourceUrl: "https://opengameart.org/content/lpc-hair" },
  // ...

  // ── faces (3) ──
  { id: "face:neutral", category: "face", zIndex: Z.face,
    file: "/lpc/face/neutral.png",
    author: "bluecarrot16", license: "CC-BY-SA 4.0", sourceUrl: "..." },
  // ...

  // ── outfits (48) ──
  { id: "outfit:fighter:t0:average", category: "outfit", zIndex: Z.outfit,
    file: "/lpc/outfit/fighter_t0_average.png",
    author: "...", license: "...", sourceUrl: "..." },
  // ...
];

export const catalogById: Map<string, CatalogEntry> = new Map(
  CATALOG.map((e) => [e.id, e]),
);
```

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: no errors.

```bash
git add artifacts/focusquest/public/lpc artifacts/focusquest/src/lib/hero/catalog.ts
git commit -m "feat(hero): add starter LPC asset export and typed catalog"
```

---

### Task 4: Catalog integrity + attribution tests

**Files:**
- Test: `artifacts/focusquest/src/lib/hero/catalog.test.ts`

**Interfaces:**
- Consumes: `CATALOG`, `catalogById` from `catalog.ts`.
- Produces: build-time guarantees that every catalog file exists on disk and carries attribution.

- [ ] **Step 1: Write the failing test**

Create `artifacts/focusquest/src/lib/hero/catalog.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { CATALOG, catalogById } from "./catalog";

const PUBLIC = path.resolve(__dirname, "../../../public");

describe("catalog integrity", () => {
  it("has at least the starter matrix", () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(60);
  });

  it("every entry file exists on disk", () => {
    const missing = CATALOG.filter(
      (e) => !existsSync(path.join(PUBLIC, e.file)),
    ).map((e) => e.file);
    expect(missing).toEqual([]);
  });

  it("every entry has attribution (author + license + sourceUrl)", () => {
    const bad = CATALOG.filter(
      (e) => !e.author || !e.license || !e.sourceUrl,
    ).map((e) => e.id);
    expect(bad).toEqual([]);
  });

  it("ids are unique", () => {
    expect(catalogById.size).toBe(CATALOG.length);
  });

  it("every id matches its category's expected prefix", () => {
    const prefixOk = CATALOG.every((e) => {
      if (e.category === "body") return e.id.startsWith("body:");
      if (e.category === "hair") return e.id.startsWith("hair:");
      if (e.category === "face") return e.id.startsWith("face:");
      if (e.category === "outfit") return e.id.startsWith("outfit:");
      return e.id.startsWith("gear:");
    });
    expect(prefixOk).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @workspace/focusquest test -- catalog`
Expected: PASS if Task 3 export + catalog are complete. If it FAILS listing missing files, fix `catalog.ts` or re-export those PNGs until green. **Do not** weaken the test to pass.

- [ ] **Step 3: Commit**

```bash
git add artifacts/focusquest/src/lib/hero/catalog.test.ts
git commit -m "test(hero): enforce catalog file existence and attribution"
```

---

### Task 5: `PixelHero` canvas compositor

**Files:**
- Create: `artifacts/focusquest/src/components/pixel-hero.tsx`

**Interfaces:**
- Consumes: `resolveLayers`, `catalogById`, `HeroLook`, `ResolvedLayer`.
- Produces: `PixelHero({ look, size?, idle?, className? })` React component (default size 160).

- [ ] **Step 1: Implement the component**

Create `artifacts/focusquest/src/components/pixel-hero.tsx`:

```tsx
import { useEffect, useMemo, useRef } from "react";
import { resolveLayers } from "@/lib/hero/resolve-layers";
import { catalogById } from "@/lib/hero/catalog";
import type { HeroLook, ResolvedLayer } from "@/lib/hero/types";

const FRAME = 64; // native LPC frame size

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Draw an image tinted toward `tint` while preserving its alpha + shading. */
function drawTinted(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  tint: string,
) {
  const off = document.createElement("canvas");
  off.width = FRAME;
  off.height = FRAME;
  const octx = off.getContext("2d")!;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(img, 0, 0, FRAME, FRAME);
  octx.globalCompositeOperation = "source-atop";
  octx.globalAlpha = 0.55;
  octx.fillStyle = tint;
  octx.fillRect(0, 0, FRAME, FRAME);
  octx.globalAlpha = 1;
  octx.globalCompositeOperation = "source-over";
  ctx.drawImage(off, 0, 0, FRAME, FRAME);
}

export function PixelHero({
  look,
  size = 160,
  idle = true,
  className,
}: {
  look: HeroLook;
  size?: number;
  idle?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layers: ResolvedLayer[] = useMemo(
    () => resolveLayers(look, catalogById),
    [look],
  );

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    (async () => {
      const imgs = await Promise.all(layers.map((l) => loadImage(l.file)));
      if (cancelled) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, FRAME, FRAME);
      layers.forEach((l, i) => {
        if (l.tint) drawTinted(ctx, imgs[i], l.tint);
        else ctx.drawImage(imgs[i], 0, 0, FRAME, FRAME);
      });
    })().catch(() => {
      /* a missing image is non-fatal; other layers still render */
    });

    return () => {
      cancelled = true;
    };
  }, [layers]);

  return (
    <canvas
      ref={canvasRef}
      width={FRAME}
      height={FRAME}
      className={className}
      style={{
        width: size,
        height: size,
        imageRendering: "pixelated",
        animation: idle ? "hero-bob 2.4s ease-in-out infinite" : undefined,
      }}
      aria-label={`${look.avatarClass} hero`}
      role="img"
    />
  );
}
```

- [ ] **Step 2: Add the idle-bob keyframes**

In `artifacts/focusquest/src/index.css` (the app's global stylesheet — confirm the filename via `artifacts/focusquest/src/main.tsx` imports), append:

```css
@keyframes hero-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: no errors.

- [ ] **Step 4: Visual verification in the preview**

Temporarily render `<PixelHero look={{ skin:"light", build:"average", hairStyle:"short", hairColor:"brown", face:"neutral", avatarClass:"fighter", tier:0, equipped:[] }} />` on the Hero page (or a scratch route). Start the dev server via the preview tooling, load the Hero page, and confirm a composed character renders (body + face + hair + outfit stacked, crisp pixels). Screenshot for the record, then remove the temporary render.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/components/pixel-hero.tsx artifacts/focusquest/src/index.css
git commit -m "feat(hero): add PixelHero canvas compositor"
```

---

### Task 6: Extend `users` + `gear` schema

**Files:**
- Modify: `lib/db/src/schema/users.ts`
- Modify: `lib/db/src/schema/gear.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: new columns `users.avatarHairStyle, avatarHairColor, avatarBodyBuild, avatarFace` and `gear_items.spriteId`, available on the Drizzle `User` / `GearItem` inferred types.

- [ ] **Step 1: Add user columns**

In `lib/db/src/schema/users.ts`, inside `usersTable`, after `avatarSkin`:

```typescript
  avatarHairStyle: text("avatar_hair_style").notNull().default("short"),
  avatarHairColor: text("avatar_hair_color").notNull().default("brown"),
  avatarBodyBuild: text("avatar_body_build").notNull().default("average"),
  avatarFace: text("avatar_face").notNull().default("neutral"),
```

- [ ] **Step 2: Add gear spriteId column**

In `lib/db/src/schema/gear.ts`, inside `gearItemsTable`, after `icon`:

```typescript
  spriteId: text("sprite_id"),
```

(Nullable — backfilled per-item in Phase 2; existing rows remain valid.)

- [ ] **Step 3: Typecheck the libs**

Run: `pnpm run typecheck:libs`
Expected: no errors.

- [ ] **Step 4: Push the schema to the database**

Run: `pnpm --filter @workspace/db push`
Expected: drizzle-kit reports adding 4 columns to `users` and 1 to `gear_items`; confirm when prompted. (Uses `DATABASE_URL` from the environment — ensure `.env` is loaded.)

- [ ] **Step 5: Commit**

```bash
git add lib/db/src/schema/users.ts lib/db/src/schema/gear.ts
git commit -m "feat(db): add avatar physical-attribute columns and gear spriteId"
```

---

### Task 7: Extend the `/avatar` API

**Files:**
- Modify: `artifacts/api-server/src/routes/avatar.ts`
- Modify: `lib/api-spec/openapi.yaml`

**Interfaces:**
- Consumes: the new `users` columns from Task 6.
- Produces: `GET /avatar` returns `avatarHairStyle, avatarHairColor, avatarBodyBuild, avatarFace` + `availableHairStyles, availableHairColors, availableBuilds, availableFaces`; `PATCH /avatar` accepts + validates them; each `equippedGear` entry gains `spriteId`.

- [ ] **Step 1: Add allowed-value lists and extend the response builder**

In `artifacts/api-server/src/routes/avatar.ts`, after the existing `AVATAR_SKINS` line add:

```typescript
const AVATAR_HAIR_STYLES = ["bald", "short", "long", "ponytail", "mohawk"] as const;
const AVATAR_HAIR_COLORS = ["brown", "black", "blonde", "red", "white", "blue"] as const;
const AVATAR_BUILDS      = ["slim", "average", "broad"] as const;
const AVATAR_FACES       = ["neutral", "stern", "smile"] as const;
```

In `buildAvatarResponse`, extend the returned object with (place beside the existing `avatarSkin` / `available*` fields):

```typescript
    avatarHairStyle:  user.avatarHairStyle  ?? "short",
    avatarHairColor:  user.avatarHairColor  ?? "brown",
    avatarBodyBuild:  user.avatarBodyBuild  ?? "average",
    avatarFace:       user.avatarFace       ?? "neutral",
    availableHairStyles: [...AVATAR_HAIR_STYLES],
    availableHairColors: [...AVATAR_HAIR_COLORS],
    availableBuilds:     [...AVATAR_BUILDS],
    availableFaces:      [...AVATAR_FACES],
```

And add `spriteId` to each equipped-gear item mapping:

```typescript
    equippedGear: equipped.map(g => ({
      id:        g.gear.id,
      name:      g.gear.name,
      slot:      g.gear.slot,
      rarity:    g.gear.rarity,
      statPower: g.gear.statPower,
      icon:      g.gear.icon,
      spriteId:  g.gear.spriteId ?? null,
    })),
```

- [ ] **Step 2: Validate the new fields in PATCH**

In the `PATCH /avatar` handler, extend the destructure and add validation blocks mirroring the existing `avatarSkin` check:

```typescript
  const { avatarColor, avatarClass, avatarSkin,
          avatarHairStyle, avatarHairColor, avatarBodyBuild, avatarFace } = req.body as {
    avatarColor?: string; avatarClass?: string; avatarSkin?: string;
    avatarHairStyle?: string; avatarHairColor?: string;
    avatarBodyBuild?: string; avatarFace?: string;
  };
```

Then, after the `avatarSkin` validation block:

```typescript
  if (avatarHairStyle != null) {
    if (!(AVATAR_HAIR_STYLES as readonly string[]).includes(avatarHairStyle)) {
      res.status(400).json({ error: "Invalid hair style" }); return;
    }
    updates.avatarHairStyle = avatarHairStyle;
  }
  if (avatarHairColor != null) {
    if (!(AVATAR_HAIR_COLORS as readonly string[]).includes(avatarHairColor)) {
      res.status(400).json({ error: "Invalid hair color" }); return;
    }
    updates.avatarHairColor = avatarHairColor;
  }
  if (avatarBodyBuild != null) {
    if (!(AVATAR_BUILDS as readonly string[]).includes(avatarBodyBuild)) {
      res.status(400).json({ error: "Invalid body build" }); return;
    }
    updates.avatarBodyBuild = avatarBodyBuild;
  }
  if (avatarFace != null) {
    if (!(AVATAR_FACES as readonly string[]).includes(avatarFace)) {
      res.status(400).json({ error: "Invalid face" }); return;
    }
    updates.avatarFace = avatarFace;
  }
```

- [ ] **Step 3: Update the OpenAPI spec**

In `lib/api-spec/openapi.yaml`, find the Avatar response schema and the PATCH request-body schema (search for `avatarSkin`). Add these properties alongside `avatarSkin` in the **response** schema: `avatarHairStyle`, `avatarHairColor`, `avatarBodyBuild`, `avatarFace` (all `type: string`), and `availableHairStyles`, `availableHairColors`, `availableBuilds`, `availableFaces` (all `type: array, items: {type: string}`). Add `spriteId` (`type: string, nullable: true`) to the equipped-gear item schema. Add the four `avatar*` string properties to the **PATCH request body** schema. Match the existing indentation/style exactly.

- [ ] **Step 4: Regenerate the client + typecheck**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: orval regenerates `lib/api-client-react/src/generated` + `lib/api-zod/src/generated`, then `typecheck:libs` passes. The generated `getAvatar` response type now includes the new fields.

- [ ] **Step 5: Typecheck the server**

Run: `pnpm --filter @workspace/api-server typecheck`
Expected: no errors.

- [ ] **Step 6: Runtime verification**

Start the api-server + focusquest via the preview tooling. `GET /api/avatar` and confirm the response includes the new fields + `available*` arrays. `PATCH /api/avatar` with `{ "avatarHairStyle": "mohawk" }` → 200 and the value persists; with `{ "avatarHairStyle": "nope" }` → 400 "Invalid hair style".

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/routes/avatar.ts lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "feat(api): extend /avatar with physical-attribute fields and gear spriteId"
```

---

### Task 8: Hero page — customization controls + `PixelHero`

**Files:**
- Modify: `artifacts/focusquest/src/pages/avatar.tsx`

**Interfaces:**
- Consumes: extended `useGetAvatar`/`useUpdateAvatar` types, `PixelHero`, hero enum types.
- Produces: a working customization UI (skin, hair style, hair color, build, face) that renders the live `PixelHero`.

- [ ] **Step 1: Build the `HeroLook` from avatar data and render `PixelHero`**

In `artifacts/focusquest/src/pages/avatar.tsx`, replace the `AvatarRenderer` import with `PixelHero`, and derive a `HeroLook` from `avatarData`:

```tsx
import { PixelHero } from "@/components/pixel-hero";
import type { HeroLook, Build, Skin, HairStyle, HairColor, FaceId, AvatarClass } from "@/lib/hero/types";
```

Where the avatar renders today, compute:

```tsx
const heroLook: HeroLook = {
  skin: (avatarData?.avatarSkin ?? "light") as Skin,
  build: (avatarData?.avatarBodyBuild ?? "average") as Build,
  hairStyle: (avatarData?.avatarHairStyle ?? "short") as HairStyle,
  hairColor: (avatarData?.avatarHairColor ?? "brown") as HairColor,
  face: (avatarData?.avatarFace ?? "neutral") as FaceId,
  avatarClass: currentClass as AvatarClass,
  tier: Math.min(3, Math.floor(((avatarData?.level ?? 1) - 1) / 10)) as 0 | 1 | 2 | 3,
  equipped: (avatarData?.equippedGear ?? []).map((g) => ({
    slot: g.slot as HeroLook["equipped"][number]["slot"],
    spriteId: g.spriteId ?? "",
    rarity: g.rarity as HeroLook["equipped"][number]["rarity"],
  })).filter((g) => g.spriteId !== ""),
};
```

Replace the `<AvatarRenderer ... />` element with:

```tsx
<PixelHero look={heroLook} size={160} />
```

- [ ] **Step 2: Add a reusable option-row helper and the new pickers**

Add generic pickers to the left panel, alongside the existing Class and Palette blocks. Each writes through the existing `updateAvatar` mutation and invalidates the avatar query (reuse the existing `handleClassSelect` pattern). Add one handler:

```tsx
async function handleAttrSelect(patch: Record<string, string>) {
  try {
    await updateAvatar.mutateAsync({ data: patch });
    await qc.invalidateQueries({ queryKey: getGetAvatarQueryKey() });
  } catch {
    toast({ title: "Failed to update character", variant: "destructive" });
  }
}
```

And render pill selectors for each attribute using the `available*` arrays from `avatarData` (Build, Skin, Hair Style, Hair Color, Face). Example block (repeat per attribute with its field name + options):

```tsx
<div className="w-full space-y-2">
  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Build</p>
  <div className="flex flex-wrap gap-2">
    {(avatarData?.availableBuilds ?? []).map((b) => (
      <button
        key={b}
        onClick={() => handleAttrSelect({ avatarBodyBuild: b })}
        disabled={updateAvatar.isPending}
        className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
          (avatarData?.avatarBodyBuild ?? "average") === b
            ? "bg-primary text-primary-foreground border-primary"
            : "border-border text-muted-foreground hover:border-muted-foreground"
        }`}
      >
        {b}
      </button>
    ))}
  </div>
</div>
```

Repeat for `avatarSkin` (`availableSkins`), `avatarHairStyle` (`availableHairStyles`), `avatarHairColor` (`availableHairColors`), `avatarFace` (`availableFaces`). For hair color and skin, render a color swatch where a palette exists; a text pill is acceptable for v1.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @workspace/focusquest typecheck`
Expected: no errors.

- [ ] **Step 4: Visual verification**

Start the preview, open the Hero page. Confirm: the composed hero renders; changing Build/Skin/Hair Style/Hair Color/Face updates the character within a moment (query refetch → new `HeroLook` → new layers). Screenshot before/after for two attributes.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/pages/avatar.tsx
git commit -m "feat(hero): add physical customization controls and live PixelHero"
```

---

### Task 9: Retire `AvatarRenderer` + add Credits view

**Files:**
- Modify: `artifacts/focusquest/src/pages/progress.tsx`, `artifacts/focusquest/src/components/layout.tsx`, `artifacts/focusquest/src/components/task-item.tsx` (any remaining `AvatarRenderer` users)
- Create: `artifacts/focusquest/src/components/hero-credits.tsx`
- Delete: `artifacts/focusquest/src/components/avatar-renderer.tsx`

**Interfaces:**
- Consumes: `PixelHero`, `CATALOG`.
- Produces: no remaining references to `AvatarRenderer`; a `HeroCredits` component listing asset attributions.

- [ ] **Step 1: Find remaining AvatarRenderer usages**

Run: `grep -rn "AvatarRenderer\|avatar-renderer" artifacts/focusquest/src`
Expected: a short list. For each call site, replace with `<PixelHero look={...} />`, constructing the `HeroLook` the same way as Task 8 (from that component's available user data; where only class/level exist, default the physical attrs and pass `equipped: []`).

- [ ] **Step 2: Create the Credits component**

Create `artifacts/focusquest/src/components/hero-credits.tsx`:

```tsx
import { CATALOG } from "@/lib/hero/catalog";

export function HeroCredits() {
  const rows = [...new Map(
    CATALOG.map((e) => [`${e.author}|${e.license}|${e.sourceUrl}`, e]),
  ).values()];
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Character art credits
      </p>
      <ul className="text-xs text-muted-foreground space-y-1">
        {rows.map((e) => (
          <li key={`${e.author}-${e.sourceUrl}`}>
            <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="underline">
              {e.author}
            </a>{" "}
            — {e.license}
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-muted-foreground/70">
        Art from the Universal LPC Spritesheet project. Derivatives shared under their source licenses.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Surface Credits on the Hero page**

In `artifacts/focusquest/src/pages/avatar.tsx`, import and render `<HeroCredits />` at the bottom of the left panel (below Equipment).

- [ ] **Step 4: Delete the old renderer**

Delete `artifacts/focusquest/src/components/avatar-renderer.tsx`. Re-run the grep:

Run: `grep -rn "AvatarRenderer\|avatar-renderer" artifacts/focusquest/src`
Expected: no matches.

- [ ] **Step 5: Typecheck + full test run**

Run: `pnpm --filter @workspace/focusquest typecheck && pnpm --filter @workspace/focusquest test`
Expected: typecheck clean; all tests pass.

- [ ] **Step 6: Visual verification + commit**

Preview the Hero page and any page that previously used `AvatarRenderer` (Progress, layout header); confirm each renders a `PixelHero`. Confirm the Credits list appears. Screenshot the Hero page.

```bash
git add artifacts/focusquest/src
git rm artifacts/focusquest/src/components/avatar-renderer.tsx
git commit -m "feat(hero): migrate all call sites to PixelHero and add art credits"
```

---

## Self-Review

**Spec coverage (Phase 0 + 1 scope):**
- Rendering architecture — `resolveLayers` (Task 2) + `PixelHero` (Task 5). ✅
- LPC assets-only, build-time export — Task 3. ✅
- Recolor: pick-a-variant skin/hair (Tasks 3, 8); rarity tint pass implemented in `PixelHero` + `resolveLayers` (Tasks 2, 5) ready for Phase 2. ✅
- Data model: user columns + gear `spriteId` — Task 6. ✅
- API extension + validation — Task 7. ✅
- Catalog as single source of truth — Tasks 3, 4. ✅
- Physical customization UI incl. skin picker — Task 8. ✅
- Attribution/Credits — Tasks 3, 4, 9. ✅
- Class-outfit-per-tier baseline — outfit files per class×tier×build (Task 3) + tier derived in Task 8. ✅
- **Deferred to Phase 2/3 plans (documented, not gaps):** gear→spriteId catalog entries + signature legendaries + gear-on-body UI (Phase 2); idle-bob is in (Task 5), but equip flash + level aura (Phase 3).

**Placeholder scan:** No "TBD/TODO/handle edge cases" in steps; the one manual task (Task 3 export) lists the exact matrix + file scheme + count, enforced by Task 4's test.

**Type consistency:** `HeroLook`, `CatalogEntry`, `ResolvedLayer`, `resolveLayers(look, catalogById)`, `catalogById`, `RARITY_TINT`, `isGearCategory`, and the `avatar*` field names are used identically across Tasks 2, 3, 5, 7, 8, 9. API field names match the DB column names (`avatarHairStyle` etc.).

## Notes / conscious deviations from the spec

- **Server-side unit tests:** the spec listed API-validation tests, but this repo has **no** server test runner and verifies via typecheck + codegen + runtime. Task 7 follows repo convention (runtime check of the 400/200 paths) rather than standing up a second vitest harness. Client pure logic (`resolveLayers`, catalog) **is** unit-tested. Flag for the user.
- **Scope:** Phases 2 (gear-on-body) and 3 (equip flash, level aura) are separate follow-up plans, authored after Task 3's export reveals the real LPC gear layer inventory and z-order.
