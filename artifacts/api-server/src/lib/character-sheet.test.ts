import { describe, it, expect } from "vitest";
import {
  ABILITIES,
  MIN_SCORE,
  MAX_SCORE,
  VETERAN_KINGDOM_POINTS,
  abilityModifier,
  scoreForKingdomPoints,
  scoreForFocus,
  proficiencyBonus,
  abilityScores,
  modifierForAbility,
  abilityForKingdom,
  characterSheet,
  type AbilityId,
} from "./character-sheet";
import { BALANCE_KINGDOMS, CAPITAL_TIERS, type KingdomId } from "./kingdoms";

describe("ability roster", () => {
  it("has exactly six abilities with unique ids", () => {
    expect(ABILITIES).toHaveLength(6);
    const ids = new Set(ABILITIES.map((a) => a.id));
    expect(ids.size).toBe(6);
  });

  it("maps each of the five balance kingdoms to exactly one ability, finesse to none", () => {
    for (const kid of BALANCE_KINGDOMS) {
      const matches = ABILITIES.filter((a) => a.kingdomId === kid);
      expect(matches, `kingdom ${kid} should back one ability`).toHaveLength(1);
    }
    const finesse = ABILITIES.find((a) => a.id === "finesse");
    expect(finesse?.kingdomId).toBeNull();
    // The capital is never an ability source — it drives proficiency instead.
    expect(ABILITIES.some((a) => a.kingdomId === "capital")).toBe(false);
  });
});

describe("abilityModifier — classic D&D math", () => {
  it("floors (score - 10) / 2", () => {
    const cases: [number, number][] = [
      [8, -1], [9, -1], [10, 0], [11, 0], [12, 1], [14, 2], [16, 3], [18, 4], [20, 5],
    ];
    for (const [score, mod] of cases) expect(abilityModifier(score)).toBe(mod);
  });
});

