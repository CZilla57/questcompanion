# Layered Pixel Hero & Gear-on-Body — Design Spec

## Overview

Replace the single baked-PNG avatar with a **composable, layered pixel-art character** that (1) supports physical customization (skin tone, hair style + color, body build, face/eyes) and (2) renders **equipped gear on the body** instead of as colored dots. Art comes from the **Universal LPC Spritesheet** asset set (free, modular, purpose-built for character customization + equipment layering).

### Problem with today's system

- Character is a static image: `/avatars/{class}-t{tier}.png` (4 classes × 4 tiers = 16 baked PNGs). A single image cannot show combinatorial customization or layered gear.
- `avatarSkin` is stored in `users`, returned by `/avatar`, and defined in `SKIN_PALETTES` — but **never rendered**.
- `avatarColor` only drives a glow; equipped gear appears only as colored dots + a text list, never on the body.

### Goal

The hero visibly reflects who the player made them and what they've equipped, making the Hero page the engagement centerpiece.

## Art source & licensing

**Pack:** Universal LPC Spritesheet (generator: `LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator`). 64×64 frame format; data-defined layer catalog with defined z-order; per-asset licenses (CC0 / CC-BY / OGA-BY / CC-BY-SA-4.0 / GPL-3.0).

**Integration strategy — assets only, never the generator code.** The generator app is GPL; embedding its runtime would impose GPL on our app source. We use only the **exported art**, which keeps copyleft confined to the art layers, not our code.

**Selection bias:** prefer CC0 / CC-BY / OGA-BY assets to minimize share-alike obligations. CC-BY-SA assets are allowed but require our derived sheets to also be CC-BY-SA and made available.

**Attribution obligations:**
- Bundle the generator's `CREDITS.csv` for the exact assets we ship.
- Surface an in-app **Credits** view listing author + license + source URL per asset.
- Any composited/recolored derivative sheets we produce from CC-BY-SA sources are themselves CC-BY-SA and must be available.

## Asset pipeline (build-time)

1. From the LPC generator, select the specific bodies, hair, faces, class outfits, and equipment items in scope.
2. Export the **single standing frame** (64×64 — the idle/"south walk" frame) for each layer as a trimmed PNG.
3. Commit them under `artifacts/focusquest/public/lpc/{category}/{id}.png` (same static-asset pattern as `/avatars/`).
4. Record every exported asset in a generated `catalog.ts` (see below) alongside its author + license from the LPC credits.

This is a manual curation step performed once per batch of assets; there is no runtime dependency on the generator.

## Rendering architecture

### `resolveLayers(look)` — pure function

Input: a `HeroLook` descriptor (physical attributes + class + tier + equipped gear list). Output: an **ordered** array `[{ src, tint? }]` following the LPC z-order (body → eyes → face → hair → class outfit → boots → legs/armor → torso/armor → arms → head/helmet → weapon → accessory/FX). Pure, deterministic, no canvas — unit-testable in isolation.

### `PixelHero` — React component

- Draws each resolved layer PNG in order onto a `<canvas>` via `drawImage`, then scales the canvas up with `image-rendering: pixelated` to the requested display size.
- Applies the **rarity tint pass** per-layer (see below) during compositing.
- Optional `idleAnimation` (subtle vertical bob via CSS transform on the canvas wrapper).
- Replaces `AvatarRenderer`; same call sites (`avatar.tsx`, `progress.tsx`, `layout.tsx`, `task-item.tsx`) get the new component. `AvatarRenderer` and the 16 baked PNGs are retired (PNGs may be kept only as a social/OpenGraph fallback).

### Recolor model (v1)

