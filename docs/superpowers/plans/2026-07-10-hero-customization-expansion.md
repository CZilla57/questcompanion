# Hero Customization Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add beard and face-accessory (glasses, earrings) layers plus more hair styles/colors and skin tones to the hero, backed by a single shared `@workspace/hero-options` source of truth that replaces today's duplicated option lists.

**Architecture:** A new `@workspace/hero-options` package holds the canonical option ids/labels/swatches per appearance axis; the API validation + `availableX`, the focusquest types + UI, and (by id) the build tool all read from it. The LPC "id → palette/style" mapping lives beside the build tool in `scripts/src/lpc-mapping.ts`, guarded by a build-time coverage assertion so no option can be advertised without a baked sprite. New customization is free cosmetic, stored on the user row, and rendered through the existing `resolveLayers` + `PixelHero` compositor with the existing palette-swap bake — no new runtime rendering mechanism.

**Tech Stack:** pnpm workspaces, TypeScript 5.9, Node ≥20.11, Vitest, Drizzle ORM (Postgres/Neon), Express 5, React 19 + Vite, Orval codegen from OpenAPI, `pngjs` + `tsx` for the LPC bake.

## Global Constraints

- **Package manager:** pnpm only (repo blocks npm/yarn). Workspace globs: `artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts`. Cross-package deps use `"workspace:*"`.
- **Shared deps use the catalog:** reference pinned versions with `"catalog:"` where the dep exists in `pnpm-workspace.yaml` `catalog:` (e.g. `zod`, `@types/node`, `vite`). `vitest` is `^2.1.9` (matches focusquest).
- **Lib packages export TS source directly:** `"exports": { ".": "./src/index.ts" }`, `"type": "module"`, `composite: true` tsconfig extending `../../tsconfig.base.json`. Register every new lib in root `tsconfig.json` `references`.
- **All new customization is free cosmetic**, stored on `usersTable`, default `'none'` (or `'brown'` for beard color). No XP gate, no battle-power effect.
- **Body types stay `male`/`female`.** No new builds.
- **Colors are baked palette swaps** (LPC ramps in `build-lpc-assets.ts`), never runtime tints. Hair, beard, glasses, earrings are **universal** — one sprite, no `:build` suffix (unisex head). Beard is recolored per beard color (style × color files, like hair).
- **Test runner:** Vitest. Hero logic + integrity tests live in `artifacts/focusquest/src/lib/hero/*.test.ts` (`pnpm --filter @workspace/focusquest test`). `hero-options` gets its own Vitest cycle.
- **`api-server` has no test harness** — do not add one. Keep testable logic (validation, option lists) in `hero-options`; the route is a thin, typecheck-verified consumer.
- **Codegen:** after editing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen` (runs Orval + `typecheck:libs`).
- **DB migrations:** `pnpm --filter @workspace/db run push` (drizzle-kit). Known gotcha: the `.env` must be exported into the shell env first (see `reference-dev-commands`).
- **Node ≥20.11** for `import.meta.dirname` (used by existing tests).
- **Commits:** conventional, `hero` scope. Commit at the end of each task.

---

## File Structure

**New**
- `lib/hero-options/package.json`, `tsconfig.json`, `src/index.ts` — shared option registry + validators (`@workspace/hero-options`).
- `lib/hero-options/src/options.test.ts` — registry invariants.
- `scripts/src/lpc-mapping.ts` — id → LPC palette/style/def mapping, keyed by `hero-options` ids.

**Modified**
- `tsconfig.json` — add `./lib/hero-options` reference.
- `artifacts/api-server/src/routes/avatar.ts` — read lists/validators from `hero-options`; add new fields.
- `artifacts/api-server/package.json` — add `@workspace/hero-options`.
- `artifacts/focusquest/src/lib/hero/types.ts` — option unions from `hero-options`; new `LayerCategory`/`HeroLook` fields.
- `artifacts/focusquest/src/lib/hero/resolve-layers.ts` — emit beard/glasses/earrings ids.
- `artifacts/focusquest/src/lib/hero/catalog.ts` — regenerated (do not hand-edit).
- `artifacts/focusquest/src/lib/hero/catalog-integrity.test.ts`, `resolve-layers.test.ts` — new coverage.
- `artifacts/focusquest/src/pages/avatar.tsx` — new pickers; swatch lookups from `hero-options`.
- `artifacts/focusquest/package.json` — add `@workspace/hero-options`.
- `scripts/src/build-lpc-assets.ts` — import mapping + `hero-options`; beard/glasses/earrings loops; coverage assertion.
- `scripts/package.json` — add `@workspace/hero-options`.
- `lib/db/src/schema/users.ts` — four new avatar columns.
- `lib/api-spec/openapi.yaml` — new avatar fields; appearance fields loosened to `string`.
- `artifacts/focusquest/public/lpc/**`, `CREDITS.csv` — regenerated PNGs + credits.

---

## Task 1: Create `@workspace/hero-options` package

**Files:**
- Create: `lib/hero-options/package.json`
- Create: `lib/hero-options/tsconfig.json`
- Create: `lib/hero-options/src/index.ts`
- Create: `lib/hero-options/src/options.test.ts`
- Modify: `tsconfig.json` (root — add reference)

**Interfaces:**
- Produces:
  - `interface Option { readonly id: string; readonly label: string; readonly swatch?: string }`
  - Const arrays (each `as const satisfies readonly Option[]`): `builds`, `skins`, `hairStyles`, `hairColors`, `faces`, `classes`, `colors`.
  - Derived id unions: `BuildId`, `SkinId`, `HairStyleId`, `HairColorId`, `FaceId`, `ClassId`.
  - `function ids(o: readonly Option[]): string[]`
  - `function includesId(o: readonly Option[], value: string): boolean`

- [ ] **Step 1: Create the package manifest**

Create `lib/hero-options/package.json`:

```json
{
  "name": "@workspace/hero-options",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 2: Create the tsconfig**

Create `lib/hero-options/tsconfig.json` (mirrors `lib/db/tsconfig.json`):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "declarationMap": true,
    "emitDeclarationOnly": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Register in the root tsconfig references**

Modify root `tsconfig.json` — add to the `references` array:

```json
    {
      "path": "./lib/hero-options"
    },
```

- [ ] **Step 4: Write the failing test**

Create `lib/hero-options/src/options.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  builds, skins, hairStyles, hairColors, faces, classes, colors,
  ids, includesId, type Option,
} from "./index";

const AXES: Record<string, readonly Option[]> = {
  builds, skins, hairStyles, hairColors, faces, classes, colors,
};

describe("hero-options registry", () => {
  it("has no duplicate ids within any axis", () => {
    for (const [name, axis] of Object.entries(AXES)) {
      const seen = ids(axis);
      expect(new Set(seen).size, `dup id in ${name}`).toBe(seen.length);
    }
  });

  it("preserves the current option values (regression lock)", () => {
    expect(ids(builds)).toEqual(["male", "female"]);
    expect(ids(skins)).toEqual(["light", "tan", "brown", "dark", "green", "blue"]);
    expect(ids(hairStyles)).toEqual(["bald", "short", "long", "ponytail", "afro"]);
    expect(ids(hairColors)).toEqual(["brown", "black", "blonde", "red", "white", "blue"]);
    expect(ids(faces)).toEqual(["neutral", "stern", "smile"]);
    expect(ids(classes)).toEqual(["fighter", "mage", "ranger", "healer"]);
  });

  it("every skin and hair color carries a swatch hex", () => {
    for (const o of [...skins, ...hairColors]) {
      expect(o.swatch, `no swatch for ${o.id}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("includesId matches by id", () => {
    expect(includesId(skins, "light")).toBe(true);
    expect(includesId(skins, "chartreuse")).toBe(false);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @workspace/hero-options test`
Expected: FAIL — cannot resolve `./index` (module not created yet).

- [ ] **Step 6: Implement the registry**

Create `lib/hero-options/src/index.ts`:

```ts
export interface Option {
  readonly id: string;
  readonly label: string;
  readonly swatch?: string;
}

export const builds = [
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
] as const satisfies readonly Option[];

export const skins = [
  { id: "light", label: "Light", swatch: "#FDBCB4" },
  { id: "tan", label: "Tan", swatch: "#D4956A" },
  { id: "brown", label: "Brown", swatch: "#8D5524" },
  { id: "dark", label: "Dark", swatch: "#4A2512" },
  { id: "green", label: "Green", swatch: "#7BC47F" },
  { id: "blue", label: "Blue", swatch: "#89C4E1" },
] as const satisfies readonly Option[];

export const hairStyles = [
  { id: "bald", label: "Bald" },
  { id: "short", label: "Short" },
  { id: "long", label: "Long" },
  { id: "ponytail", label: "Ponytail" },
  { id: "afro", label: "Afro" },
] as const satisfies readonly Option[];

// Shared color palette — hairColors and beardColors both reference it.
export const hairColors = [
  { id: "brown", label: "Brown", swatch: "#5b3a1e" },
  { id: "black", label: "Black", swatch: "#242424" },
  { id: "blonde", label: "Blonde", swatch: "#E6C35C" },
  { id: "red", label: "Red", swatch: "#a83232" },
  { id: "white", label: "White", swatch: "#e8e8ea" },
  { id: "blue", label: "Blue", swatch: "#3a4a9e" },
] as const satisfies readonly Option[];

export const faces = [
  { id: "neutral", label: "Neutral" },
  { id: "stern", label: "Stern" },
  { id: "smile", label: "Smile" },
] as const satisfies readonly Option[];

export const classes = [
  { id: "fighter", label: "Fighter", swatch: "#ef4444" },
  { id: "mage", label: "Mage", swatch: "#8b5cf6" },
  { id: "ranger", label: "Ranger", swatch: "#22c55e" },
  { id: "healer", label: "Healer", swatch: "#f59e0b" },
] as const satisfies readonly Option[];

// Accent color palette (profile/leaderboard) — id is the hex itself.
export const colors = [
  { id: "#00FFFF", label: "Cyan" },
  { id: "#A855F7", label: "Purple" },
  { id: "#F97316", label: "Orange" },
  { id: "#22C55E", label: "Green" },
  { id: "#EC4899", label: "Pink" },
  { id: "#EAB308", label: "Yellow" },
  { id: "#6366F1", label: "Indigo" },
  { id: "#F43F5E", label: "Rose" },
] as const satisfies readonly Option[];

export type BuildId = (typeof builds)[number]["id"];
export type SkinId = (typeof skins)[number]["id"];
export type HairStyleId = (typeof hairStyles)[number]["id"];
export type HairColorId = (typeof hairColors)[number]["id"];
export type FaceId = (typeof faces)[number]["id"];
export type ClassId = (typeof classes)[number]["id"];

export function ids(o: readonly Option[]): string[] {
  return o.map((x) => x.id);
}

export function includesId(o: readonly Option[], value: string): boolean {
  return o.some((x) => x.id === value);
}
```

- [ ] **Step 7: Install the new package into the workspace**

Run: `pnpm install`
Expected: `@workspace/hero-options` linked; no errors.

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @workspace/hero-options test`
Expected: PASS (4 tests).

- [ ] **Step 9: Typecheck the libs**

Run: `pnpm run typecheck:libs`
Expected: PASS (new project reference builds).

- [ ] **Step 10: Commit**

```bash
git add lib/hero-options tsconfig.json pnpm-lock.yaml
git commit -m "feat(hero): add @workspace/hero-options shared registry"
```

---

## Task 2: Wire the avatar API to `hero-options` (no behavior change)

**Files:**
- Modify: `artifacts/api-server/src/routes/avatar.ts`
- Modify: `artifacts/api-server/package.json`

**Interfaces:**
- Consumes: `hero-options` `builds, skins, hairStyles, hairColors, faces, classes, colors`, `ids`, `includesId`.
- Produces: `GET /api/avatar` returns the same fields/values as before; validation unchanged in behavior. (Response gains nothing yet — new fields arrive in Task 9.)

- [ ] **Step 1: Add the dependency**

Modify `artifacts/api-server/package.json` — add to `dependencies`:

```json
    "@workspace/hero-options": "workspace:*",
```

Run: `pnpm install`
Expected: linked, no errors.

- [ ] **Step 2: Replace the hardcoded constant block**

In `artifacts/api-server/src/routes/avatar.ts`, replace the constants (lines ~8–14):

```ts
const AVATAR_CLASSES = ["fighter", "mage", "ranger", "healer"] as const;
const AVATAR_SKINS   = ["light", "tan", "brown", "dark", "green", "blue"] as const;
const AVATAR_COLORS  = ["#00FFFF", "#A855F7", "#F97316", "#22C55E", "#EC4899", "#EAB308", "#6366F1", "#F43F5E"];
const AVATAR_HAIR_STYLES = ["bald", "short", "long", "ponytail", "afro"] as const;
const AVATAR_HAIR_COLORS = ["brown", "black", "blonde", "red", "white", "blue"] as const;
const AVATAR_BUILDS      = ["male", "female"] as const;
const AVATAR_FACES       = ["neutral", "stern", "smile"] as const;
```

with an import from `hero-options` (add at top of file, after the existing imports):

```ts
import {
  builds, skins, hairStyles, hairColors, faces, classes, colors,
  ids, includesId,
} from "@workspace/hero-options";
```

- [ ] **Step 3: Update `availableX` in `buildAvatarResponse`**

Replace the `available*` block (lines ~53–59) with:

```ts
    availableColors:  ids(colors),
    availableClasses: ids(classes),
    availableSkins:   ids(skins),
    availableHairStyles: ids(hairStyles),
    availableHairColors: ids(hairColors),
    availableBuilds:     ids(builds),
    availableFaces:      ids(faces),
```

- [ ] **Step 4: Update PATCH validation to use `includesId`**

Replace each `(.. as readonly string[]).includes(x)` guard in the PATCH handler. Example — the class guard becomes:

```ts
  if (avatarClass != null) {
    if (!includesId(classes, avatarClass)) {
      res.status(400).json({ error: "Invalid avatar class" }); return;
    }
    updates.avatarClass = avatarClass;
  }
```

Apply the same substitution for the others: `includesId(skins, avatarSkin)`, `includesId(hairStyles, avatarHairStyle)`, `includesId(hairColors, avatarHairColor)`, `includesId(builds, avatarBodyBuild)`, `includesId(faces, avatarFace)`. Leave the `avatarColor` hex-regex check unchanged.

- [ ] **Step 5: Typecheck the API server**

Run: `pnpm --filter @workspace/api-server run typecheck`
Expected: PASS.

- [ ] **Step 6: Confirm behavior is unchanged**

Run: `pnpm --filter @workspace/hero-options test`
Expected: PASS — the regression-lock test in Task 1 already asserts the option values equal the old constants, so `availableX`/validation are byte-identical to before.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/routes/avatar.ts artifacts/api-server/package.json pnpm-lock.yaml
git commit -m "refactor(hero): read avatar options from @workspace/hero-options"
```

---

## Task 3: Wire focusquest types + UI swatches to `hero-options` (no behavior change)

**Files:**
- Modify: `artifacts/focusquest/src/lib/hero/types.ts`
- Modify: `artifacts/focusquest/src/pages/avatar.tsx`
- Modify: `artifacts/focusquest/package.json`

**Interfaces:**
- Consumes: `hero-options` id unions + `skins`/`hairColors` swatches.
- Produces: `HeroLook` field types now alias the `hero-options` unions; UI swatch lookups come from `hero-options` (removing local `SKIN_SWATCH`/`HAIR_SWATCH`).

- [ ] **Step 1: Add the dependency**

Modify `artifacts/focusquest/package.json` — add to `devDependencies` (keeps alpha order near `@workspace/*`):

```json
    "@workspace/hero-options": "workspace:*",
```

Run: `pnpm install`
Expected: linked, no errors.

- [ ] **Step 2: Source the option unions in `types.ts`**

In `artifacts/focusquest/src/lib/hero/types.ts`, replace the hand-written unions:

```ts
export type Build = "male" | "female";
export type Skin = "light" | "tan" | "brown" | "dark" | "green" | "blue";
export type HairStyle = "bald" | "short" | "long" | "ponytail" | "afro";
export type HairColor = "brown" | "black" | "blonde" | "red" | "white" | "blue";
export type FaceId = "neutral" | "stern" | "smile";
export type AvatarClass = "fighter" | "mage" | "ranger" | "healer";
```

with aliases to the shared unions:

```ts
import type {
  BuildId, SkinId, HairStyleId, HairColorId, FaceId as FaceIdOpt, ClassId,
} from "@workspace/hero-options";

export type Build = BuildId;
export type Skin = SkinId;
export type HairStyle = HairStyleId;
export type HairColor = HairColorId;
export type FaceId = FaceIdOpt;
export type AvatarClass = ClassId;
```

Leave `Rarity`, `GearSlot`, `LayerCategory`, `CatalogEntry`, `EquippedGearLook`, `HeroLook`, `ResolvedLayer`, `RARITY_TINT`, `GEAR_CATEGORIES`, `isGearCategory` unchanged.

- [ ] **Step 3: Replace the UI swatch maps with `hero-options` lookups**

In `artifacts/focusquest/src/pages/avatar.tsx`, delete the local maps:

```ts
const SKIN_SWATCH: Record<string, string> = {
  light: "#FDBCB4", tan: "#D4956A", brown: "#8D5524", dark: "#4A2512", green: "#7BC47F", blue: "#89C4E1",
};
const HAIR_SWATCH: Record<string, string> = {
  brown: "#5b3a1e", black: "#242424", blonde: "#E6C35C", red: "#a83232", white: "#e8e8ea", blue: "#3a4a9e",
};
```

Add an import and derive the swatch maps from `hero-options`:

```ts
import { skins as SKIN_OPTIONS, hairColors as HAIR_COLOR_OPTIONS } from "@workspace/hero-options";

const swatchMap = (opts: readonly { id: string; swatch?: string }[]): Record<string, string> =>
  Object.fromEntries(opts.filter((o) => o.swatch).map((o) => [o.id, o.swatch as string]));
const SKIN_SWATCH = swatchMap(SKIN_OPTIONS);
const HAIR_SWATCH = swatchMap(HAIR_COLOR_OPTIONS);
```

(The two `PickerRow` call sites that pass `swatch={SKIN_SWATCH}` / `swatch={HAIR_SWATCH}` stay unchanged.)

- [ ] **Step 4: Typecheck + run hero tests**

Run: `pnpm --filter @workspace/focusquest run typecheck && pnpm --filter @workspace/focusquest test`
Expected: PASS — types resolve; existing `resolve-layers`/`catalog-integrity` tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/lib/hero/types.ts artifacts/focusquest/src/pages/avatar.tsx artifacts/focusquest/package.json pnpm-lock.yaml
git commit -m "refactor(hero): source focusquest option types + swatches from @workspace/hero-options"
```

---

## Task 4: Extract the LPC mapping + add the coverage assertion (consolidation spike)

**Files:**
- Create: `scripts/src/lpc-mapping.ts`
- Modify: `scripts/src/build-lpc-assets.ts`
- Modify: `scripts/package.json`
- Modify: `artifacts/focusquest/src/lib/hero/catalog.ts` (regenerated — do not hand-edit)

**Interfaces:**
- Produces (`lpc-mapping.ts`):
  - `const SKIN_MAP: Record<string, string>` (our skin id → LPC body palette variant)
  - `const HAIR_STYLE_MAP: Record<string, string>` (our hair style id → LPC style folder)
  - `const HAIR_COLOR_CANDS: Record<string, string[]>` (our hair color id → LPC palette candidates)
- Consumes: `hero-options` id lists (build tool iterates them and asserts coverage).

- [ ] **Step 1: Add the dependency**

Modify `scripts/package.json` — add to `dependencies`:

```json
    "@workspace/hero-options": "workspace:*",
```

Run: `pnpm install`
Expected: linked.

- [ ] **Step 2: Create the mapping module**

Move the three maps out of `build-lpc-assets.ts` into `scripts/src/lpc-mapping.ts` verbatim (these are the exact current values — do not change them in this task):

```ts
// LPC id → source palette/style mapping, keyed by @workspace/hero-options ids.
// Extend HERE (plus the matching hero-options axis) to add an option.
export const SKIN_MAP: Record<string, string> = {
  light: "light", tan: "amber", brown: "brown", dark: "black", green: "green", blue: "blue",
};

export const HAIR_STYLE_MAP: Record<string, string> = {
  short: "plain", long: "long", ponytail: "ponytail", afro: "afro",
};

export const HAIR_COLOR_CANDS: Record<string, string[]> = {
  brown: ["brown", "light_brown", "dark_brown"], black: ["black", "raven"],
  blonde: ["blonde", "blond", "gold"], red: ["redhead", "red", "carrot", "ginger"],
  white: ["white", "platinum", "gray", "silver"], blue: ["blue", "navy"],
};
```

- [ ] **Step 3: Import the mapping + hero-options into the build tool**

In `scripts/src/build-lpc-assets.ts`, delete the inline `SKIN_MAP`, `HAIR_STYLE_MAP`, `HAIR_COLOR_CANDS` (lines ~23–29) and add near the top imports:

```ts
import { SKIN_MAP, HAIR_STYLE_MAP, HAIR_COLOR_CANDS } from "./lpc-mapping";
import * as heroOptions from "@workspace/hero-options";
```

(The body loop still iterates `Object.entries(SKIN_MAP)` and hair loops over `HAIR_STYLE_MAP`/`hairColorMap` exactly as today.)

- [ ] **Step 4: Add the coverage assertion**

In `scripts/src/build-lpc-assets.ts`, add this helper above `main()`:

```ts
// Fail the build if hero-options advertises an id the pipeline never baked.
function assertCoverage() {
  const built = new Set(entries.map((e) => e.id));
  const miss: string[] = [];
  for (const b of heroOptions.builds)
    for (const s of heroOptions.skins)
      if (!built.has(`body:${b.id}:${s.id}`)) miss.push(`body:${b.id}:${s.id}`);
  for (const st of heroOptions.hairStyles) {
    if (st.id === "bald") continue; // bald = no hair layer
    for (const c of heroOptions.hairColors)
      if (!built.has(`hair:${st.id}:${c.id}`)) miss.push(`hair:${st.id}:${c.id}`);
  }
  if (miss.length) throw new Error(`coverage gap — hero-options ids with no baked sprite:\n  ${miss.join("\n  ")}`);
}
```

Call it just before the `catalog.ts` write in `main()` (after the gear loop, before `const catalogTs = ...`):

```ts
  assertCoverage();
```

- [ ] **Step 5: Regenerate assets + catalog**

Run: `pnpm --filter @workspace/scripts run build-lpc`
Expected: `DONE: N assets → public/lpc; catalog.ts + CREDITS.csv written.` with no coverage error. (Requires network — fetches the LPC repo.)

- [ ] **Step 6: Verify the catalog is unchanged**

Run: `git diff --stat artifacts/focusquest/src/lib/hero/catalog.ts artifacts/focusquest/public/lpc`
Expected: **no changes** (or only nondeterministic-ordering noise) — this task is a pure refactor; the same sprites/catalog are produced.

- [ ] **Step 7: Run the hero test suite**

Run: `pnpm --filter @workspace/focusquest test`
Expected: PASS — `catalog-integrity` + `resolve-layers` still green against the regenerated catalog.

- [ ] **Step 8: Commit**

```bash
git add scripts/src/lpc-mapping.ts scripts/src/build-lpc-assets.ts scripts/package.json pnpm-lock.yaml artifacts/focusquest/src/lib/hero/catalog.ts artifacts/focusquest/public/lpc
git commit -m "refactor(hero): extract LPC mapping + add coverage assertion keyed on hero-options"
```

---

## Task 5: Expand hair styles, hair colors, and skin tones (variety)

Data-only additions. Each new option is one `hero-options` entry + one `lpc-mapping` entry; the coverage assertion + regenerate proves it bakes.

**Files:**
- Modify: `lib/hero-options/src/index.ts`
- Modify: `scripts/src/lpc-mapping.ts`
- Modify: `lib/hero-options/src/options.test.ts`
- Modify: `artifacts/focusquest/src/lib/hero/catalog.ts` (regenerated)

**Interfaces:**
- Produces: enlarged `skins`, `hairStyles`, `hairColors` arrays; matching `SKIN_MAP`, `HAIR_STYLE_MAP`, `HAIR_COLOR_CANDS` keys.

- [ ] **Step 1: Discover the available LPC palette/style names**

Run these to list what the upstream palettes/folders actually provide (authoritative — do not guess):

```bash
# hair color palette variant names:
curl -s "https://raw.githubusercontent.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/master/tools/palettes/ulpc-hair-palettes.json" | node -e "process.stdin.on('data',d=>{});let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>console.log(Object.keys(JSON.parse(s)).join(', ')))"
# body (skin) palette variant names:
curl -s "https://raw.githubusercontent.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/master/tools/palettes/ulpc-body-palettes.json" | node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>console.log(Object.keys(JSON.parse(s)).join(', ')))"
# hair style folders:
curl -s "https://api.github.com/repos/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/contents/spritesheets/hair" | node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>console.log(JSON.parse(s).map(e=>e.name).join(', ')))"
```

Record the exact variant/folder names from the output; use only names present in that output in the next steps.

- [ ] **Step 2: Add the new options to `hero-options`**

In `lib/hero-options/src/index.ts`, extend the arrays. Target counts: hair styles ~8–10, hair colors ~12, skins ~9. Example additions (swap each id/swatch for names verified in Step 1):

```ts
// hairStyles — append after "afro":
  { id: "bob", label: "Bob" },
  { id: "curly", label: "Curly" },
  { id: "spiked", label: "Spiked" },
  { id: "bangs", label: "Bangs" },
  { id: "pixie", label: "Pixie" },
```

```ts
// hairColors — append after "blue":
  { id: "gray", label: "Gray", swatch: "#9a9a9a" },
  { id: "silver", label: "Silver", swatch: "#cfd2d6" },
  { id: "green", label: "Green", swatch: "#3f8f4f" },
  { id: "purple", label: "Purple", swatch: "#7c3aed" },
  { id: "pink", label: "Pink", swatch: "#ec6fa8" },
  { id: "orange", label: "Orange", swatch: "#d97a2b" },
```

```ts
// skins — append after "blue":
  { id: "olive", label: "Olive", swatch: "#b98a54" },
  { id: "porcelain", label: "Porcelain", swatch: "#f3d3c2" },
  { id: "umber", label: "Umber", swatch: "#5c3218" },
```

- [ ] **Step 3: Add matching LPC mappings**

In `scripts/src/lpc-mapping.ts`, add a key for every new id from Step 2, using variant/folder names verified in Step 1. Example:

```ts
// HAIR_STYLE_MAP additions:
  bob: "bob", curly: "curly", spiked: "spiked", bangs: "bangs", pixie: "pixie",
```
```ts
// HAIR_COLOR_CANDS additions:
  gray: ["gray", "grey"], silver: ["silver", "platinum"], green: ["green"],
  purple: ["purple", "violet"], pink: ["pink", "rose"], orange: ["orange", "carrot"],
```
```ts
// SKIN_MAP additions:
  olive: "olive", porcelain: "ivory", umber: "umber",
```

(If a candidate name isn't in the Step-1 output, pick the nearest name that is — the same "candidate list" pattern the file already uses for hair colors.)

- [ ] **Step 4: Update the regression-lock test to the new expected lists**

In `lib/hero-options/src/options.test.ts`, update the `preserves the current option values` assertions to the new full id lists (so the lock reflects the intended set). Run:

`pnpm --filter @workspace/hero-options test`
Expected: PASS with the updated expected arrays.

- [ ] **Step 5: Regenerate assets + catalog**

Run: `pnpm --filter @workspace/scripts run build-lpc`
Expected: DONE with no coverage gap. If it throws `coverage gap …` or `no hair palette variant for X` / `no body palette variant Y`, the mapping name in Step 3 doesn't exist upstream — fix it against the Step-1 list and rerun.

- [ ] **Step 6: Confirm the new sprites + catalog entries exist**

Run: `pnpm --filter @workspace/focusquest test`
Expected: PASS — `catalog-integrity` confirms every new `hair:*`/`body:*` entry has a file on disk and a valid z-band.

- [ ] **Step 7: Visually confirm in the app**

Start the dev server (preview) and open the Hero page; the new hair styles/colors and skin tones appear in the pickers (driven by `availableX`) and render on the hero. Fix any obviously-wrong recolor by adjusting the mapping candidate and re-running the build.

- [ ] **Step 8: Commit**

```bash
git add lib/hero-options/src/index.ts lib/hero-options/src/options.test.ts scripts/src/lpc-mapping.ts artifacts/focusquest/src/lib/hero/catalog.ts artifacts/focusquest/public/lpc
git commit -m "feat(hero): expand hair styles, hair colors, and skin tones"
```

---

## Task 6: Add the four new user columns

**Files:**
- Modify: `lib/db/src/schema/users.ts`

**Interfaces:**
- Produces: `usersTable.avatarBeardStyle`, `.avatarBeardColor`, `.avatarGlasses`, `.avatarEarrings` (all `text notNull`).

- [ ] **Step 1: Add the columns**

In `lib/db/src/schema/users.ts`, add after `avatarFace` (line ~24):

```ts
  avatarBeardStyle: text("avatar_beard_style").notNull().default("none"),
  avatarBeardColor: text("avatar_beard_color").notNull().default("brown"),
  avatarGlasses: text("avatar_glasses").notNull().default("none"),
  avatarEarrings: text("avatar_earrings").notNull().default("none"),
```

- [ ] **Step 2: Typecheck the schema**

Run: `pnpm --filter @workspace/db run typecheck` (falls back to `pnpm run typecheck:libs` if the package has no `typecheck` script).
Expected: PASS.

- [ ] **Step 3: Push the migration**

Export `.env` into the shell (per the known gotcha), then:
Run: `pnpm --filter @workspace/db run push`
Expected: drizzle-kit reports 4 columns added to `users`; existing rows get the defaults.

- [ ] **Step 4: Commit**

```bash
git add lib/db/src/schema/users.ts
git commit -m "feat(hero): add beard/glasses/earrings columns to users"
```

---

## Task 7: Add beard/glasses/earrings to `hero-options`, types, and `resolveLayers`

Logic only — no assets yet. Tested with placeholder catalogs like the existing `resolve-layers` tests.

**Files:**
- Modify: `lib/hero-options/src/index.ts`
- Modify: `lib/hero-options/src/options.test.ts`
- Modify: `artifacts/focusquest/src/lib/hero/types.ts`
- Modify: `artifacts/focusquest/src/lib/hero/resolve-layers.ts`
- Modify: `artifacts/focusquest/src/lib/hero/resolve-layers.test.ts`

**Interfaces:**
- Produces:
  - `hero-options`: `beardStyles`, `beardColors`, `glasses`, `earrings` arrays; `BeardStyleId`, `BeardColorId`, `GlassesId`, `EarringId` unions. `beardColors` re-exports `hairColors`.
  - `types.ts`: `LayerCategory` gains `"beard" | "glasses" | "earrings"`; `HeroLook` gains `beardStyle`, `beardColor`, `glasses`, `earrings`.
  - `resolveLayers` emits `beard:{style}:{beardColor}`, `glasses:{style}`, `earrings:{style}` when ≠ `"none"`.

- [ ] **Step 1: Add the new axes to `hero-options`**

In `lib/hero-options/src/index.ts`, add after `hairColors`:

```ts
export const beardStyles = [
  { id: "none", label: "None" },
  { id: "stubble", label: "Stubble" },
  { id: "short", label: "Short" },
  { id: "full", label: "Full" },
  { id: "goatee", label: "Goatee" },
  { id: "mustache", label: "Mustache" },
] as const satisfies readonly Option[];

// Beard color shares the hair palette but is an independent selection.
export const beardColors = hairColors;

export const glasses = [
  { id: "none", label: "None" },
  { id: "round", label: "Round" },
  { id: "square", label: "Square" },
  { id: "sunglasses", label: "Sunglasses" },
] as const satisfies readonly Option[];

export const earrings = [
  { id: "none", label: "None" },
  { id: "studs", label: "Studs" },
  { id: "hoops", label: "Hoops" },
] as const satisfies readonly Option[];

export type BeardStyleId = (typeof beardStyles)[number]["id"];
export type BeardColorId = HairColorId;
export type GlassesId = (typeof glasses)[number]["id"];
export type EarringId = (typeof earrings)[number]["id"];
```

- [ ] **Step 2: Add an invariant test for the optional axes**

In `lib/hero-options/src/options.test.ts`, add inside the `describe`:

```ts
  it("optional axes each start with a 'none' sentinel", () => {
    for (const axis of [beardStyles, glasses, earrings]) {
      expect(axis[0].id).toBe("none");
    }
  });

  it("beardColors shares the hairColors palette", () => {
    expect(ids(beardColors)).toEqual(ids(hairColors));
  });
```

Add `beardStyles, beardColors, glasses, earrings` to the imports at the top of the test file. Run:
`pnpm --filter @workspace/hero-options test`
Expected: PASS.

- [ ] **Step 3: Extend `LayerCategory` and `HeroLook`**

In `artifacts/focusquest/src/lib/hero/types.ts`:

Change `LayerCategory` to include the new categories:

```ts
export type LayerCategory =
  | "aura" | "body" | "face" | "earrings" | "beard" | "hair" | "outfit"
  | "boots" | "armor" | "helmet" | "weapon" | "glasses" | "accessory";
```

Add the new fields to `HeroLook` (after `face`):

```ts
  beardStyle: BeardStyleId;
  beardColor: HairColorId;
  glasses: GlassesId;
  earrings: EarringId;
```

Add to the type import from `hero-options` at the top of `types.ts`:

```ts
import type {
  BuildId, SkinId, HairStyleId, HairColorId, FaceId as FaceIdOpt, ClassId,
  BeardStyleId, GlassesId, EarringId,
} from "@workspace/hero-options";
```

`isGearCategory`/`GEAR_CATEGORIES` stay unchanged — beard/glasses/earrings are deliberately **not** gear, so they get no rarity tint.

- [ ] **Step 4: Write the failing `resolveLayers` tests**

In `artifacts/focusquest/src/lib/hero/resolve-layers.test.ts`, update the shared `look` fixture to include the new fields:

```ts
const look: HeroLook = {
  skin: "light", build: "male", hairStyle: "short", hairColor: "brown",
  face: "neutral", beardStyle: "none", beardColor: "black",
  glasses: "none", earrings: "none",
  avatarClass: "fighter", tier: 0, equipped: [],
};
```

Add these cases inside the first `describe("resolveLayers", …)`:

```ts
  it("emits beard/glasses/earrings layers when set, with beard using its own color", () => {
    const c = cat([
      ...baseEntries,
      base("earrings:studs", "earrings", 15),
      base("beard:full:black", "beard", 20),
      base("glasses:round", "glasses", 35),
    ]);
    const layers = resolveLayers(
      { ...look, beardStyle: "full", beardColor: "black", glasses: "round", earrings: "studs" },
      c,
    );
    const files = layers.map((l) => l.file);
    expect(files).toContain("/lpc/earrings:studs.png");
    expect(files).toContain("/lpc/beard:full:black.png");
    expect(files).toContain("/lpc/glasses:round.png");
    // z-order: earrings(15) < beard(20) < hair(30) < glasses(35)
    const idx = (s: string) => files.findIndex((f) => f.includes(s));
    expect(idx("earrings")).toBeLessThan(idx("beard"));
    expect(idx("beard")).toBeLessThan(idx("hair"));
    expect(idx("hair")).toBeLessThan(idx("glasses"));
  });

  it("emits no beard/glasses/earrings layer when the value is 'none'", () => {
    const layers = resolveLayers(look, fullCatalog);
    for (const s of ["beard", "glasses", "earrings"]) {
      expect(layers.some((l) => l.file.includes(s))).toBe(false);
    }
  });

  it("beard/glasses/earrings carry no rarity tint (not gear)", () => {
    const c = cat([...baseEntries, base("beard:full:red", "beard", 20)]);
    const layers = resolveLayers({ ...look, beardStyle: "full", beardColor: "red" }, c);
    expect(layers.find((l) => l.file.includes("beard"))!.tint).toBeUndefined();
  });
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `pnpm --filter @workspace/focusquest test src/lib/hero/resolve-layers.test.ts`
Expected: FAIL — `collectIds` doesn't emit the new ids yet (and `look` may fail typecheck until Step 6's field usage compiles; that is expected pre-implementation).

- [ ] **Step 6: Emit the new ids in `collectIds`**

In `artifacts/focusquest/src/lib/hero/resolve-layers.ts`, inside `collectIds`, after the hair `push` and before the `outfit` push, add:

```ts
  if (look.earrings !== "none") ids.push(`earrings:${look.earrings}`);
  if (look.beardStyle !== "none") ids.push(`beard:${look.beardStyle}:${look.beardColor}`);
  if (look.glasses !== "none") ids.push(`glasses:${look.glasses}`);
```

(Order within `collectIds` doesn't affect render order — `resolveLayers` sorts by `zIndex` — but grouping them with hair keeps it readable.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @workspace/focusquest test src/lib/hero/resolve-layers.test.ts`
Expected: PASS (new cases green; existing cases still green).

- [ ] **Step 8: Typecheck focusquest**

Run: `pnpm --filter @workspace/focusquest run typecheck`
Expected: FAIL at `avatar.tsx` — the `heroLook` literal there doesn't yet supply the four new fields. That is expected and fixed in Task 11; note it and proceed. (If you prefer a green typecheck at every task boundary, apply Task 11 Step 2's `heroLook` field additions now.)

- [ ] **Step 9: Commit**

```bash
git add lib/hero-options/src/index.ts lib/hero-options/src/options.test.ts artifacts/focusquest/src/lib/hero/types.ts artifacts/focusquest/src/lib/hero/resolve-layers.ts artifacts/focusquest/src/lib/hero/resolve-layers.test.ts
git commit -m "feat(hero): beard/glasses/earrings axes, types, and resolveLayers logic"
```

---

## Task 8: Bake the beard layer

**Files:**
- Modify: `scripts/src/lpc-mapping.ts`
- Modify: `scripts/src/build-lpc-assets.ts`
- Modify: `artifacts/focusquest/src/lib/hero/catalog.ts` (regenerated)
- Modify: `artifacts/focusquest/src/lib/hero/catalog-integrity.test.ts`

**Interfaces:**
- Consumes: `hero-options` `beardStyles`, `beardColors`; hair palette recolor.
- Produces: `beard:{style}:{color}` catalog entries at z=20; `BEARD_STYLE_MAP` in `lpc-mapping`.

- [ ] **Step 1: Discover the LPC facial-hair defs**

```bash
curl -s "https://api.github.com/repos/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/contents/spritesheets/beards" | node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>console.log(JSON.parse(s).map(e=>e.name).join(', ')))"
```

If `beards` 404s, try `facial`:

```bash
curl -s "https://api.github.com/repos/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/contents/spritesheets/facial" | node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>console.log(JSON.parse(s).map(e=>e.name).join(', ')))"
```

Record the real folder path and per-style leaf (e.g. `beards/{style}/adult/walk.png`) — you'll use it in Step 3. These beard sheets recolor with the **hair** palette (`ulpc-hair-palettes.json`), same as hair.

- [ ] **Step 2: Add the beard style mapping**

In `scripts/src/lpc-mapping.ts`, add (folder names from Step 1; only include styles that exist upstream — drop any that don't and remove them from `hero-options.beardStyles` to keep coverage exact):

```ts
// our beard style id → LPC beard folder (recolored via the hair palette). 'none' is not baked.
export const BEARD_STYLE_MAP: Record<string, string> = {
  stubble: "stubble", short: "beard", full: "bigbeard", goatee: "goatee", mustache: "mustache",
};
```

- [ ] **Step 3: Add the beard build loop**

In `scripts/src/build-lpc-assets.ts`, add `Z.beard = 20` (and `Z.earrings = 15`, `Z.glasses = 35` while you're here) to the `Z` map:

```ts
const Z = { aura: 5, body: 10, earrings: 15, beard: 20, hair: 30, glasses: 35, outfit: 40, boots: 50, armor: 60, helmet: 70, weapon: 80, accessory: 90 };
```

Import the mapping: extend the existing `./lpc-mapping` import with `BEARD_STYLE_MAP`.

After the HAIR loop (after its `console.log`), add — mirroring the hair loop, recolored per beard color via the hair palette:

```ts
  // BEARD = style sheet recolored per beard color (shares the hair palette)
  const BEARD_LEAF = "spritesheets/beards"; // adjust to the folder verified in Task 8 Step 1
  for (const [ourStyle, lpcStyle] of Object.entries(BEARD_STYLE_MAP)) {
    let sheet = await loadSheet(`${RAW}/${BEARD_LEAF}/${lpcStyle}/adult/walk.png`);
    if (!sheet) sheet = await loadSheet(`${RAW}/${BEARD_LEAF}/${lpcStyle}/walk.png`);
    if (!sheet) throw new Error(`missing beard ${lpcStyle}`);
    const base = cropSouth(sheet), src = detectSource(base, hairPal);
    for (const [ourColor, variant] of Object.entries(hairColorMap)) {
      if (!variant) throw new Error(`no hair palette variant for ${ourColor}`);
      writePng("beard", `${ourStyle}_${ourColor}`, recolor(base, hairPal[src], hairPal[variant]));
      entries.push({ id: `beard:${ourStyle}:${ourColor}`, category: "beard", zIndex: Z.beard, file: `/lpc/beard/${ourStyle}_${ourColor}.png`, ...cc(CRED.hair) });
    }
    console.log(`✓ beard ${ourStyle}`);
  }
```

Add `mkdirSync(join(LPC_OUT, "beard"), { recursive: true });` alongside the other `mkdirSync` calls in `main()`.

Extend `assertCoverage()` with the beard check:

```ts
  for (const st of heroOptions.beardStyles) {
    if (st.id === "none") continue;
    for (const c of heroOptions.beardColors)
      if (!built.has(`beard:${st.id}:${c.id}`)) miss.push(`beard:${st.id}:${c.id}`);
  }
```

- [ ] **Step 4: Update `catalog-integrity` z-bands**

In `artifacts/focusquest/src/lib/hero/catalog-integrity.test.ts`, extend `Z_BANDS`:

```ts
const Z_BANDS: Record<string, number> = { aura: 5, body: 10, earrings: 15, beard: 20, face: 20, hair: 30, glasses: 35, outfit: 40, boots: 50, armor: 60, helmet: 70, weapon: 80, accessory: 90 };
```

- [ ] **Step 5: Regenerate + test**

Run: `pnpm --filter @workspace/scripts run build-lpc`
Expected: DONE, no coverage gap, new `beard/*.png` written. If a `BEARD_STYLE_MAP` folder 404s, fix it against Step 1 and rerun.

Run: `pnpm --filter @workspace/focusquest test`
Expected: PASS — `catalog-integrity` finds every `beard:*` entry on disk with z=20; `attribution` finds authors/license.

- [ ] **Step 6: Commit**

```bash
git add scripts/src/lpc-mapping.ts scripts/src/build-lpc-assets.ts artifacts/focusquest/src/lib/hero/catalog.ts artifacts/focusquest/src/lib/hero/catalog-integrity.test.ts artifacts/focusquest/public/lpc
git commit -m "feat(hero): bake beard layer (style x color, hair-palette recolor)"
```

---

## Task 9: Bake the glasses + earrings layers

**Files:**
- Modify: `scripts/src/lpc-mapping.ts`
- Modify: `scripts/src/build-lpc-assets.ts`
- Modify: `artifacts/focusquest/src/lib/hero/catalog.ts` (regenerated)

**Interfaces:**
- Consumes: `hero-options` `glasses`, `earrings`.
- Produces: `glasses:{style}` (z=35) and `earrings:{style}` (z=15) catalog entries, single-color, universal.

- [ ] **Step 1: Discover the LPC glasses + earring defs**

```bash
curl -s "https://api.github.com/repos/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/contents/spritesheets/facial" | node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>console.log(JSON.parse(s).map(e=>e.name).join(', ')))"
curl -s "https://api.github.com/repos/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/contents/spritesheets/head" | node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>console.log(JSON.parse(s).map(e=>e.name).join(', ')))"
```

Record the real leaf paths for each glasses style (round/square/sunglasses) and earring style (studs/hoops). Glasses commonly live under `facial/glasses/...`; earrings under `facial/earring/...` or `head/`. Confirm each has a standard `walk.png` (or `.../adult/walk.png`) with south-frame content; drop any style whose asset doesn't exist (and remove it from `hero-options`) to keep coverage exact.

- [ ] **Step 2: Add the glasses + earring mappings**

In `scripts/src/lpc-mapping.ts`, add (paths relative to `spritesheets/`, from Step 1; each value is a full leaf minus `/walk.png`):

```ts
// our glasses id → LPC leaf dir (single color, universal). 'none' is not baked.
export const GLASSES_MAP: Record<string, string> = {
  round: "facial/glasses/round/adult",
  square: "facial/glasses/square/adult",
  sunglasses: "facial/glasses/sunglasses/adult",
};
// our earring id → LPC leaf dir.
export const EARRING_MAP: Record<string, string> = {
  studs: "facial/earring/stud/adult",
  hoops: "facial/earring/hoop/adult",
};
```

- [ ] **Step 3: Add a shared "single-sheet cosmetic" build loop**

In `scripts/src/build-lpc-assets.ts`, extend the `./lpc-mapping` import with `GLASSES_MAP, EARRING_MAP`. Add a helper above `main()`:

```ts
// Bake a single-color, universal cosmetic layer (glasses, earrings): one sprite per style.
async function buildCosmetic(category: "glasses" | "earrings", map: Record<string, string>) {
  mkdirSync(join(LPC_OUT, category), { recursive: true });
  for (const [style, leaf] of Object.entries(map)) {
    let sheet = await loadSheet(`${RAW}/spritesheets/${leaf}/walk.png`);
    if (!sheet) sheet = await loadSheet(`${RAW}/spritesheets/${leaf}.png`);
    if (!sheet) throw new Error(`missing ${category} ${style} at ${leaf}`);
    writePng(category, style, cropSouth(sheet));
    entries.push({ id: `${category}:${style}`, category, zIndex: Z[category], file: `/lpc/${category}/${style}.png`, ...cc(CRED.hair) });
    console.log(`✓ ${category} ${style}`);
  }
}
```

Note: `CRED.hair` is a placeholder attribution — replace with a dedicated `CRED.facial` entry authored from the def's `credits` (see Step 4). Call the helper in `main()` after the beard loop:

```ts
  await buildCosmetic("earrings", EARRING_MAP);
  await buildCosmetic("glasses", GLASSES_MAP);
```

Extend `assertCoverage()`:

```ts
  for (const g of heroOptions.glasses) if (g.id !== "none" && !built.has(`glasses:${g.id}`)) miss.push(`glasses:${g.id}`);
  for (const e of heroOptions.earrings) if (e.id !== "none" && !built.has(`earrings:${e.id}`)) miss.push(`earrings:${e.id}`);
```

- [ ] **Step 4: Add real attribution for the facial assets**

Add a `CRED.facial` entry near the other `CRED` definitions, authored from the LPC facial def credits recorded in Step 1 (authors/license/url). Use it instead of `CRED.hair` in `buildCosmetic`. If the def `credits` are available via `fetchDef`, prefer pulling them programmatically as the outfit/gear path does; otherwise hand-enter from the def JSON.

- [ ] **Step 5: Regenerate + test**

Run: `pnpm --filter @workspace/scripts run build-lpc`
Expected: DONE, no coverage gap, `glasses/*.png` + `earrings/*.png` written.

Run: `pnpm --filter @workspace/focusquest test`
Expected: PASS — integrity finds the new entries (z=35 glasses, z=15 earrings) on disk with non-empty author/license.

- [ ] **Step 6: Commit**

```bash
git add scripts/src/lpc-mapping.ts scripts/src/build-lpc-assets.ts artifacts/focusquest/src/lib/hero/catalog.ts artifacts/focusquest/public/lpc
git commit -m "feat(hero): bake glasses + earrings cosmetic layers"
```

---

## Task 10: Extend the avatar API with the new fields

**Files:**
- Modify: `artifacts/api-server/src/routes/avatar.ts`
- Modify: `lib/api-spec/openapi.yaml`
- Modify: `lib/api-client-react/**`, `lib/api-zod/**` (regenerated)

**Interfaces:**
- Consumes: `hero-options` `beardStyles, beardColors, glasses, earrings`, `usersTable` new columns.
- Produces: `AvatarProfile` gains `avatarBeardStyle, avatarBeardColor, avatarGlasses, avatarEarrings` + `availableBeardStyles, availableBeardColors, availableGlasses, availableEarrings`; `AvatarUpdateInput` accepts the four fields.

- [ ] **Step 1: Return + validate the new fields in the route**

In `artifacts/api-server/src/routes/avatar.ts`, extend the `hero-options` import:

```ts
import {
  builds, skins, hairStyles, hairColors, faces, classes, colors,
  beardStyles, beardColors, glasses, earrings,
  ids, includesId,
} from "@workspace/hero-options";
```

In `buildAvatarResponse`, add to the returned object (after `avatarFace`):

```ts
    avatarBeardStyle: user.avatarBeardStyle ?? "none",
    avatarBeardColor: user.avatarBeardColor ?? "brown",
    avatarGlasses:    user.avatarGlasses    ?? "none",
    avatarEarrings:   user.avatarEarrings   ?? "none",
```

and to the `available*` block:

```ts
    availableBeardStyles: ids(beardStyles),
    availableBeardColors: ids(beardColors),
    availableGlasses:     ids(glasses),
    availableEarrings:    ids(earrings),
```

In the PATCH handler, add to the destructure and add four validation guards following the existing pattern:

```ts
  if (avatarBeardStyle != null) {
    if (!includesId(beardStyles, avatarBeardStyle)) { res.status(400).json({ error: "Invalid beard style" }); return; }
    updates.avatarBeardStyle = avatarBeardStyle;
  }
  if (avatarBeardColor != null) {
    if (!includesId(beardColors, avatarBeardColor)) { res.status(400).json({ error: "Invalid beard color" }); return; }
    updates.avatarBeardColor = avatarBeardColor;
  }
  if (avatarGlasses != null) {
    if (!includesId(glasses, avatarGlasses)) { res.status(400).json({ error: "Invalid glasses" }); return; }
    updates.avatarGlasses = avatarGlasses;
  }
  if (avatarEarrings != null) {
    if (!includesId(earrings, avatarEarrings)) { res.status(400).json({ error: "Invalid earrings" }); return; }
    updates.avatarEarrings = avatarEarrings;
  }
```

(Add `avatarBeardStyle, avatarBeardColor, avatarGlasses, avatarEarrings` to the `req.body` destructure + its inline type.)

- [ ] **Step 2: Update the OpenAPI schema**

In `lib/api-spec/openapi.yaml`, under `AvatarProfile.properties` add (after `avatarFace`):

```yaml
        avatarBeardStyle:
          type: string
        avatarBeardColor:
          type: string
        avatarGlasses:
          type: string
        avatarEarrings:
          type: string
        availableBeardStyles:
          type: array
          items:
            type: string
        availableBeardColors:
          type: array
          items:
            type: string
        availableGlasses:
          type: array
          items:
            type: string
        availableEarrings:
          type: array
          items:
            type: string
```

Under `AvatarUpdateInput.properties` add the four `type: string` fields (`avatarBeardStyle`, `avatarBeardColor`, `avatarGlasses`, `avatarEarrings`).

Loosen the enum'd appearance fields to plain `string` in **both** `AvatarProfile` and `AvatarUpdateInput` — remove the `enum: [...]` lines from `avatarSkin` (and `avatarClass` if you want it validated solely server-side; keep `avatarClass`'s enum if you prefer). Per the spec, drop the `avatarSkin` enum:

```yaml
        avatarSkin:
          type: string
```

- [ ] **Step 3: Regenerate the client + zod types**

Run: `pnpm --filter @workspace/api-spec run codegen`
Expected: Orval regenerates `lib/api-client-react` + `lib/api-zod`; the bundled `typecheck:libs` passes.

- [ ] **Step 4: Typecheck the API server**

Run: `pnpm --filter @workspace/api-server run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/avatar.ts lib/api-spec/openapi.yaml lib/api-client-react lib/api-zod
git commit -m "feat(hero): expose beard/glasses/earrings on the avatar API"
```

---

## Task 11: Add the new pickers to the Hero UI

**Files:**
- Modify: `artifacts/focusquest/src/pages/avatar.tsx`

**Interfaces:**
- Consumes: `avatarData.availableBeardStyles/…`, the new `PixelHero` fields.
- Produces: Beard, Beard color, Glasses, Earrings pickers wired through `updateAvatar`.

- [ ] **Step 1: Feed the new fields into `heroLook`**

In `artifacts/focusquest/src/pages/avatar.tsx`, extend the `heroLook` object (after `face`):

```ts
    beardStyle: (avatarData?.avatarBeardStyle ?? "none") as HeroLook["beardStyle"],
    beardColor: (avatarData?.avatarBeardColor ?? "brown") as HeroLook["beardColor"],
    glasses: (avatarData?.avatarGlasses ?? "none") as HeroLook["glasses"],
    earrings: (avatarData?.avatarEarrings ?? "none") as HeroLook["earrings"],
```

- [ ] **Step 2: Add the pickers**

After the existing Hair Color `PickerRow` (line ~650), add:

```tsx
            <PickerRow label="Beard" options={avatarData?.availableBeardStyles ?? []} value={heroLook.beardStyle}
              onSelect={(v) => handleAttrSelect({ avatarBeardStyle: v })} disabled={updateAvatar.isPending} />
            <PickerRow label="Beard Color" options={avatarData?.availableBeardColors ?? []} value={heroLook.beardColor}
              onSelect={(v) => handleAttrSelect({ avatarBeardColor: v })} disabled={updateAvatar.isPending} swatch={HAIR_SWATCH} />
            <PickerRow label="Glasses" options={avatarData?.availableGlasses ?? []} value={heroLook.glasses}
              onSelect={(v) => handleAttrSelect({ avatarGlasses: v })} disabled={updateAvatar.isPending} />
            <PickerRow label="Earrings" options={avatarData?.availableEarrings ?? []} value={heroLook.earrings}
              onSelect={(v) => handleAttrSelect({ avatarEarrings: v })} disabled={updateAvatar.isPending} />
```

- [ ] **Step 3: Add a light divider between Hair and Face pickers**

Immediately before the Beard `PickerRow`, add a subtle separator so the panel groups Body/Skin/Hair vs Face:

```tsx
            <div className="w-full border-t border-border/40 pt-1" />
```

- [ ] **Step 4: Typecheck + tests**

Run: `pnpm --filter @workspace/focusquest run typecheck && pnpm --filter @workspace/focusquest test`
Expected: PASS — `heroLook` now supplies every `HeroLook` field; hero tests green.

- [ ] **Step 5: Visually verify in the app**

Start the dev server (preview) and open the Hero page. Confirm: Beard/Beard color/Glasses/Earrings pickers appear; selecting a beard style shows a beard in the chosen color under the hair; glasses render over the face; earrings render; "None" removes each layer. Selections persist across reload (PATCH round-trip).

- [ ] **Step 6: Commit**

```bash
git add artifacts/focusquest/src/pages/avatar.tsx
git commit -m "feat(hero): beard, beard-color, glasses, and earrings pickers"
```

---

## Task 12: Add the hero-options coverage test, full suite, and docs

**Files:**
- Modify: `artifacts/focusquest/src/lib/hero/catalog-integrity.test.ts`
- Modify: `docs/superpowers/plans/2026-07-10-hero-customization-expansion.md` (check off) and dev-command notes if any

**Interfaces:**
- Produces: an integrity test that asserts every `hero-options` id resolves to a baked catalog entry — the runtime mirror of the build-time `assertCoverage`.

- [ ] **Step 1: Write the coverage test**

In `artifacts/focusquest/src/lib/hero/catalog-integrity.test.ts`, add a new `describe`:

```ts
import * as hero from "@workspace/hero-options";

describe("hero-options ↔ catalog coverage", () => {
  const has = (id: string) => CATALOG.some((e) => e.id === id);

  it("every body (build × skin) is baked", () => {
    for (const b of hero.builds) for (const s of hero.skins) {
      expect(has(`body:${b.id}:${s.id}`), `missing body:${b.id}:${s.id}`).toBe(true);
    }
  });

  it("every hair (style × color, excl. bald) is baked", () => {
    for (const st of hero.hairStyles) {
      if (st.id === "bald") continue;
      for (const c of hero.hairColors) expect(has(`hair:${st.id}:${c.id}`), `missing hair:${st.id}:${c.id}`).toBe(true);
    }
  });

  it("every beard (style × color, excl. none) is baked", () => {
    for (const st of hero.beardStyles) {
      if (st.id === "none") continue;
      for (const c of hero.beardColors) expect(has(`beard:${st.id}:${c.id}`), `missing beard:${st.id}:${c.id}`).toBe(true);
    }
  });

  it("every glasses + earring style (excl. none) is baked", () => {
    for (const g of hero.glasses) if (g.id !== "none") expect(has(`glasses:${g.id}`), `missing glasses:${g.id}`).toBe(true);
    for (const e of hero.earrings) if (e.id !== "none") expect(has(`earrings:${e.id}`), `missing earrings:${e.id}`).toBe(true);
  });
});
```

- [ ] **Step 2: Run the full focusquest suite**

Run: `pnpm --filter @workspace/focusquest test`
Expected: PASS — coverage, integrity, attribution, and resolve-layers all green.

- [ ] **Step 3: Run the workspace typecheck**

Run: `pnpm run typecheck`
Expected: PASS across libs + artifacts + scripts.

- [ ] **Step 4: Note the dev workflow**

If any new command surfaced (e.g. a beard/facial asset refresh), add a one-line note to `reference-dev-commands` memory or the repo's dev docs. No code change if nothing new.

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/lib/hero/catalog-integrity.test.ts
git commit -m "test(hero): assert hero-options ↔ catalog coverage across all axes"
```

---

## Self-Review

**Spec coverage:**
- Two new layers (beard indep. style+color; glasses+earrings independent slots) → Tasks 6, 7, 8, 9, 10, 11. ✓
- More hair styles/colors/skin tones → Task 5. ✓
- `@workspace/hero-options` single source of truth → Tasks 1–3; consumed by API (2), focusquest (3), build tool (4). ✓
- LPC mapping in `scripts`, keyed by hero-options → Task 4. ✓
- Build-time coverage assertion → Task 4 (extended in 8, 9). ✓
- OpenAPI appearance fields loosened to `string` → Task 10 Step 2. ✓
- Zero visual migration (defaults) → Task 6 (`'none'`/`'brown'` defaults). ✓
- Z-order earrings=15/beard=20/hair=30/glasses=35 → Task 7 tests + Task 8 `Z` map + Task 8/9 catalog-integrity bands. ✓
- Testing (resolve-layers, catalog-integrity, attribution, coverage) → Tasks 7, 8, 12. ✓
- Build order (hero-options → spike → variety → beard → accessories → tests) → Task order matches spec. ✓
- Non-goals (eyes, expressions, new builds, runtime tint, presets) → none introduced. ✓

**Placeholder scan:** LPC leaf paths for beard/glasses/earrings are the one genuinely-unknown input; each such task opens with a concrete discovery command (exact `curl` against the LPC repo) and instructs filling the mapping from its output, mirroring how the existing build script's paths were verified — not a hand-waved "TBD". `CRED.hair` used as a temporary beard/facial credit is explicitly flagged and replaced with real attribution in Task 9 Step 4. All code steps carry real code.

**Type consistency:** `Option`, `ids`, `includesId`, the id-union names (`SkinId`, `HairColorId`, `BeardStyleId`, `GlassesId`, `EarringId`), the `HeroLook` field names (`beardStyle`, `beardColor`, `glasses`, `earrings`), the catalog id shapes (`beard:{style}:{color}`, `glasses:{style}`, `earrings:{style}`), and the z-values (15/20/35) are used identically across the build tool, `resolveLayers`, tests, API, and UI.
