import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import * as hero from "@workspace/hero-options";
import { CATALOG } from "./catalog";

// vitest runs this file under ESM; `__dirname` is not defined there, so we derive
// the on-disk root from `import.meta.dirname` (Node 20.11+) instead.
const PUBLIC = path.resolve(import.meta.dirname, "../../../public");
const LPC = path.join(PUBLIC, "lpc");
const Z_BANDS: Record<string, number> = { aura: 5, body: 10, earrings: 15, beard: 20, face: 20, hair: 30, glasses: 35, outfit: 40, boots: 50, armor: 60, helmet: 70, weapon: 80, accessory: 90 };

describe("catalog integrity", () => {
  it("every catalog entry points to a file that exists on disk", () => {
    for (const e of CATALOG) {
      const p = path.join(PUBLIC, e.file); // e.file starts with /lpc/...
      expect(existsSync(p), `missing file for ${e.id}: ${e.file}`).toBe(true);
    }
  });

  it("every entry's zIndex matches its category band", () => {
    for (const e of CATALOG) expect(e.zIndex, `bad z for ${e.id}`).toBe(Z_BANDS[e.category]);
  });

  it("every outfit and gear id exists for both builds", () => {
    const ids = new Set(CATALOG.map((e) => e.id));
    for (const e of CATALOG) {
      const m = e.id.match(/^(outfit:.+|gear:[^:]+):(male|female)$/);
      if (!m) continue;
      const other = e.id.endsWith(":male") ? e.id.replace(/:male$/, ":female") : e.id.replace(/:female$/, ":male");
      expect(ids.has(other), `${e.id} missing its paired build`).toBe(true);
    }
  });

  it("all 32 outfit sprites are pairwise byte-distinct", () => {
    // Every outfit archetype (class x tier x build) is a unique piece of art — unlike gear,
    // where body-agnostic items (e.g. helm/greatsword) intentionally reuse identical bytes
    // across male/female. A hash collision here means two outfit slots point at the same PNG.
    const outfits = CATALOG.filter((e) => e.category === "outfit");
    const hashes = new Map<string, string[]>();
    for (const e of outfits) {
      const bytes = readFileSync(path.join(PUBLIC, e.file));
      const hash = createHash("sha256").update(bytes).digest("hex");
      const ids = hashes.get(hash) ?? [];
      ids.push(e.id);
      hashes.set(hash, ids);
    }
    const collisions = [...hashes.values()].filter((ids) => ids.length > 1);
    expect(collisions, `duplicate outfit sprites: ${JSON.stringify(collisions)}`).toEqual([]);
    expect(hashes.size).toBe(32);
    expect(outfits.length).toBe(32);
  });
});

describe("attribution coverage", () => {
  it("every entry has non-empty author + license", () => {
    for (const e of CATALOG) {
      expect(e.author.length, `no author for ${e.id}`).toBeGreaterThan(0);
      expect(e.license.length, `no license for ${e.id}`).toBeGreaterThan(0);
    }
  });

  it("every bundled PNG under public/lpc has a catalog entry", () => {
    const files = new Set(CATALOG.map((e) => e.file));
    const walk = (dir: string) => readdirSync(dir, { withFileTypes: true }).forEach((d) => {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) return walk(full);
      if (!d.name.endsWith(".png")) return;
      const rel = "/lpc/" + path.relative(LPC, full).split(path.sep).join("/");
      expect(files.has(rel), `orphan asset with no catalog entry: ${rel}`).toBe(true);
    });
    walk(LPC);
  });

  it("CREDITS.csv exists and is non-trivial", () => {
    const csv = readFileSync(path.join(LPC, "CREDITS.csv"), "utf8");
    expect(csv.split("\n").length).toBeGreaterThan(2);
  });
});

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