- **Skin tone & hair color:** pick-a-variant — the exported LPC PNG for the chosen skin/hair-color is loaded directly. No runtime palette engine in v1.
- **Rarity:** runtime **tint pass** — the gear layer is drawn, then a `multiply`/`source-atop` fill toward the rarity color is applied on an offscreen canvas, preserving shading. Plus a glow (canvas shadow or CSS drop-shadow) keyed to rarity.
- **Signature legendaries:** legendary (and optionally epic) items reference a **dedicated sprite** instead of a tinted archetype, so top-tier rewards feel distinct.
- Full runtime palette-swap (LPC's WebGL/CPU approach) is a **future option**, not in v1.

## Data model

### `users` (add columns)

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `avatarHairStyle` | text | `"short"` | LPC hair style id |
| `avatarHairColor` | text | `"brown"` | LPC hair color variant id |
| `avatarBodyBuild` | text | `"male"` | LPC body base: male / female |
| `avatarFace` | text | `"neutral"` | face/eye variant id |
| `avatarEyeColor` | text | `"brown"` | optional; eye color variant |

Existing `avatarSkin`, `avatarClass`, `avatarColor` are retained. `avatarColor` continues as an accent/glow color.

### `gear_items` (add column)

| Column | Type | Notes |
|--------|------|-------|
| `spriteId` | text | Catalog key → LPC equipment layer(s) + z-index. Nullable during migration; backfilled per catalog row. `icon` (lucide) is kept for the store list UI. |

### Client catalog — `catalog.ts` (new, single source of truth)

Each entry: `{ id, category, zIndex, file, author, license, sourceUrl }`. Consumed by both `resolveLayers` (paths + z-order) and the Credits view (attribution). Physical-attribute variants and gear `spriteId`s both resolve through this catalog. **Equipment entries resolve `file` by `(spriteId, build)`** (see Class, tiers & gear mapping), since LPC gear sheets are body-type-specific.

## API

Stack: OpenAPI spec in `lib/api-spec/` → generated React Query client via Orval in `lib/api-client-react/` → Zod types in `lib/api-zod/`. Route handlers in `artifacts/api-server/src/routes/`.

### `GET /api/avatar` (extend)

Add to the response: `avatarHairStyle`, `avatarHairColor`, `avatarBodyBuild`, `avatarFace`, `avatarEyeColor`, and the available-options arrays (`availableHairStyles`, `availableBuilds`, `availableFaces`, `availableEyeColors`). Add `spriteId` to each `equippedGear` entry.

### `PATCH /api/avatar` (extend)

Accept and validate the new fields against their allowed-value lists (same guard style as the existing `avatarClass`/`avatarSkin` validation — reject unknown values with 400). Return the rebuilt avatar response.

### Gear responses

`GET /api/gear/store` and equip/unequip payloads include `spriteId` so the client knows which sprite to render.

## Class, tiers & gear mapping

- **Class = base outfit** (fighter=tunic, mage=robe, ranger=leathers, healer=vestments), selected from LPC clothing that reads as each class.
- **Outfit upgrades per tier:** each class has **4 tier outfits** (t0–t3), chosen by level. The outfit shows through empty slots; equipped gear draws over it.
- **Gear → LPC layers** via `spriteId`. **Body build maps to an LPC body type, and LPC equipment sheets are body-type-specific** — so a gear item's on-body sprite differs per build. This is handled at **build-time, not runtime**: the catalog resolves an equipped item by `(spriteId, build)` to the correct pre-exported PNG, so the runtime compositor stays a simple lookup and gear never multiplies combinatorially at runtime. The cost is a bounded build-time authoring/export step. The build set is just **two (male / female)**, and every gear item must have an exported sprite for each build before it can ship (enforced by the catalog-integrity test).

## UI (Hero page — `pages/avatar.tsx`)

- Left panel gains customization controls: **hair style**, **hair color**, **body build**, **face/eyes**, and a **skin tone picker** (skin is not selectable today). Existing class + accent-color controls stay.
- Center: live `PixelHero` showing equipped gear on the body. The equipment slot list + gear store + weekly battle panel are unchanged in function.
- **Credits** entry point (link/section) listing LPC attributions.
- **Engagement touches:** idle bob; an **equip flash** FX when gear changes; a **level aura** behind the hero that intensifies with level.

## Testing

- `resolveLayers` — unit tests asserting correct z-order and layer set for representative looks (ungeared, fully geared, legendary, each build).
- **Catalog integrity** — every gear `spriteId` and every physical-attribute variant resolves to an existing bundled file; z-indexes valid.
- **Attribution coverage** — every bundled asset has a matching credits entry (fails the build if an asset ships without attribution).
- **API validation** — `PATCH /api/avatar` rejects unknown enum values for each new field.
- Optional visual smoke — render a fixed look to canvas and hash/snapshot.

## Phasing

- **Phase 0 — LPC spike:** export pipeline + `resolveLayers` + `PixelHero` proven with one body + one gear item on screen. De-risks the approach before volume curation.
- **Phase 1 — Physical customization:** compositor + catalog + attribution shipped; `PixelHero` replaces `AvatarRenderer`; skin/hair/build/face wired DB → API → UI.
- **Phase 2 — Gear on body:** `spriteId` mapping, rarity tint/FX, signature legendaries, class outfits ×4 tiers.
- **Phase 3 — Polish:** idle bob, equip flash, level aura, transitions.

## Files to create/modify

### New
- `artifacts/focusquest/src/components/pixel-hero.tsx` — canvas compositor component
- `artifacts/focusquest/src/lib/hero/resolve-layers.ts` — pure layer-resolution function
- `artifacts/focusquest/src/lib/hero/catalog.ts` — generated asset catalog (paths, z-index, attribution)
- `artifacts/focusquest/public/lpc/**` — exported LPC layer PNGs + `CREDITS.csv`
- `artifacts/focusquest/src/components/hero-credits.tsx` — attribution view
- Tests for `resolve-layers` and catalog integrity

### Modified
- `lib/db/src/schema/users.ts` — new avatar columns
- `lib/db/src/schema/gear.ts` — `spriteId` column
- `artifacts/api-server/src/routes/avatar.ts` — read/validate/return new fields
- `artifacts/api-server/src/routes/gear.ts` — include `spriteId`
- `lib/api-spec/` — update OpenAPI for the new fields
- `lib/api-client-react/` — regenerate via Orval
- `artifacts/focusquest/src/pages/avatar.tsx` — new controls + `PixelHero`
- `artifacts/focusquest/src/components/avatar-renderer.tsx` — retired/removed after call sites migrate

## Non-goals (v1)

- No runtime WebGL/CPU palette-swap engine (pick-a-variant + rarity tint only).
- No animated poses/walk cycles — single standing frame (plus CSS idle bob).
- No embedding of the LPC generator runtime or its catalog code.
- No body-build slider — exactly two body types (male / female), because LPC gear is exported per body type.
- No 3D.
- Battle mechanics, gear economy, and rewards are unchanged.
