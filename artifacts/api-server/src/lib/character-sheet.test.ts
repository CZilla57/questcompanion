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
  stepProgress,
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

describe("stepProgress — sub-band fill toward the next point", () => {
  const ladder = [
    { at: 0, score: 8 },
    { at: 10, score: 10 },
    { at: 30, score: 12 },
  ];

  it("is empty just after a step and fills across the band", () => {
    expect(stepProgress(10, ladder)).toMatchObject({ fraction: 0, toNext: 20, nextScore: 12, atMax: false });
    expect(stepProgress(20, ladder)).toMatchObject({ fraction: 0.5, toNext: 10, nextScore: 12 });
    expect(stepProgress(29, ladder).fraction).toBeCloseTo(19 / 20);
  });

  it("reads full and maxed at the top rung, with no next score", () => {
    expect(stepProgress(30, ladder)).toEqual({ fraction: 1, toNext: 0, nextScore: null, atMax: true });
    expect(stepProgress(999, ladder)).toEqual({ fraction: 1, toNext: 0, nextScore: null, atMax: true });
  });

  it("reads the first band toward the first point", () => {
    expect(stepProgress(0, ladder)).toMatchObject({ fraction: 0, toNext: 10, nextScore: 10 });
    expect(stepProgress(5, ladder).fraction).toBeCloseTo(0.5);
  });

  it("fill only rises within a band as the signal rises (anti-shame)", () => {
    let prev = -1;
    for (let v = 10; v < 30; v++) {
      const f = stepProgress(v, ladder).fraction;
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });
});

describe("ability progress on the real ladders", () => {
  it("attaches a progress reading to every ability, consistent with its score", () => {
    const scores = abilityScores({
      lifetimeByKingdom: { forge: 1500, athenaeum: 20000 },
      focus: { completedIntervals: 100 },
    });
    const by = (id: AbilityId) => scores.find((s) => s.id === id)!;

    // forge 1500 → Village (14); band [1000,3000) → (1500-1000)/2000 = 0.25, 1500 to Might 16.
    const might = by("might");
    expect(might.score).toBe(14);
    expect(might.progress.fraction).toBeCloseTo(0.25);
    expect(might.progress.toNext).toBe(1500);
    expect(might.progress.nextScore).toBe(16);
    expect(might.progress.atMax).toBe(false);

    // athenaeum 20000 → maxed at 20, bar reads full, no next point.
    const intellect = by("intellect");
    expect(intellect.score).toBe(MAX_SCORE);
    expect(intellect.progress).toEqual({ fraction: 1, toNext: 0, nextScore: null, atMax: true });

    // finesse 100 intervals → band [75,200) score 14 → next 16.
    const finesse = by("finesse");
    expect(finesse.score).toBe(14);
    expect(finesse.progress.nextScore).toBe(16);
    expect(finesse.progress.fraction).toBeCloseTo((100 - 75) / (200 - 75));
  });

  it("a floor ability reads empty toward its first point (10)", () => {
    const scores = abilityScores({ lifetimeByKingdom: {}, focus: { completedIntervals: 0 } });
    for (const s of scores) {
      expect(s.progress.atMax).toBe(false);
      expect(s.progress.nextScore).toBe(10);
      expect(s.progress.fraction).toBe(0);
    }
  });

  it("progress never disagrees with the score function at a rung (drift guard)", () => {
    for (const at of [0, 1, 250, 1000, 3000, 8000, VETERAN_KINGDOM_POINTS]) {
      const s = abilityScores({
        lifetimeByKingdom: { forge: at },
        focus: { completedIntervals: 0 },
      }).find((x) => x.id === "might")!;
      expect(s.score).toBe(scoreForKingdomPoints(at));
      if (at >= VETERAN_KINGDOM_POINTS) {
        expect(s.progress.atMax).toBe(true);
      } else {
        // Exactly on a rung: a fresh band whose next point is score + 2.
        expect(s.progress.fraction).toBe(0);
        expect(s.progress.nextScore).toBe(s.score + 2);
      }
    }
  });
});

describe("abilityScores — gear overlay (upside-only)", () => {
  const args = { lifetimeByKingdom: { athenaeum: 3000 }, focus: { completedIntervals: 0 } };

  it("is unchanged when no gearMods are passed (backward compatible)", () => {
    const sheet = abilityScores(args);
    const intel = sheet.find((a) => a.id === "intellect")!;
    expect(intel.score).toBe(16);
    expect(intel.gearBonus).toBe(0);
    expect(intel.effectiveScore).toBe(16);
    expect(intel.effectiveModifier).toBe(intel.modifier);
  });

  it("overlays gear on top without moving the base score", () => {
    const sheet = abilityScores({ ...args, gearMods: { intellect: 2 } });
    const intel = sheet.find((a) => a.id === "intellect")!;
    expect(intel.score).toBe(16); // base untouched
    expect(intel.gearBonus).toBe(2);
    expect(intel.effectiveScore).toBe(18);
    expect(intel.effectiveModifier).toBe(intel.modifier + 1);
  });

  it("lets gear push the effective score past the natural 20 ceiling", () => {
    const maxed = { lifetimeByKingdom: { athenaeum: 999_999 }, focus: { completedIntervals: 0 } };
    const sheet = abilityScores({ ...maxed, gearMods: { intellect: 4 } });
    const intel = sheet.find((a) => a.id === "intellect")!;
    expect(intel.score).toBe(20); // earned cap
    expect(intel.effectiveScore).toBe(24); // gear exceeds it
  });
});