describe("scoreForKingdomPoints", () => {
  it("maps each tier band to a clean even score 8..18", () => {
    expect(scoreForKingdomPoints(0)).toBe(8);       // Wild
    expect(scoreForKingdomPoints(1)).toBe(10);      // Outpost
    expect(scoreForKingdomPoints(250)).toBe(12);    // Settlement
    expect(scoreForKingdomPoints(1000)).toBe(14);   // Village
    expect(scoreForKingdomPoints(3000)).toBe(16);   // Town
    expect(scoreForKingdomPoints(8000)).toBe(18);   // Stronghold
  });

  it("reaches the veteran 20 only past the veteran threshold", () => {
    expect(scoreForKingdomPoints(VETERAN_KINGDOM_POINTS - 1)).toBe(18);
    expect(scoreForKingdomPoints(VETERAN_KINGDOM_POINTS)).toBe(MAX_SCORE);
    expect(scoreForKingdomPoints(999_999)).toBe(MAX_SCORE);
  });

  it("never leaves [8, 20]", () => {
    for (const p of [0, 1, 249, 250, 7999, 8000, 20000, 1_000_000]) {
      const s = scoreForKingdomPoints(p);
      expect(s).toBeGreaterThanOrEqual(MIN_SCORE);
      expect(s).toBeLessThanOrEqual(MAX_SCORE);
    }
  });

  it("is monotonic — more points never lower a score (anti-shame invariant)", () => {
    let prev = -Infinity;
    for (let p = 0; p <= 25_000; p += 137) {
      const s = scoreForKingdomPoints(p);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });
});

describe("scoreForFocus", () => {
  it("maps completed-interval bands to 8..20", () => {
    expect(scoreForFocus(0)).toBe(8);
    expect(scoreForFocus(1)).toBe(10);
    expect(scoreForFocus(25)).toBe(12);
    expect(scoreForFocus(75)).toBe(14);
    expect(scoreForFocus(200)).toBe(16);
    expect(scoreForFocus(500)).toBe(18);
    expect(scoreForFocus(1200)).toBe(20);
  });

  it("is monotonic in completed intervals", () => {
    let prev = -Infinity;
    for (let n = 0; n <= 1500; n += 7) {
      const s = scoreForFocus(n);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });
});

describe("proficiencyBonus", () => {
  it("runs +2..+6 across the capital ladder and is monotonic", () => {
    let prev = -Infinity;
    for (const t of [...CAPITAL_TIERS].map((c) => c.tier).sort((a, b) => a - b)) {
      const pb = proficiencyBonus(t);
      expect(pb).toBeGreaterThanOrEqual(2);
      expect(pb).toBeLessThanOrEqual(6);
      expect(pb).toBeGreaterThanOrEqual(prev);
      prev = pb;
    }
  });

  it("caps at +6", () => {
    expect(proficiencyBonus(0)).toBe(2);
    expect(proficiencyBonus(11)).toBe(6);
    expect(proficiencyBonus(99)).toBe(6);
  });
});

describe("abilityScores", () => {
  const focus = { completedIntervals: 0 };

  it("returns all six abilities in roster order with correct modifiers", () => {
    const scores = abilityScores({ lifetimeByKingdom: {}, focus });
    expect(scores.map((s) => s.id)).toEqual(ABILITIES.map((a) => a.id));
    for (const s of scores) expect(s.modifier).toBe(abilityModifier(s.score));
  });

  it("reads each ability from its own source signal", () => {
    const scores = abilityScores({
      lifetimeByKingdom: { forge: 3000, athenaeum: 1000, wellspring: 250, crossroads: 1, hearth: 0 },
      focus: { completedIntervals: 200 },
    });
    const by = (id: AbilityId) => scores.find((s) => s.id === id)!;
    expect(by("might").score).toBe(16);       // forge 3000 → Town
    expect(by("intellect").score).toBe(14);   // athenaeum 1000 → Village
    expect(by("attunement").score).toBe(12);  // wellspring 250 → Settlement
    expect(by("presence").score).toBe(10);    // crossroads 1 → Outpost
    expect(by("vigor").score).toBe(8);        // hearth 0 → Wild
    expect(by("finesse").score).toBe(16);     // 200 intervals
  });

  it("does not let one kingdom's points leak into another ability", () => {
    const scores = abilityScores({ lifetimeByKingdom: { forge: 20000 }, focus });
    expect(scores.find((s) => s.id === "might")!.score).toBe(20);
    for (const s of scores.filter((s) => s.id !== "might")) expect(s.score).toBe(8);
  });
});

describe("modifierForAbility / abilityForKingdom", () => {
  it("resolves a modifier by ability id, 0 for unknown", () => {
    const scores = abilityScores({ lifetimeByKingdom: { forge: 3000 }, focus: { completedIntervals: 0 } });
    expect(modifierForAbility(scores, "might")).toBe(3);
    expect(modifierForAbility(scores, "vigor")).toBe(-1);
  });

  it("maps a kingdom to the ability it backs; capital falls to finesse", () => {
    expect(abilityForKingdom("forge")).toBe("might");
    expect(abilityForKingdom("wellspring")).toBe("attunement");
    expect(abilityForKingdom("capital")).toBe("finesse");
  });
});

describe("characterSheet", () => {
  it("computes abilities + proficiency and passes through class/level/power", () => {
    const sheet = characterSheet({
      lifetimeByKingdom: { forge: 3000, athenaeum: 1000, wellspring: 250, crossroads: 1, hearth: 100 },
      focus: { completedIntervals: 75 },
      heroClass: "mage",
      level: 12,
      battlePower: 340,
    });
    expect(sheet.abilities).toHaveLength(6);
    expect(sheet.heroClass).toBe("mage");
    expect(sheet.level).toBe(12);
    expect(sheet.battlePower).toBe(340);
    // Capital lifetime = sum of all six rows = 4351 → capital tier 6 (Borough) → +2 + floor(6/2)=+5.
    expect(sheet.proficiencyBonus).toBe(5);
  });

  it("empty realm yields the floor sheet, never below 8 / +2 proficiency", () => {
    const sheet = characterSheet({
      lifetimeByKingdom: {},
      focus: { completedIntervals: 0 },
      heroClass: "ranger",
      level: 1,
      battlePower: 0,
    });
    for (const a of sheet.abilities) {
      expect(a.score).toBe(MIN_SCORE);
      expect(a.modifier).toBe(-1);
    }
    expect(sheet.proficiencyBonus).toBe(2);
  });
});
