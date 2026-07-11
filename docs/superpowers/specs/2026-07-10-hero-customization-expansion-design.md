# Hero Customization Expansion — Design Spec

Adds more character-creator customization on top of the live layered hero system
(Phases 0–2, PR #4). Two new appearance layers plus deeper variety in the existing
sliders, and a one-time consolidation of the duplicated option lists into a single
shared source of truth so future "add more options" edits are trivial.

## Goal

Give players more ways to customize their hero's **appearance** (free, always-available
cosmetics — no XP gate), and make adding future options cheap:

1. **Two new layers**: **beard** (independent style + color) and **face accessories**
   (**glasses** and **earrings** as two independent slots, both wearable at once).
2. **More variety** in existing sliders: more hair styles (~8–10), more hair colors (~12),
   more skin tones (~9).
3. **Consolidate** the option lists — today re-declared in ~4 places — into a shared
   `@workspace/hero-options` package that validation, `availableX`, types, and UI all read,
   with the LPC-specific build mapping kept next to the build tool.

Everything renders through the existing compositor (`resolveLayers` + `PixelHero`) and is
baked by the existing `build-lpc-assets.ts` palette-swap pipeline. No new runtime rendering
mechanism.

## Decisions locked during brainstorming

1. **All new customization is free cosmetic**, stored on the user row — matches how
   build/skin/hair already work. Not earned like gear; no battle-power effect.
2. **Body types stay male/female.** More body builds are explicitly out of scope (each new
   build multiplies the entire outfit/gear/hair/beard catalog — its own future project).
3. **Beard has its own color**, independent of hair color (its own field + picker).
4. **Glasses and earrings are two independent slots**, not one accessory picker.
5. **Baked palette-swap, not runtime tinting**, for all colors. The build tool already
   recolors through LPC palette ramps at build time (higher fidelity than a runtime tint);
   more colors/tones are near-free map extensions, so we keep that mechanism.
6. **Hybrid build approach:** consolidate the option lists into a shared source of truth
   first, then add the new layers and variety on top.
7. **Eyes and expressions deferred.** Eye color would require rebuilding the body sprites
   (default eyes are baked into the body); expressions read poorly at 64px. Neither is in
   this pass.

## Shared option source of truth (the consolidation)

### `@workspace/hero-options` (new `lib/hero-options` package) — public registry

Canonical, ordered option ids per axis, the derived TS union types, and light presentation
metadata. This is the single declaration everything downstream reads.

Axes: `builds`, `skins`, `hairStyles`, `hairColors`, `beardStyles`, `beardColors`, `glasses`,
`earrings`. The color palette (expanded hair-color set) is defined **once**; both `hairColors`
and `beardColors` reference it (same palette, two independent selections).

Per option: `{ id, label, swatch? }` — `swatch` is the hex used by color pickers (replaces the
hardcoded `SKIN_SWATCH` / `HAIR_SWATCH` maps in the UI). Also exports per-axis derived union
types (e.g. `type HairColor = …`) and, for convenience, the `"none"` sentinel for optional axes
(`beardStyles`, `glasses`, `earrings` all include `"none"`).

Consumed by: **api-server** (validation + `availableX`), **focusquest** (`HeroLook` field types
+ UI swatch/label lookups). Intentionally build-agnostic — it carries no LPC path/palette strings.

### LPC mapping — stays in `scripts` (build-time only)

