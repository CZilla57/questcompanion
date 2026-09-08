import { describe, it, expect } from "vitest";
import {
  BESTIARY,
  FOES,
  HP_MIN,
  HP_POWER_MULT,
  FELL_BASE_COINS,
  FELL_TIER_COINS,
  encounterName,
  encounterHp,
  felledCoins,
  nextTier,
  foeFor,
  foeByName,
  buildBestiary,
} from "./encounter-progress";

describe("encounterName", () => {
  it("names every tier from the bestiary and rotates", () => {
    expect(encounterName(1)).toBe(BESTIARY[0]);
    expect(encounterName(BESTIARY.length)).toBe(BESTIARY[BESTIARY.length - 1]);
    expect(encounterName(BESTIARY.length + 1)).toBe(BESTIARY[0]); // wraps
    expect(encounterName(0)).toBe(BESTIARY[0]); // guards tier < 1
  });
});

describe("foe roster (Act III — named, arc'd foes)", () => {
  it("BESTIARY mirrors the FOES names in order", () => {
    expect(BESTIARY).toEqual(FOES.map((f) => f.name));
  });

  it("every foe has a motive, defeat beat, and world note", () => {
    for (const f of FOES) {
      expect(f.motive.length).toBeGreaterThan(0);
      expect(f.defeatBeat.length).toBeGreaterThan(0);
      expect(f.worldNote.length).toBeGreaterThan(0);
    }
  });

  it("foeFor rotates and matches encounterName; foeByName round-trips", () => {
    expect(foeFor(1).name).toBe(encounterName(1));
    expect(foeFor(FOES.length + 1).name).toBe(FOES[0]!.name); // wraps
    for (const f of FOES) expect(foeByName(f.name)).toBe(f);
    expect(foeByName("not a foe")).toBeUndefined();
  });

  it("copy is anti-shame — external framing, never blames the player", () => {
    for (const f of FOES) {
      const text = `${f.motive} ${f.defeatBeat} ${f.worldNote}`.toLowerCase();
      expect(text).not.toContain("you failed");
      expect(text).not.toContain("you didn't");
      // Defeat lines celebrate the foe falling, never the player losing.
      expect(f.defeatBeat.toLowerCase()).not.toContain("fail");
    }
  });
});

describe("encounterHp", () => {
  it("sizes to power at tier 1 and floors small heroes", () => {
    expect(encounterHp(1, 100)).toBe(100 * HP_POWER_MULT);
    expect(encounterHp(1, 0)).toBe(HP_MIN);
    expect(encounterHp(1, 10)).toBe(HP_MIN); // 30 < 200 floor
  });

  it("grows with tier and with power (monotonic)", () => {
    expect(encounterHp(2, 100)).toBeGreaterThan(encounterHp(1, 100));
    expect(encounterHp(1, 200)).toBeGreaterThan(encounterHp(1, 100));
    let prev = -Infinity;
    for (let t = 1; t <= 10; t++) {
      const hp = encounterHp(t, 150);
      expect(hp).toBeGreaterThanOrEqual(prev);
      prev = hp;
    }
  });
});

describe("felledCoins", () => {
  it("is upside-only and grows with tier", () => {
    expect(felledCoins(1)).toBe(FELL_BASE_COINS);
    expect(felledCoins(3)).toBe(FELL_BASE_COINS + 2 * FELL_TIER_COINS);
    expect(felledCoins(1)).toBeGreaterThan(0);
    expect(felledCoins(5)).toBeGreaterThan(felledCoins(4));
  });
});

describe("nextTier", () => {
  it("advances the run", () => {
    expect(nextTier(1)).toBe(2);
    expect(nextTier(7)).toBe(8);
    expect(nextTier(0)).toBe(2); // guards tier < 1 to 1, then +1
  });
});

describe("buildBestiary (Act V — discovery log)", () => {
  const A = FOES[0]!.name;
  const B = FOES[1]!.name;

  it("all-silhouette for a hero who has felled nothing", () => {
    const bst = buildBestiary([], null);
    expect(bst.total).toBe(FOES.length);
    expect(bst.discoveredCount).toBe(0);
    for (const e of bst.entries) {
      expect(e.discovered).toBe(false);
      expect(e.name).toBeNull();
      expect(e.motive).toBeNull();
      expect(e.defeatBeat).toBeNull();
      expect(e.timesFelled).toBe(0);
    }
  });

  it("a felled foe is revealed with full copy, counts, and first/last dates", () => {
    const early = new Date("2026-09-01T10:00:00Z");
    const late = new Date("2026-09-05T10:00:00Z");
    const bst = buildBestiary([{ name: A, felledAt: late }, { name: A, felledAt: early }], null);
    const e = bst.entries.find((x) => x.name === A)!;
    expect(e.discovered).toBe(true);
    expect(e.motive).toBe(FOES[0]!.motive);
    expect(e.defeatBeat).toBe(FOES[0]!.defeatBeat);
    expect(e.worldNote).toBe(FOES[0]!.worldNote);
    expect(e.timesFelled).toBe(2);
    expect(e.firstFelledAt).toBe(early.toISOString());
    expect(e.lastFelledAt).toBe(late.toISOString());
    expect(bst.discoveredCount).toBe(1);
  });

  it("the active foe reveals name+motive but WITHHOLDS the earned defeat copy until felled", () => {
    const bst = buildBestiary([], B); // facing B, never felled it
    const e = bst.entries.find((x) => x.slot === 1)!;
    expect(e.active).toBe(true);
    expect(e.discovered).toBe(false);
    expect(e.name).toBe(B);
    expect(e.motive).toBe(FOES[1]!.motive);
    expect(e.defeatBeat).toBeNull(); // learned only by felling it
    expect(e.worldNote).toBeNull();
  });

  it("ignores fells for names outside the current roster (retired foes)", () => {
    const bst = buildBestiary([{ name: "The Long-Gone Beast", felledAt: new Date() }], null);
    expect(bst.discoveredCount).toBe(0);
  });

  it("entries follow the roster order (stable slots)", () => {
    const bst = buildBestiary([], null);
    expect(bst.entries.map((e) => e.slot)).toEqual(FOES.map((_, i) => i));
  });
});
