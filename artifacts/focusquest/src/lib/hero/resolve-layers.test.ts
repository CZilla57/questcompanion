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