The "our id → LPC palette variant / style folder" detail (today's `SKIN_MAP`,
`HAIR_COLOR_CANDS`, `HAIR_STYLE_MAP`, and new beard/glasses/earrings maps) lives next to the
build tool, keyed by the `hero-options` ids. A **build-time coverage assertion** guarantees every
public id has a mapping that resolves to a real, non-blank sprite (extends today's "throw on
missing palette / blank sprite" behavior) — so the UI can never advertise an option the pipeline
didn't bake.

### OpenAPI / codegen

The avatar appearance fields currently generate string-literal union types. To avoid a competing
declaration, **loosen these fields to plain `string`** in `openapi.yaml`; the server validates at
runtime against `hero-options`, and the UI is driven by `availableX`. Upside: adding an option
needs no codegen regen or client rebuild. Downside: the generated client type for these fields is
`string` not a union — the UI already casts them, so nothing real is lost.

## New-layer architecture

### Categories & z-order

New `LayerCategory` values: `beard`, `glasses`, `earrings`. None are gear categories, so the
existing `isGearCategory` guard already excludes them from the rarity tint pass (unchanged logic).

Z-order — new entries slot around the head (final numbers visually tuned at build time, as the
pipeline already does for other layers):

| Layer | z | Rationale |
|---|---|---|
| body | 10 | face/eyes baked in |
| **earrings** | **15** | on the ears |
| **beard** | **20** | chin/jaw, under hair that drapes |
| hair | 30 | unchanged |
| **glasses** | **35** | above hair so frames read clearly at 64px |
| outfit… | 40+ | unchanged |

The `Z` map in the build tool gains `earrings`, `beard`, `glasses`; catalog `zIndex` is emitted
from it as today.

### `HeroLook` fields

Adds four fields, each defaulting to `"none"` (except `beardColor`, whose default is inert while
`beardStyle="none"`):

```
beardStyle:  BeardStyle    // "none" | "stubble" | "short" | "full" | "goatee" | "mustache"
beardColor:  BeardColor    // same palette as hairColors
glasses:     GlassesStyle  // "none" | "round" | "square" | "sunglasses"
earrings:    EarringStyle  // "none" | "studs" | "hoops"
```

### `resolveLayers` / `collectIds`

After the hair id, emit (only when the value ≠ `"none"`):
- `beard:{beardStyle}:{beardColor}` — recolored per beardColor at build (style × color baked
  files, exactly like hair).
- `glasses:{glasses}` — single-color, **universal** (unisex head → no `:build` suffix).
- `earrings:{earrings}` — single-color, universal.

Missing/`"none"` axes emit no layer. New categories carry no tint (not gear), so the existing
tint logic is unchanged.

## Data model

Four new `usersTable` columns (`lib/db/src/schema/users.ts`), same shape as the existing
avatar columns:

```
avatarBeardStyle  text not null default 'none'
avatarBeardColor  text not null default 'brown'
avatarGlasses     text not null default 'none'
avatarEarrings    text not null default 'none'
```

Defaulting to `'none'` means **every existing user renders identically to today** (clean-shaven,
no accessories) — zero visual migration. Applied via `drizzle push` (existing workflow; mind the
`.env` export gotcha).

## Art pipeline (extend `scripts/src/build-lpc-assets.ts`)

- **Three new build loops**, each parallel to the existing HAIR loop:
  - **beard**: `beardStyles × beardColors`, recolored through the LPC hair palette, z=20.
    Attribution: LPC beard/facial-hair credits (new `CRED` entry).
  - **glasses**: single-color, universal, z=35. New `CRED` entry.
  - **earrings**: single-color, universal, z=15. New `CRED` entry.
- **Extend the maps** (now keyed by `hero-options` ids, living in the `scripts` LPC-mapping
  module): more `HAIR_STYLE_MAP` entries, an expanded hair-color palette, more `SKIN_MAP` tones —
  each verified against the live LPC folders / `ulpc-*-palettes.json`, the same path-verification
  spike the current code documents.
- **Coverage assertion**: every `hero-options` id resolves to a real, non-blank baked sprite.
- Regenerated `catalog.ts` (adds `beard:*`, `glasses:*`, `earrings:*`, plus the new hair/skin
  variants) and `CREDITS.csv` (new rows for the beard/glasses/earrings families).

Exact style/color/tone lists are pinned at build time against what LPC actually provides
(the design commits to the counts, not the literal names — verified during the pipeline spike).

## API — `artifacts/api-server/src/routes/avatar.ts`

- Delete the hardcoded `AVATAR_*` constant arrays; import the lists from `hero-options` for both
  PATCH validation and the `availableX` response fields.
- `buildAvatarResponse` returns the four new fields (`avatarBeardStyle`, `avatarBeardColor`,
  `avatarGlasses`, `avatarEarrings`) plus `availableBeardStyles`, `availableBeardColors`,
  `availableGlasses`, `availableEarrings`.
- PATCH validates the four new fields against the `hero-options` lists and writes them.
- `openapi.yaml`: add the four fields to the avatar response + update input; loosen the appearance
  fields to `string`. Regenerate the Orval client + Zod types via the existing codegen command.

## UI — `artifacts/focusquest/src/pages/avatar.tsx`

- New `PickerRow`s in the character panel: **Beard** (style pills incl. "none"), **Beard color**
  (swatches), **Glasses** (pills), **Earrings** (pills) — reusing the existing component.
- Replace the hardcoded `SKIN_SWATCH` / `HAIR_SWATCH` maps with `hero-options` swatch lookups, so
  new colors/tones render automatically with no hand-editing.
- Light grouping (a subtle divider between Body/Skin, Hair, and Face pickers) since the panel
  grows — no redesign.
- Variety additions (more hair styles/colors/skin tones) need **no UI code change** beyond the
  swatch-lookup switch: the pickers already map over the server's `availableX`.

## Testing

- **`resolve-layers.test.ts`** — beard/glasses/earrings emitted with correct ids (incl.
  `beardColor`) when set, omitted on `"none"`, sorted to the right z-band; existing placeholder
  cases kept.
- **`catalog-integrity.test.ts`** — every `hero-options` id across all axes resolves to a
  `catalog.ts` entry whose `file` exists on disk; new categories present; z-indices within band.
- **Attribution coverage** — every new `public/lpc/**` PNG has a catalog entry with non-empty
  author/license and a `CREDITS.csv` row.
- **API validation** — PATCH rejects invalid values for the four new fields and accepts valid
  ones; `availableX` includes the four new axes.

## Build order (sequenced to de-risk)

1. **`hero-options` package** — create the shared registry; migrate api-server validation +
   `availableX` and focusquest types/UI to read from it (no behavior change yet). Establishes the
   single source of truth before anything new is added.
2. **Pipeline spike** — move the existing skin/hair/style maps into the `scripts` LPC-mapping
   module keyed by `hero-options`; add the coverage assertion. Regenerate; confirm the current
   hero still renders identically. De-risks the consolidation before adding volume.
3. **Variety** — extend hair styles, hair colors, skin tones; regenerate catalog + credits;
   confirm the new options appear and render.
4. **Beard layer** — schema columns, `hero-options` axes, build loop, `resolveLayers`, API, UI
   pickers (style + color); tests.
5. **Face accessories** — glasses + earrings: schema columns, axes, build loops, `resolveLayers`,
   API, UI pickers; tests.
6. **Full test pass + docs** — catalog-integrity/attribution/API/resolve-layers green; drizzle
   push; note any new dev commands.

## Files

### New
- `lib/hero-options/**` — shared option registry package (`@workspace/hero-options`)
- `scripts/src/lpc-mapping.ts` — LPC id→path/palette mapping (extracted + extended)

### Modified
- `scripts/src/build-lpc-assets.ts` — beard/glasses/earrings loops, extended maps, coverage
  assertion, catalog/credits emit
- `artifacts/focusquest/src/lib/hero/types.ts` — new `LayerCategory` values, `HeroLook` fields,
  z-order; types sourced from `hero-options`
- `artifacts/focusquest/src/lib/hero/resolve-layers.ts` — emit beard/glasses/earrings ids
- `artifacts/focusquest/src/lib/hero/catalog.ts` — regenerated
- `artifacts/focusquest/public/lpc/**` + `CREDITS.csv` — new PNGs + credits (regenerated)
- `lib/db/src/schema/users.ts` — four new avatar columns
- `artifacts/api-server/src/routes/avatar.ts` — read `hero-options`; new fields in response +
  validation
- `lib/api-spec/openapi.yaml`, `lib/api-client-react/**`, `lib/api-zod/**` — new avatar fields;
  appearance fields loosened to `string`
- `artifacts/focusquest/src/pages/avatar.tsx` — new pickers; swatch lookups from `hero-options`
- `artifacts/focusquest/src/lib/hero/catalog-integrity.test.ts`,
  `artifacts/focusquest/src/lib/hero/resolve-layers.test.ts` — new coverage

## Non-goals (this pass)
- Eyes / eye color (needs body-sprite rebuild) and expressions.
- More body builds; any per-build multiplication of the catalog.
- Runtime free-color picker / tinting engine — colors stay baked palette swaps.
- Saveable look presets / multiple outfits.
- Any gear, battle, or economy changes — this is appearance only.
