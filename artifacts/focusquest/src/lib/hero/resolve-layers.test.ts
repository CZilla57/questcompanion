import { describe, it, expect } from "vitest";
import { resolveLayers } from "./resolve-layers";
import type { CatalogEntry, HeroLook } from "./types";

function cat(entries: CatalogEntry[]): Map<string, CatalogEntry> {
  return new Map(entries.map((e) => [e.id, e]));
}

const base = (id: string, category: CatalogEntry["category"], zIndex: number): CatalogEntry => ({
  id, category, zIndex, file: `/lpc/${id}.png`, author: "a", license: "CC0", sourceUrl: "u",
});

const look: HeroLook = {
  skin: "light", build: "male", hairStyle: "short", hairColor: "brown",
  face: "neutral", avatarClass: "fighter", tier: 0, equipped: [],
};

const baseEntries: CatalogEntry[] = [
  base("body:male:light", "body", 10),
  base("hair:short:brown", "hair", 30),
  base("outfit:fighter:t0:male", "outfit", 40),
  base("gear:iron-helm:male", "helmet", 70),
];

const fullCatalog = cat(baseEntries);

describe("resolveLayers", () => {
  it("returns body, hair, outfit ordered by zIndex for an ungeared hero (face baked into body)", () => {
    const layers = resolveLayers(look, fullCatalog);
    expect(layers.map((l) => l.file)).toEqual([
      "/lpc/body:male:light.png",
      "/lpc/hair:short:brown.png",
      "/lpc/outfit:fighter:t0:male.png",
    ]);
  });

  it("does not emit a face layer even when one exists in the catalog (face is part of the body sprite)", () => {
    const layers = resolveLayers(look, cat([...baseEntries, base("face:neutral", "face", 20)]));
    expect(layers.some((l) => l.file.includes("face"))).toBe(false);
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

  it("skips catalog ids that are not present (e.g. unbuilt outfits/gear)", () => {
    const sparse = cat([base("body:male:light", "body", 10)]);
    const layers = resolveLayers(look, sparse);
    expect(layers.map((l) => l.file)).toEqual(["/lpc/body:male:light.png"]);
  });

  it("sorts final layers by zIndex, not by collection/insertion order", () => {
    // collectIds() emits body, hair, outfit in that order. Here the catalog assigns zIndex so the
    // correct render order is the REVERSE of insertion order (outfit=10 ... body=40). If
    // resolveLayers ever dropped its `.sort()`, this would return insertion order and fail.
    const scrambledCatalog = cat([
      base("body:male:light", "body", 40),
      base("hair:short:brown", "hair", 30),
      base("outfit:fighter:t0:male", "outfit", 10),
    ]);
    const layers = resolveLayers(look, scrambledCatalog);
    expect(layers.map((l) => l.file)).toEqual([
      "/lpc/outfit:fighter:t0:male.png", // zIndex 10
      "/lpc/hair:short:brown.png",       // zIndex 30
      "/lpc/body:male:light.png",        // zIndex 40
    ]);
  });

  it("applies each equipped gear item's own tint independently and leaves non-gear layers untinted", () => {
    const multiGearCatalog = cat([
      ...baseEntries,
      base("gear:steel-boots:male", "boots", 50),
    ]);
    const geared: HeroLook = {
      ...look,
      equipped: [
        { slot: "helmet", spriteId: "iron-helm", rarity: "rare" },
        { slot: "boots", spriteId: "steel-boots", rarity: "legendary" },
      ],
    };
    const layers = resolveLayers(geared, multiGearCatalog);

    const helm = layers.find((l) => l.file.includes("iron-helm"));
    const boots = layers.find((l) => l.file.includes("steel-boots"));
    expect(helm).toBeDefined();
    expect(boots).toBeDefined();
    expect(helm!.tint).toBe("#3b82f6"); // rare
    expect(boots!.tint).toBe("#f59e0b"); // legendary

    const nonGear = layers.filter(
      (l) => !l.file.includes("iron-helm") && !l.file.includes("steel-boots"),
    );
    expect(nonGear.length).toBe(3); // body, hair, outfit
    for (const l of nonGear) {
      expect(l.tint).toBeUndefined();
    }
  });
});
